"""POST /predict — request validation, ordering and response shape.

These tests run WITHOUT TensorFlow: the model is stubbed in conftest, so the
suite proves the HTTP/validation/inference-boundary behavior. The Keras
loading path itself is only exercised in the live-integration step once the
real checkpoint is supplied.
"""
from __future__ import annotations

from app.config import MAX_UPLOAD_BYTES


def test_ready_service_returns_four_named_probabilities(ready_client, jpeg_bytes):
    response = ready_client.post("/predict", files={"file": ("hoja.jpg", jpeg_bytes, "image/jpeg")})
    assert response.status_code == 200
    body = response.json()

    assert body["classes"] == ["miner", "rust", "phoma", "cercospora"]
    # Order of the dict equals the declared class order (JSON object keys preserve it).
    assert list(body["probabilities"]) == body["classes"]
    probabilities = body["probabilities"]
    assert all(isinstance(value, float) and 0.0 <= value <= 1.0 for value in probabilities.values())

    # Threshold decisions computed server-side (informational; the app
    # re-applies them defensively).
    assert body["fired"] == ["rust"]  # stub: rust=0.80 ≥ 0.65, others below
    assert body["model_version"] == "1.0.0-test"
    assert "processing_ms" in body


def test_predict_accepts_png_rgba_and_webp(ready_client, png_rgba_bytes, webp_bytes):
    for filename, data, mime in (
        ("hoja.png", png_rgba_bytes, "image/png"),
        ("hoja.webp", webp_bytes, "image/webp"),
    ):
        response = ready_client.post("/predict", files={"file": (filename, data, mime)})
        assert response.status_code == 200, filename
        assert "probabilities" in response.json()


def test_missing_file_field_is_rejected(ready_client):
    response = ready_client.post("/predict")
    assert response.status_code == 422  # FastAPI field validation
    assert any(field.get("loc", [None, None])[1] == "file" for field in response.json()["detail"])


def test_empty_upload_is_rejected(ready_client):
    response = ready_client.post("/predict", files={"file": ("vacio.jpg", b"", "image/jpeg")})
    assert response.status_code == 400


def test_non_image_bytes_are_rejected_by_signature_check(ready_client):
    data = b"A" * (64 * 1024)  # large text, no image signature
    response = ready_client.post("/predict", files={"file": ("nota.txt", data, "text/plain")})
    assert response.status_code == 415
    assert "JPEG, PNG or WebP" in response.json()["detail"]


def test_corrupt_image_payload_is_rejected(ready_client):
    data = b"\xFF\xD8\xFF" + b"not-really-a-jpeg" * 512  # JPEG magic, garbage body
    response = ready_client.post("/predict", files={"file": ("corrupta.jpg", data, "image/jpeg")})
    assert response.status_code == 415
    assert "decod" in response.json()["detail"].lower()


def test_oversized_upload_is_rejected(ready_client):
    data = b"\xFF\xD8\xFF" + b"0" * (MAX_UPLOAD_BYTES + 1)  # > 10 MB even as garbage
    response = ready_client.post("/predict", files={"file": ("gigante.jpg", data, "image/jpeg")})
    assert response.status_code == 413


def test_declared_content_length_is_rejected_before_full_read(ready_client, jpeg_bytes):
    response = ready_client.post(
        "/predict",
        files={"file": ("hoja.jpg", jpeg_bytes, "image/jpeg")},
        headers={"content-length": str(MAX_UPLOAD_BYTES + 1)},
    )
    assert response.status_code == 413


def test_predict_is_503_when_model_is_not_available(unavailable_client, jpeg_bytes):
    """No model ⇒ clear 503. The service must NEVER invent probabilities."""
    response = unavailable_client.post(
        "/predict", files={"file": ("hoja.jpg", jpeg_bytes, "image/jpeg")}
    )
    assert response.status_code == 503
    body = response.json()
    assert body["detail"]["error"] == "Inference is unavailable."
    assert body["detail"]["reason"]
