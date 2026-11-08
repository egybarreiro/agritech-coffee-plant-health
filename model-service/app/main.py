"""FastAPI application: the coffee model inference service.

Endpoints (the complete surface — there is deliberately NO route that
exposes the checkpoint file):
  GET  /health          — readiness + model metadata: 200 when the disease
                          model is loaded, 503 with the explicit load error
                          otherwise; reports the binary health model state
                          separately.
  POST /predict         — multipart upload of one image; returns the four
                          named sigmoid probabilities + threshold decisions
                          (existing single-stage contract, unchanged).
  POST /predict-health  — TWO-STAGE flow: binary health model first; when
                          Unhealthy (p >= threshold, configurable via
                          COFFEE_UNHEALTHY_THRESHOLD, default 0.2244) the
                          four-disease classifier runs unchanged. When
                          Healthy the disease classifier is NOT run.

The model is loaded ONCE in the lifespan hook, before the first request. If
the checkpoint is missing or unloadable the process stays up and /health
reports `unavailable` with the exact reason — deployment tooling treats a
failing /health as the "fail clearly" signal (the load error is also logged
at CRITICAL level at startup).
"""
from __future__ import annotations

from contextlib import asynccontextmanager
import logging
import time
from dataclasses import dataclass
from typing import Any

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse

from app import config, inference
from app.images import (
    ImageValidationError,
    decode_to_rgb,
    resize_pixel_array,
    sniff_signature,
)

logger = logging.getLogger("coffee-model-service")

@dataclass
class ServiceState:
    """Holds the loaded models for the lifetime of the process."""
    predictor: inference.Predictor | None = None
    model_version: str | None = None
    load_error: str | None = None
    # Stage-1 binary health model (Healthy=0 / Unhealthy=1, single sigmoid).
    health_predictor: inference.BinaryHealthPredictor | None = None
    health_threshold: float | None = None
    health_load_error: str | None = None

    @property
    def ready(self) -> bool:
        return self.predictor is not None

    @property
    def health_ready(self) -> bool:
        return self.health_predictor is not None

    @property
    def two_stage_ready(self) -> bool:
        return self.ready and self.health_ready

