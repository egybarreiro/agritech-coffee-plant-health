# AgriTech Coffee Model Service

Independent FastAPI service that serves the **real trained coffee plant-health
models** (`coffee_efficientnetb0_finetuned_best.keras` four-disease classifier
and `coffee_health_efficientnetb0_best.keras` binary Healthy/Unhealthy
classifier, EfficientNetB0, trained in TensorFlow/Keras 2.21.0 in Google
Colab). The Next.js application calls this service over HTTP through its
model-adapter seam (`lib/models/registry.ts`) — the two codebases share no
code.

This service is **inference-only**: it never serves checkpoint files, never
trains, and never replaces an unloadable model with random outputs.

## Contract

| Item | Value |
|---|---|
| Input | single image (JPEG/PNG/WebP, ≤ 10 MB, signature-checked), any RGB-convertible mode |
| Preprocessing | decode → RGB → bilinear resize to **224×224** → float32 pixels kept in **0–255** (EfficientNet preprocessing: **no /255**) |
| Models | two EfficientNetB0 checkpoints, each loaded **once per process** at startup: stage-1 binary health (1 sigmoid, Healthy=0/Unhealthy=1) and the four-disease classifier (4 sigmoids) |
| Stage 1 | `p_unhealthy >= threshold` (default **0.2244**, validation-selected; `COFFEE_UNHEALTHY_THRESHOLD`) ⇒ Unhealthy ⇒ stage 2 runs. Below ⇒ Healthy ⇒ stage 2 is **not** run |
| Stage 2 output | `probabilities = { miner, rust, phoma, cercospora }` — four sigmoid scores in the declared class order |
| Stage 2 thresholds | miner ≥ 0.50 · rust ≥ 0.65 · phoma ≥ 0.10 · cercospora ≥ 0.30 (reported in responses as `fired`) |
| Metadata | `model_version` from `COFFEE_MODEL_VERSION` (must match the app's model documentation) |

## Layout

```text
model-service/
├── app/
│   ├── config.py     # env-based configuration (COFFEE_MODEL_PATH, COFFEE_MODEL_VERSION)
│   ├── images.py     # signature sniffing, decode, RGB conversion, 224×224 resize
│   ├── inference.py  # checkpoint loading, shape checks, thresholds, KerasPredictor
│   └── main.py       # FastAPI app: GET /health, POST /predict
├── tests/unit/       # suite that runs without TensorFlow (model stubbed)
├── checkpoints/      # ← the .keras checkpoint is placed here (gitignored)
├── requirements.txt  # runtime (TensorFlow pinned)
└── requirements-dev.txt  # + pytest/httpx
```

## Where the checkpoint goes

Place `coffee_efficientnetb0_finetuned_best.keras` at:

```text
model-service/checkpoints/coffee_efficientnetb0_finetuned_best.keras
```

(this folder is listed in
`model-service/.gitignore` and the file must **never** be committed), or set
`COFFEE_MODEL_PATH` to any absolute path the service can read. With no file
present the service starts, logs `MODEL LOAD FAILED`, and `/health` returns
`503 { status: "unavailable", error: "Checkpoint not found …" }` — it never
fakes results.

Transferring from Colab is a manual, out-of-band step: download once,
optionally record the SHA-256 in the model documentation, and drop the file
into the location above. `GET /predict`/no download route exists; keep the
bound port on a private network.

## Setup & run

Use a Python **3.10–3.13** interpreter (TensorFlow 2.21.0 has no Python 3.14
wheel — verified on PyPI on 2026-11-07):

```bash
cd model-service
python -m venv .venv
.venv\Scripts\activate            # Windows (macOS/Linux: source .venv/bin/activate)
pip install -r requirements-dev.txt

# run tests (no weights needed)
pytest

# run the service (edit .env first — copy .env.example)
uvicorn app.main:app --host 127.0.0.1 --port 8100 --env-file .env
# health check
curl http://127.0.0.1:8100/health
```

Verify the serialization compatibility once in the deployment environment:

```bash
python -c "import tensorflow as tf, keras; print(tf.__version__, keras.__version__)"
# expect: 2.21.0 <keras-3.x — the same line that saved the checkpoint in Colab
```

## Endpoints

### `GET /health`

```json
{
  "status": "ready",
  "model_version": "1.0.0",
  "classes": ["miner", "rust", "phoma", "cercospora"],
  "thresholds": {"miner": 0.5, "rust": 0.65, "phoma": 0.10, "cercospora": 0.30},
  "health_model": {
    "status": "ready",
    "threshold": 0.2244,
    "error": null
  }
}
```

If the four-disease checkpoint is missing/unloadable: HTTP **503** with
`{ "status": "unavailable", "error": "<explicit reason>" }`. Deployment
tooling should treat a failing /health as the fail-clearly signal (the same
error is logged at CRITICAL during startup). `health_model.status` reports
the stage-1 binary model independently — a binary-model failure never
silently disables the two-stage flow (`/predict-health` returns an explicit
503 naming the missing stage).

### `POST /predict` (multipart `file`)

```json
{
  "model_version": "1.0.0",
  "classes": ["miner", "rust", "phoma", "cercospora"],
  "probabilities": {"miner": 0.31, "rust": 0.84, "phoma": 0.07, "cercospora": 0.22},
  "fired": ["rust"],
  "thresholds": {"miner": 0.5, "rust": 0.65, "phoma": 0.10, "cercospora": 0.30},
  "processing_ms": 142.7
}
```

Error contracts: `400` empty upload · `413` over 10 MB · `415` not JPEG/PNG/WebP
(signatures are sniffed; client headers are untrusted) or undecodable/corrupt
image · `500` inference failure (internals logged, not returned) ·
`503` model not loaded.

`fired` is an informational server-side convenience mirroring the same
thresholds; the TypeScript adapter in the app (`lib/models/coffee-real.ts`)
applies its own authoritative threshold copy when mapping results — its copy
is the contract, this endpoint's `fired` is only a cross-check, and the two
copies may intentionally differ.

### `POST /predict-health` (multipart `file`) — two-stage flow

```json
{
  "model_version": "1.0.0",
  "stage": "healthy",
  "health": {"probability_unhealthy": 0.0812, "threshold": 0.2244, "classification": "healthy"},
  "diseases": null,
  "processing_ms": 210.4
}
```

When `p_unhealthy >= threshold` the response is `stage: "unhealthy"` and
`diseases` carries the existing four-disease classifier output verbatim:

```json
{
  "model_version": "1.0.0",
  "stage": "unhealthy",
  "health": {"probability_unhealthy": 0.8417, "threshold": 0.2244, "classification": "unhealthy"},
  "diseases": {
    "classes": ["miner", "rust", "phoma", "cercospora"],
    "probabilities": {"miner": 0.31, "rust": 0.84, "phoma": 0.07, "cercospora": 0.22},
    "fired": ["rust"],
    "thresholds": {"miner": 0.5, "rust": 0.65, "phoma": 0.10, "cercospora": 0.30}
  },
  "processing_ms": 486.9
}
```

The disease classifier is invoked ONLY on the Unhealthy branch — a Healthy
verdict never runs it and never fabricates `diseases`. Error contracts match
`/predict`, plus: `503` when EITHER model is unavailable (the `detail`
names which stage is missing). The threshold is configurable via
`COFFEE_UNHEALTHY_THRESHOLD` (training-spec default 0.2244, selected on the
validation set to prioritize Unhealthy recall; never tuned on test data).

## Security notes

- The checkpoint is never exposed over HTTP: no static/route path serves the
  model file, and `checkpoints/` is gitignored.
- Operations: bind to a private interface (`127.0.0.1` or internal network);
  if it must ever be publicly reachable, put it behind a bearer-token check
  or an authenticating gateway before exposing it.
- No credentials exist in this service. Do not add API secrets beyond what
  the transport layer needs.

## Scope

Phase 1 of the coffee model integration only. The TypeScript adapter
(`lib/models/coffee-real.ts`), the registry swap, and any application change
are **not** part of this service.
