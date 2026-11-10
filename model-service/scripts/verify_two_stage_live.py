"""Live verification: load BOTH checkpoints and run the two-stage flow.

Run from model-service/ with the project venv:
    python scripts/verify_two_stage_live.py
No mock, no stub — the real checkpoints and real TensorFlow.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import config, inference  # noqa: E402
from app.images import decode_to_rgb, resize_pixel_array  # noqa: E402

DISEASE_PATH = config.model_path()
HEALTH_PATH = config.health_model_path()

print(f"disease checkpoint: {DISEASE_PATH} exists={DISEASE_PATH.is_file()} bytes={DISEASE_PATH.stat().st_size:,}")
print(f"health   checkpoint: {HEALTH_PATH} exists={HEALTH_PATH.is_file()} bytes={HEALTH_PATH.stat().st_size:,}")
print(f"threshold (env-configurable, default 0.2244): {config.unhealthy_threshold()}")

disease_model = inference.load_keras_model(DISEASE_PATH)
health_model = inference.load_keras_model(HEALTH_PATH, expected_outputs=1)

print(f"disease model loaded OK — input_shape={disease_model.input_shape} output_shape={disease_model.output_shape}")
print(f"health   model loaded OK — input_shape={health_model.input_shape} output_shape={health_model.output_shape}")

disease_predictor = inference.KerasPredictor(disease_model)
health_predictor = inference.BinaryHealthPredictor(health_model)

test_image = Path(__file__).resolve().parents[1] / "coffee_leaf_test.jpg"
print(f"test image: {test_image} exists={test_image.is_file()}")
image = resize_pixel_array(decode_to_rgb(test_image.read_bytes()))

p_unhealthy = health_predictor.predict(image)
print(f"stage 1 — p_unhealthy = {p_unhealthy:.6f} (threshold {config.unhealthy_threshold()})")

stage = "unhealthy" if p_unhealthy >= config.unhealthy_threshold() else "healthy"
print(f"stage 1 — classification: {stage}")

if stage == "unhealthy":
    probabilities = disease_predictor.predict(image)
    fired = inference.apply_thresholds(probabilities)
    print(f"stage 2 — probabilities = {json.dumps(probabilities)}")
    print(f"stage 2 — fired = {fired}")
else:
    print("stage 2 — correctly NOT run (healthy routing)")

print("LIVE TWO-STAGE VERIFICATION: OK")
