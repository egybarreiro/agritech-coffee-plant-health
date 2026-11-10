"""POST /predict-health — the two-stage binary→disease flow.

Proves, without TensorFlow (models stubbed in conftest):
- Stage 1 runs FIRST and its probability routes the image.
- Healthy routing SKIPS the four-disease classifier entirely.
- Unhealthy routing (inclusive boundary >=) INVOKES the existing classifier
  and returns its unchanged output under `diseases`.
- Missing models and inference failures surface as explicit HTTP errors —
  never mock results or silent fallbacks.
- The threshold is configurable via COFFEE_UNHEALTHY_THRESHOLD.
"""
from __future__ import annotations

import io

import pytest
from PIL import Image

from app import inference

THRESHOLD = 0.2244


def image_bytes(fmt: str = "JPEG", mode: str = "RGB", size=(8, 8)) -> bytes:
    buffer = io.BytesIO()
    image = Image.new(mode, size, color=(120, 90, 40))
    image.save(buffer, format=fmt)
    return buffer.getvalue()


def post_image(client, name="hoja.jpg"):
    return client.post(
        "/predict-health",
        files={"file": (name, image_bytes(), "image/jpeg")},
    )


def test_healthy_routing_skips_the_disease_classifier(healthy_leaf_client, monkeypatch):
    """p_unhealthy (0.10) < 0.2244 ⇒ stage 'healthy'; the disease classifier
    must NOT run (spied) and `diseases` must be null."""
    calls = []
    original = inference.KerasPredictor.predict

    def spy(self, image):
        calls.append(image)
        return original(self, image)

    monkeypatch.setattr(inference.KerasPredictor, "predict", spy)

    response = post_image(healthy_leaf_client)
    assert response.status_code == 200
    body = response.json()

    assert body["stage"] == "healthy"
    assert body["health"]["probability_unhealthy"] == 0.10
    assert body["health"]["threshold"] == pytest.approx(THRESHOLD)
    assert body["health"]["classification"] == "healthy"
    assert body["diseases"] is None
    assert "processing_ms" in body
    assert calls == []  # the four-disease classifier never ran


def test_unhealthy_routing_invokes_the_existing_disease_classifier(ready_client, monkeypatch):
    """p_unhealthy (0.87) >= 0.2244 ⇒ stage 'unhealthy'; the EXISTING
    four-disease classifier runs once and its output is returned unchanged."""
    calls = []
    original = inference.KerasPredictor.predict

    def spy(self, image):
        calls.append(image)
        return original(self, image)

    monkeypatch.setattr(inference.KerasPredictor, "predict", spy)

    response = post_image(ready_client)
    assert response.status_code == 200
    body = response.json()

    assert body["stage"] == "unhealthy"
    assert body["health"]["probability_unhealthy"] == 0.87
    assert body["health"]["classification"] == "unhealthy"
    assert len(calls) == 1  # stage 2 ran exactly once

    diseases = body["diseases"]
    assert diseases is not None
    assert diseases["classes"] == ["miner", "rust", "phoma", "cercospora"]
    assert diseases["probabilities"] == {"miner": 0.30, "rust": 0.80, "phoma": 0.05, "cercospora": 0.20}
    assert diseases["fired"] == ["rust"]
    assert diseases["thresholds"] == {"miner": 0.50, "rust": 0.65, "phoma": 0.10, "cercospora": 0.30}


def test_threshold_boundary_is_inclusive(boundary_leaf_client):
    """Exactly at the threshold counts as Unhealthy (>=), per training spec."""
    response = post_image(boundary_leaf_client)
    assert response.status_code == 200
    body = response.json()
    assert body["stage"] == "unhealthy"
    assert body["health"]["probability_unhealthy"] == pytest.approx(THRESHOLD)
    assert body["diseases"] is not None


def test_threshold_is_configurable_via_environment(ready_client, monkeypatch):
    """COFFEE_UNHEALTHY_THRESHOLD moves the routing boundary."""
    monkeypatch.setenv("COFFEE_UNHEALTHY_THRESHOLD", "0.99")
    # Re-create the app so lifespan re-reads configuration.
    from app.main import create_app
    from fastapi.testclient import TestClient

    application = create_app()
    with TestClient(application) as client:
        response = client.post(
            "/predict-health",
            files={"file": ("hoja.jpg", image_bytes(), "image/jpeg")},
        )
    body = response.json()
    assert body["health"]["threshold"] == pytest.approx(0.99)
    # 0.87 < 0.99 ⇒ now routed as Healthy; disease classifier must not run.
    assert body["stage"] == "healthy"
    assert body["diseases"] is None


