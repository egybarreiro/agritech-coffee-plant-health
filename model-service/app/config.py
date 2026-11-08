"""Application configuration for the coffee model service.

All configuration arrives from the environment — never from hard-coded
absolute paths. `uvicorn --env-file .env` is the documented way to load the
project's `.env` without adding a dotenv dependency.
"""
from __future__ import annotations

import os
from pathlib import Path

# Singular checkpoint filename (do not put credentials or other files here).
MODEL_FILENAME = "coffee_efficientnetb0_finetuned_best.keras"

# Stage-1 binary health checkpoint (Healthy=0 / Unhealthy=1, single sigmoid).
HEALTH_MODEL_FILENAME = "coffee_health_efficientnetb0_best.keras"

# Documented default: the checkpoints live in model-service/checkpoints/
# (gitignored). Production deployments set COFFEE_MODEL_PATH explicitly.
DEFAULT_MODEL_PATH = Path("checkpoints") / MODEL_FILENAME
DEFAULT_HEALTH_MODEL_PATH = Path("checkpoints") / HEALTH_MODEL_FILENAME

# Mirrors the app's upload contract (app/api/images/route.ts).
MAX_UPLOAD_BYTES = 10 * 1024 * 1024

def model_path() -> Path:
    """Checkpoint location from `COFFEE_MODEL_PATH` (relative paths resolve
    against the process working directory — run uvicorn from model-service/).
    Falls back to the documented relative default when unset."""
    raw = (os.environ.get("COFFEE_MODEL_PATH") or "").strip().strip('"')
    return Path(raw) if raw else DEFAULT_MODEL_PATH

def health_model_path() -> Path:
    """Stage-1 binary checkpoint location from `COFFEE_HEALTH_MODEL_PATH`
    (same resolution rules as model_path)."""
    raw = (os.environ.get("COFFEE_HEALTH_MODEL_PATH") or "").strip().strip('"')
    return Path(raw) if raw else DEFAULT_HEALTH_MODEL_PATH

# Binary routing threshold, selected on the VALIDATION dataset to prioritize
# Unhealthy recall (training spec). Configurable via COFFEE_UNHEALTHY_THRESHOLD
# so deployments can adjust it without a code change; never tuned on test data.
DEFAULT_UNHEALTHY_THRESHOLD = 0.2244

def unhealthy_threshold() -> float:
    """Binary Unhealthy probability threshold (probability >= threshold ⇒
    Unhealthy ⇒ run the four-disease classifier). Invalid/garbage env values
    fall back to the training-spec default rather than guessing."""
    raw = (os.environ.get("COFFEE_UNHEALTHY_THRESHOLD") or "").strip()
    if not raw:
        return DEFAULT_UNHEALTHY_THRESHOLD
    try:
        value = float(raw)
    except ValueError:
        return DEFAULT_UNHEALTHY_THRESHOLD
    return value if 0.0 < value < 1.0 else DEFAULT_UNHEALTHY_THRESHOLD

def model_version() -> str:
    """Version string surfaced in /health and every /predict response.
    Must match docs/technical/model-documentation.md in the app repo."""
    return (os.environ.get("COFFEE_MODEL_VERSION") or "1.0.0").strip()
