"""Shared fixtures for the model-service tests.

No TensorFlow is required to run this suite: unit tests exercise the
validation/threshold/wiring logic, and the models themselves are stubbed at
the registry boundary (`inference.load_keras_model` / predictor `predict`).
The checkpoints are NOT shipped in this repository — that is intentional.
"""
from __future__ import annotations

import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app import inference
from app.main import create_app, ServiceState

DEFAULT_BINARY_PROBABILITY = 0.87  # ≥ 0.2244 ⇒ Unhealthy ⇒ stage 2 runs


class StubDiseaseModel:
    def __init__(self, expected_shape):
        self.input_shape = expected_shape
        self.output_shape = (None, 4)

    def __call__(self, _pixels, training=False):  # never invoked in tests
        raise AssertionError("Stub model should not be called directly")


class StubBinaryModel:
    def __init__(self, expected_shape):
        self.input_shape = expected_shape
        self.output_shape = (None, 1)

    def __call__(self, _pixels, training=False):  # never invoked in tests
        raise AssertionError("Stub model should not be called directly")


@pytest.fixture()
def unavailable_client(monkeypatch):
    """App WITHOUT any loadable model (the startup state of a fresh clone:
    checkpoints not transferred). /health must be 503, both prediction
    endpoints must 503. The loader is forced to fail for BOTH models so this
    fixture stays deterministic even on machines where checkpoints exist."""
    def failing_load(path, expected_outputs=4):
        raise inference.ModelLoadError(f"Checkpoint not found at '{path}'.")

    monkeypatch.setattr(inference, "load_keras_model", failing_load)
    monkeypatch.setenv("COFFEE_MODEL_VERSION", "1.0.0-test")
    application = create_app()
    with TestClient(application) as client:
        yield client


@pytest.fixture()
def ready_client(monkeypatch):
    """App in its READY state with stubbed Keras backends (load instantly,
    return fixed probabilities). Proves the endpoint wiring, validation
    ordering and response shape without requiring TensorFlow or weights."""

    probabilities = {"miner": 0.30, "rust": 0.80, "phoma": 0.05, "cercospora": 0.20}

    def fake_load(path, expected_outputs=4):
        if expected_outputs == 4:
            return StubDiseaseModel((None, 224, 224, 3))
        return StubBinaryModel((None, 224, 224, 3))

    monkeypatch.setattr(inference, "load_keras_model", fake_load)
    monkeypatch.setattr(
        inference.KerasPredictor,
        "predict",
        lambda self, image: dict(probabilities),
    )
    monkeypatch.setattr(
        inference.BinaryHealthPredictor,
        "predict",
        lambda self, image: DEFAULT_BINARY_PROBABILITY,
    )
    monkeypatch.setenv("COFFEE_MODEL_VERSION", "1.0.0-test")

    application = create_app()
    with TestClient(application) as client:
        yield client


@pytest.fixture()
def healthy_leaf_client(monkeypatch, ready_client):
    """Same ready app, but the binary model returns a probability BELOW the
    default threshold (0.2244) ⇒ the leaf routes as Healthy."""
    monkeypatch.setattr(
        inference.BinaryHealthPredictor,
        "predict",
        lambda self, image: 0.10,
    )
    return ready_client


@pytest.fixture()
def boundary_leaf_client(monkeypatch, ready_client):
    """Binary probability EXACTLY at the threshold ⇒ inclusive boundary ⇒
    Unhealthy (stage 2 must run)."""
    monkeypatch.setattr(
        inference.BinaryHealthPredictor,
        "predict",
        lambda self, image: 0.2244,
    )
    return ready_client


@pytest.fixture()
def disease_only_client(monkeypatch):
    """Disease model loaded but the BINARY health model failed to load:
    /predict still works (existing contract), /predict-health must 503 with
    an explicit reason — never a silent stage-1 skip."""
    probabilities = {"miner": 0.30, "rust": 0.80, "phoma": 0.05, "cercospora": 0.20}

    def fake_load(path, expected_outputs=4):
        if expected_outputs == 4:
            return StubDiseaseModel((None, 224, 224, 3))
        raise inference.ModelLoadError("Checkpoint not found at 'checkpoints/coffee_health_efficientnetb0_best.keras'.")

    monkeypatch.setattr(inference, "load_keras_model", fake_load)
    monkeypatch.setattr(
        inference.KerasPredictor,
        "predict",
        lambda self, image: dict(probabilities),
    )
    monkeypatch.setenv("COFFEE_MODEL_VERSION", "1.0.0-test")

    application = create_app()
    with TestClient(application) as client:
        yield client


@pytest.fixture()
def health_only_client(monkeypatch):
    """Binary model loaded but the DISEASE model failed: /predict-health must
    503 with an explicit reason — the two-stage flow needs BOTH models."""
    def fake_load(path, expected_outputs=4):
        if expected_outputs == 4:
            raise inference.ModelLoadError("Checkpoint not found at 'checkpoints/coffee_efficientnetb0_finetuned_best.keras'.")
        return StubBinaryModel((None, 224, 224, 3))

    monkeypatch.setattr(inference, "load_keras_model", fake_load)
    monkeypatch.setattr(
        inference.BinaryHealthPredictor,
        "predict",
        lambda self, image: DEFAULT_BINARY_PROBABILITY,
    )
    monkeypatch.setenv("COFFEE_MODEL_VERSION", "1.0.0-test")

    application = create_app()
    with TestClient(application) as client:
        yield client


@pytest.fixture()
def broken_disease_inference_client(monkeypatch, ready_client):
    """Binary model says Unhealthy but the disease classifier CRASHES: the
    failure must surface as a 500 — never a fabricated/fallback result."""
    def broken_predict(self, image):
        raise RuntimeError("disease inference exploded")

    monkeypatch.setattr(inference.KerasPredictor, "predict", broken_predict)
    return ready_client


@pytest.fixture()
def broken_health_inference_client(monkeypatch, ready_client):
    """Stage-1 inference itself crashes: clear 500 — never a mock result."""
    def broken_predict(self, image):
        raise RuntimeError("binary inference exploded")

    monkeypatch.setattr(inference.BinaryHealthPredictor, "predict", broken_predict)
    return ready_client


# --- image helpers -----------------------------------------------------------

def image_bytes(fmt: str, mode: str = "RGB", size=(8, 8)) -> bytes:
    buffer = io.BytesIO()
    image = Image.new(mode, size, color=(120, 90, 40))
    image.save(buffer, format=fmt)
    return buffer.getvalue()


@pytest.fixture()
def jpeg_bytes():
    return image_bytes("JPEG")


@pytest.fixture()
def png_rgba_bytes():
    return image_bytes("PNG", mode="RGBA")


@pytest.fixture()
def webp_bytes():
    return image_bytes("WEBP")
