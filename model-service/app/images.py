"""Image intake: validation, decoding, RGB conversion, model-ready resizing.

Boundary behavior mirrors the upload API contract in the Next.js app
(JPEG/PNG/WebP, ≤ 10 MB, real signature check) so a patched client cannot
sneak around the app and feed the service something the app would reject.

Preprocessing contract (from the training specs):
- decode → convert to RGB (handles RGBA/L/palette sources)
- resize to 224 × 224 (bilinear, matching the layout Keras `Resizing` layers use)
- pixel values stay in the 0–255 range — EfficientNet's tf.keras
  `preprocess_input` is a 0–255 passthrough and NO /255 division is applied.
"""
from __future__ import annotations

import io
from dataclasses import dataclass

from PIL import Image, UnidentifiedImageError

INPUT_SIZE = (224, 224)

class ImageValidationError(ValueError):
    """Raised for bytes that do not constitute an acceptable image.

    `message` is safe to return to the caller (no internals leak)."""

@dataclass(frozen=True)
class Signature:
    mime: str
    ext: str

# Real file signatures (magic bytes) — content-type headers are client claims,
# never trusted.
SIGNATURES: tuple[tuple[bytes, Signature], ...] = (
    (b"\xFF\xD8\xFF", Signature("image/jpeg", "jpg")),
    (b"\x89PNG\r\n\x1a\n", Signature("image/png", "png")),
    (b"RIFF", Signature("image/webp", "webp")),  # + `WEBP` at offset 8
)

def sniff_signature(data: bytes) -> Signature | None:
    if data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        return SIGNATURES[2][1]
    for magic, signature in SIGNATURES[:2]:
        if data.startswith(magic):
            return signature
    return None

def decode_to_rgb(data: bytes) -> Image.Image:
    """Sniffs, rejects non-image data, decodes and converts to RGB.
    Raises ImageValidationError for anything unusable (English messages —
    this is an internal service boundary, not farmer-facing text)."""
    if sniff_signature(data) is None:
        raise ImageValidationError("Unsupported image type. Send JPEG, PNG or WebP.")
    try:
        image = Image.open(io.BytesIO(data))
        image.load()
    except (UnidentifiedImageError, OSError, ValueError) as error:
        raise ImageValidationError("The uploaded file could not be decoded as a valid image.") from error
    return image.convert("RGB")  # RGBA/L/palette/grayscale sources handled

def resize_pixel_array(image: Image.Image) -> Image.Image:
    """Bilinear resize to the model's 224×224 input (antialias off matches the
    default of Keras `Resizing(layers)` interpolation settings)."""
    return image.resize(INPUT_SIZE, Image.BILINEAR)
