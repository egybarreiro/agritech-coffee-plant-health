"""Model loading and inference for the coffee EfficientNetB0 checkpoint.

Hard guarantees:
- TensorFlow is imported lazily (inside functions), so the service stays
  importable — and reports a CLEAR "model unavailable" state — even on
  environments where TF is absent or the checkpoint is missing. The service
  never substitutes random/fake predictions: no model ⇒ /predict is 503.
- The model is loaded exactly once per process (lifespan in main.py), never
  per request.
- There is deliberately NO route that serves the checkpoint bytes.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any, Protocol

# ---- Training specs (fixed; must match the trained checkpoint) -------------
CLASS_ORDER: tuple[str, ...] = ("miner", "rust", "phoma", "cercospora")
THRESHOLDS: dict[str, float] = {
    "miner": 0.50,
    "rust": 0.65,
    "phoma": 0.10,
    "cercospora": 0.30,
}
INPUT_SIZE = (224, 224, 3)

class ModelLoadError(RuntimeError):
    """Checkpoint missing/unreadable, TF unusable, or output shape mismatch.

    The message is operator-facing and intentionally explicit: it names the
    environment variable and the check that failed."""

class Predictor(Protocol):
    """Structural type for any object the endpoint can call to obtain the four
    named probabilities. Tests inject a stub — no fake model is ever shipped
    in production code paths."""
    def predict(self, image: Any) -> dict[str, float]: ...

def apply_thresholds(probabilities: dict[str, float]) -> list[str]:
    """Classes whose probability meets or exceeds its threshold, in the
    declared class order. Boundary is inclusive (>=) exactly as specified."""
    fired: list[str] = []
    for name in CLASS_ORDER:
        probability = probabilities.get(name)
        if probability is not None and float(probability) >= THRESHOLDS[name]:
            fired.append(name)
    return fired

def load_keras_model(path: Path, expected_outputs: int = 4) -> Any:
    """Loads `.keras` checkpoint once. Raises ModelLoadError with a clear,
    operator-facing reason for every failure mode.

    `expected_outputs` validates the sigmoid output width: 4 for the
    four-disease classifier, 1 for the stage-1 binary health model."""
    resolved = Path(path)
    if not resolved.is_file():
        raise ModelLoadError(
            f"Checkpoint not found at '{resolved}'. Set COFFEE_MODEL_PATH to "
            "the .keras file (see model-service/checkpoints/ convention in the README)."
        )
    try:
        import tensorflow as tf
    except ImportError as error:  # TF wheels exist only for Python 3.10–3.13
        raise ModelLoadError(
            "TensorFlow could not be imported. Install the pinned dependency "
            "(tensorflow==2.21.0) in an environment with a supported Python "
            f"(3.10–3.13). Original error: {error}"
        ) from error
    try:
        # compile=False: the checkpoint is used for inference only; loading
        # without optimizer state avoids failures if the saver omitted it.
        model = tf.keras.models.load_model(str(resolved), compile=False)
    except Exception as error:  # noqa: BLE001 — any loader failure is a hard stop
        raise ModelLoadError(
            f"The checkpoint at '{resolved}' could not be loaded. Verify it is "
            "the uncorrupted coffee_efficientnetb0_finetuned_best.keras file and "
            f"that this runtime matches the training TensorFlow version. Cause: {error}"
        ) from error

    # Serialization compatibility checks — fail loudly on mismatch rather than
    # producing silently wrong probabilities.
    input_shape = getattr(model, "input_shape", None)
    if input_shape is not None:
        inner = input_shape[1:] if isinstance(input_shape, list) is False else input_shape[0][1:]
        if tuple(inner) != INPUT_SIZE:
            raise ModelLoadError(
                f"Checkpoint input shape {inner} does not match the trained "
                f"contract {INPUT_SIZE} (224×224×3). Wrong checkpoint?"
            )
    output_shape = getattr(model, "output_shape", None)
    if output_shape is not None and tuple(output_shape[-1:]) != (expected_outputs,):
        raise ModelLoadError(
            f"Checkpoint output shape {output_shape} does not produce exactly "
            f"{expected_outputs} sigmoid probabilities (expected (…, {expected_outputs})). "
            "Wrong checkpoint?"
        )
    return model

class KerasPredictor:
    """Wraps the loaded model behind the Predictor protocol. Pixel values stay
    in 0–255 — EfficientNet preprocessing must NOT be divided by 255."""

    def __init__(self, model: Any) -> None:
        self._model = model

    def predict(self, image: Any) -> dict[str, float]:
        """`image` is a PIL RGB Image already resized to 224×224 by
        app.images. Returns the four named sigmoid probabilities."""
        import numpy as np

        pixels = np.asarray(image, dtype=np.float32)  # 0–255, no rescale
        batch = pixels[None, ...]
        outputs = self._model(batch, training=False)
        scores = outputs.numpy()[0]
        if scores.shape != (len(CLASS_ORDER),):
            raise RuntimeError(f"Model returned {scores.shape}; expected 4 probabilities.")
        return {name: float(scores[index]) for index, name in enumerate(CLASS_ORDER)}

class BinaryHealthPredictor:
    """Stage-1 binary health model wrapper (Healthy=0 / Unhealthy=1).

    Same image contract as the disease classifier: a PIL RGB Image already
    resized to 224×224, float32 pixels kept in 0–255 (NO /255 division). The
    single sigmoid output is the probability of Unhealthy."""

    def __init__(self, model: Any) -> None:
        self._model = model

    def predict(self, image: Any) -> float:
        """Returns `p_unhealthy` — the sigmoid probability that the leaf is
        Unhealthy (positive class = 1)."""
        import numpy as np

        pixels = np.asarray(image, dtype=np.float32)  # 0–255, no rescale
        batch = pixels[None, ...]
        outputs = self._model(batch, training=False)
        scores = outputs.numpy()[0]
        if scores.shape != (1,):
            raise RuntimeError(f"Binary health model returned {scores.shape}; expected 1 probability.")
        probability = float(scores[0])
        if not np.isfinite(probability) or probability < 0.0 or probability > 1.0:
            raise RuntimeError(f"Binary health model returned an out-of-range probability: {probability}")
        return probability