def test_garbage_threshold_falls_back_to_training_default(ready_client, monkeypatch):
    monkeypatch.setenv("COFFEE_UNHEALTHY_THRESHOLD", "not-a-number")
    from app.main import create_app
    from fastapi.testclient import TestClient

    application = create_app()
    with TestClient(application) as client:
        body = client.post(
            "/predict-health",
            files={"file": ("hoja.jpg", image_bytes(), "image/jpeg")},
        ).json()
    assert body["health"]["threshold"] == pytest.approx(THRESHOLD)


def test_binary_model_missing_is_a_clear_503_not_a_silent_skip(disease_only_client):
    """Disease model ready but binary unavailable ⇒ 503 naming the missing
    stage. It must NEVER fall back to running only the disease model."""
    response = post_image(disease_only_client)
    assert response.status_code == 503
    body = response.json()["detail"]
    assert body["error"] == "Two-stage inference is unavailable."
    assert body["disease_model"] == "ready"
    assert body["health_model"] == "unavailable"
    assert "coffee_health_efficientnetb0_best.keras" in body["reason"]


def test_disease_model_missing_is_a_clear_503(health_only_client):
    """Binary model ready but disease model unavailable ⇒ 503 naming the
    missing stage — the two-stage flow requires BOTH models."""
    response = post_image(health_only_client)
    assert response.status_code == 503
    body = response.json()["detail"]
    assert body["disease_model"] == "unavailable"
    assert body["health_model"] == "ready"
    assert "coffee_efficientnetb0_finetuned_best.keras" in body["reason"]


def test_disease_inference_failure_surfaces_as_500(broken_disease_inference_client):
    """Stage-2 crash ⇒ 500 (internals logged, not returned). Never a mock."""
    response = post_image(broken_disease_inference_client)
    assert response.status_code == 500
    assert response.json()["detail"] == "Inference failed on the server."


def test_binary_inference_failure_surfaces_as_500(broken_health_inference_client):
    """Stage-1 crash ⇒ 500. Never a fabricated healthy/unhealthy verdict."""
    response = post_image(broken_health_inference_client)
    assert response.status_code == 500
    assert response.json()["detail"] == "Inference failed on the server."


def test_no_models_at_all_is_a_clear_503(unavailable_client):
    response = post_image(unavailable_client)
    assert response.status_code == 503
    body = response.json()["detail"]
    assert body["disease_model"] == "unavailable"
    assert body["health_model"] == "unavailable"


def test_upload_validation_matches_the_predict_contract(ready_client):
    # Empty upload → 400.
    assert ready_client.post(
        "/predict-health", files={"file": ("vacio.jpg", b"", "image/jpeg")}
    ).status_code == 400
    # Non-image bytes → 415.
    assert ready_client.post(
        "/predict-health", files={"file": ("nota.txt", b"A" * 1024, "text/plain")}
    ).status_code == 415
    # Corrupt JPEG payload → 415.
    corrupt = b"\xFF\xD8\xFF" + b"garbage" * 64
    assert ready_client.post(
        "/predict-health", files={"file": ("corrupta.jpg", corrupt, "image/jpeg")}
    ).status_code == 415
    # Valid PNG (RGBA source) still accepted.
    assert ready_client.post(
        "/predict-health", files={"file": ("hoja.png", image_bytes("PNG", mode="RGBA"), "image/png")}
    ).status_code == 200


def test_predict_endpoint_is_unchanged_by_the_two_stage_addition(ready_client):
    """The existing single-stage contract must keep working exactly as before."""
    response = ready_client.post(
        "/predict", files={"file": ("hoja.jpg", image_bytes(), "image/jpeg")}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["classes"] == ["miner", "rust", "phoma", "cercospora"]
    assert body["fired"] == ["rust"]


def test_health_reports_the_binary_model_state(ready_client, disease_only_client):
    ready = ready_client.get("/health").json()
    assert ready["status"] == "ready"
    assert ready["health_model"]["status"] == "ready"
    assert ready["health_model"]["threshold"] == pytest.approx(THRESHOLD)
    assert ready["health_model"]["error"] is None

    degraded = disease_only_client.get("/health").json()
    assert degraded["status"] == "ready"  # /predict still works
    assert degraded["health_model"]["status"] == "unavailable"
    assert "coffee_health_efficientnetb0_best.keras" in degraded["health_model"]["error"]
