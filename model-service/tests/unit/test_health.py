"""GET /health — readiness and metadata reporting (no TensorFlow needed)."""
from __future__ import annotations


def test_health_is_unavailable_without_checkpoint(unavailable_client):
    """Startup state of THIS repo: the checkpoint has not been transferred
    yet. Service must fail clearly: 503 + explicit reason, no fake status."""
    response = unavailable_client.get("/health")
    assert response.status_code == 503
    body = response.json()
    assert body["status"] == "unavailable"
    assert body["error"]  # explicit, operator-facing reason
    assert "Checkpoint not found" in body["error"] or "TensorFlow" in body["error"]


def test_health_is_ready_with_stubbbed_model(ready_client):
    response = ready_client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ready"
    assert body["model_version"] == "1.0.0-test"
    assert body["classes"] == ["miner", "rust", "phoma", "cercospora"]
    assert body["thresholds"] == {"miner": 0.50, "rust": 0.65, "phoma": 0.10, "cercospora": 0.30}