def create_app() -> FastAPI:
    @asynccontextmanager
    async def lifespan(application: FastAPI):
        state = ServiceState()
        application.state.coffee = state
        version = config.model_version()
        try:
            model = inference.load_keras_model(config.model_path())
            state.predictor = inference.KerasPredictor(model)  # type: ignore[arg-type]
            state.model_version = version
            logger.info("Coffee model loaded — version %s (CPU warmup complete on first request)", version)
        except inference.ModelLoadError as load_error:
            # Fail clearly, but keep the process serving /health so operators
            # (and the Next.js adapter's readiness checks) see the exact reason.
            state.load_error = str(load_error)
            state.model_version = version
            logger.critical("MODEL LOAD FAILED: %s", load_error)
        # Stage-1 binary health model — loaded independently; a failure here
        # never silently disables the two-stage flow (see /predict-health).
        state.health_threshold = config.unhealthy_threshold()
        try:
            health_model = inference.load_keras_model(
                config.health_model_path(), expected_outputs=1
            )
            state.health_predictor = inference.BinaryHealthPredictor(health_model)
            logger.info(
                "Binary health model loaded — Unhealthy threshold %.4f",
                state.health_threshold,
            )
        except inference.ModelLoadError as load_error:
            state.health_load_error = str(load_error)
            logger.critical("BINARY HEALTH MODEL LOAD FAILED: %s", load_error)
        yield
        # Startup-only resource; nothing to dispose besides the reference.
        application.state.coffee = None

    application = FastAPI(
        title="AgriTech Coffee Model Service",
        description=(
            "Internal inference endpoint for the trained coffee plant-health "
            "model (EfficientNetB0, 224×224×3, four sigmoid outputs: miner, "
            "rust, phoma, cercospora)."
        ),
        version=config.model_version(),
        lifespan=lifespan,
    )

    @application.get("/health")
    async def health(request: Request) -> Any:
        state: ServiceState = request.app.state.coffee
        if state.ready:
            return {
                "status": "ready",
                "model_version": state.model_version,
                "classes": list(inference.CLASS_ORDER),
                "thresholds": inference.THRESHOLDS,
                "health_model": {
                    # Stage-1 binary model state is reported explicitly — a
                    # failing binary model NEVER silently disables the
                    # two-stage flow (see /predict-health, which 503s).
                    "status": "ready" if state.health_ready else "unavailable",
                    "threshold": state.health_threshold,
                    "error": state.health_load_error,
                },
            }
        return JSONResponse(
            status_code=503,
            content={
                "status": "unavailable",
                "model_version": state.model_version,
                "error": state.load_error or "The model is not loaded.",
            },
        )

    async def _validate_upload(request: Request, file: UploadFile) -> Any:
        """Shared intake contract for both prediction endpoints: size limits,
        signature sniffing, decode → RGB → 224×224. Raises HTTPException with
        the established status codes; returns the model-ready image."""
        # Refuse oversized uploads before reading the whole body.
        declared = request.headers.get("content-length")
        if declared is not None and declared.isdigit() and int(declared) > config.MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=413, detail="Image is larger than 10 MB.")

        data = await file.read()
        if len(data) == 0:
            raise HTTPException(status_code=400, detail="Empty upload.")
        if len(data) > config.MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=413, detail="Image is larger than 10 MB.")
        if sniff_signature(data) is None:
            raise HTTPException(status_code=415, detail="Unsupported image type. Send JPEG, PNG or WebP.")

        try:
            return resize_pixel_array(decode_to_rgb(data))
        except ImageValidationError as error:
            raise HTTPException(status_code=415, detail=str(error)) from error

    @application.post("/predict")
    async def predict(request: Request, file: UploadFile = File(...)) -> Any:
        state: ServiceState = request.app.state.coffee
        if not state.ready or state.predictor is None or state.model_version is None:
            raise HTTPException(
                status_code=503,
                detail={
                    "error": "Inference is unavailable.",
                    "reason": state.load_error or "The model is not loaded.",
                },
            )

        image = await _validate_upload(request, file)

        started = time.perf_counter()
        try:
            probabilities = state.predictor.predict(image)
        except Exception as error:  # noqa: BLE001 — inference failures never leak internals
            logger.exception("Inference failed")
            raise HTTPException(status_code=500, detail="Inference failed on the server.") from error

        processing_ms = round((time.perf_counter() - started) * 1000, 1)
        return {
            "model_version": state.model_version,
            "classes": list(inference.CLASS_ORDER),
            "probabilities": probabilities,
            "fired": inference.apply_thresholds(probabilities),
            "thresholds": inference.THRESHOLDS,
            "processing_ms": processing_ms,
        }

    @application.post("/predict-health")
    async def predict_health(request: Request, file: UploadFile = File(...)) -> Any:
        """Two-stage prediction.

        Stage 1 — binary health model: p_unhealthy (sigmoid, Healthy=0/1).
          p_unhealthy <  threshold → stage "healthy": the four-disease
            classifier is NOT run and `diseases` is null.
          p_unhealthy >= threshold → stage "unhealthy": the EXISTING
            four-disease classifier runs unchanged and its full output is
            returned under `diseases`.
        Both models must be loaded; any unavailability or inference failure
        surfaces as a clear HTTP error — never a mock or silent fallback."""
        state: ServiceState = request.app.state.coffee
        if not state.two_stage_ready or state.model_version is None or state.health_threshold is None:
            # Explicit reason which of the two stages is missing — operators
            # must be able to tell a missing binary model from a missing
            # disease model at a glance.
            reason = state.load_error or state.health_load_error or "The models are not loaded."
            raise HTTPException(
                status_code=503,
                detail={
                    "error": "Two-stage inference is unavailable.",
                    "reason": reason,
                    "disease_model": "ready" if state.ready else "unavailable",
                    "health_model": "ready" if state.health_ready else "unavailable",
                },
            )

        image = await _validate_upload(request, file)

        started = time.perf_counter()
        try:
            probability_unhealthy = state.health_predictor.predict(image)
        except Exception as error:  # noqa: BLE001
            logger.exception("Binary health inference failed")
            raise HTTPException(status_code=500, detail="Inference failed on the server.") from error

        threshold = state.health_threshold
        unhealthy = probability_unhealthy >= threshold  # inclusive boundary per training spec

        diseases: dict[str, Any] | None = None
        if unhealthy:
            # Stage 2 — the EXISTING four-disease classifier, unchanged.
            try:
                probabilities = state.predictor.predict(image)
            except Exception as error:  # noqa: BLE001
                logger.exception("Disease inference failed")
                raise HTTPException(status_code=500, detail="Inference failed on the server.") from error
            diseases = {
                "classes": list(inference.CLASS_ORDER),
                "probabilities": probabilities,
                "fired": inference.apply_thresholds(probabilities),
                "thresholds": inference.THRESHOLDS,
            }

        processing_ms = round((time.perf_counter() - started) * 1000, 1)
        return {
            "model_version": state.model_version,
            "stage": "unhealthy" if unhealthy else "healthy",
            "health": {
                "probability_unhealthy": probability_unhealthy,
                "threshold": threshold,
                "classification": "unhealthy" if unhealthy else "healthy",
            },
            # null when healthy — the disease classifier was not run, and the
            # response must not pretend it was.
            "diseases": diseases,
            "processing_ms": processing_ms,
        }

    return application

# Standard module (single-worker uvicorn target):
app = create_app()
