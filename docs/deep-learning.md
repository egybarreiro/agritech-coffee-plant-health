# Deep Learning Support — Plant Health Application (coffee, *Coffea* spp.)

This document explains, for each deep-learning evaluation category, **what this
application already implements and supports** and **what must be supplied by the
separate model-training workstream**. It is a documentation contract, not a
results report: no training statistics are claimed here, because no real coffee
model has been integrated or evaluated from this repository.

---

## 6. Dataset and preprocessing — implemented as requirements

The application does **not** train models; it consumes them through a fixed
adapter interface (`lib/models/types.ts`). Image provenance requirements live on
two sides:

**Application side (implemented):**

- Every submitted photo is validated (MIME type + real file signature
  JPEG/PNG/WebP, ≤ 10 MB, `app/api/images/route.ts`) before it can reach a
  model — the same preprocessing assumptions the training workstream must
  honor for inference inputs.
- Private Supabase Storage bucket with farmer-scoped paths; duplicate images
  upload as distinct objects, and each image has at most one analysis
  (migration `006_unique_analysis_per_image.sql`), preventing duplicate
  assessments.

**Training side (required, supplied by the workstream — NOT yet performed here):**

- Dataset sources with citations, class composition and distribution.
- Labeling method and label evidence (diagnosis source).
- Cleaning/exclusions and duplicate prevention.
- Train/validation/test split ratios.
- Resizing/normalization and augmentation strategy (documented so inference
  preprocessing in `predict()` can mirror it exactly).
- Dataset limitations and licensing, including whether sources permit
  redistribution of model outputs in an academic project.

> ⚠️ No dataset statistics may be entered into this repository's docs or UI
> until the training workstream confirms them. Fabricated numbers are
> expressly prohibited (see project requirements §Responsible diagnosis).

**Puerto Rico domain shift (documented limitation):** public leaf-disease
datasets contain mostly controlled photographs (even lighting, studio or lab
conditions). Farm photos from Puerto Rico — smartphone capture, strong tropical
sunlight, shadows, humid conditions, potted growth habit — will differ. The
real model's generalization to local conditions must be evaluated before
making any claims; AgriTech therefore never states that the model is validated
for Puerto Rico unless that evaluation has actually occurred.

---

## 7. Model development — architecture fully supported

The application reserves and tests this integration surface:

| Need | Where it lives | Status |
|---|---|---|
| Coffee health/disease classification | `PlantModelAdapter.predict()` returns a `conditionKey` + structured prediction | Interface in place (`lib/models/types.ts`) |
| Multiple condition classes | `conditionKey` is a free string; no app constant restricts class count — the real model's actual class list is authoritative | Supported |
| Class probabilities / confidence | `confidence: number` in [0, 1], CHECK-constrained in `analyses.confidence_score`, clamped again by `lib/models/sanitize.ts` | Implemented + tested |
| Model metadata | `id`, `version`, `crop`, `isMock`, `description` persisted to `analyses.model_provider` / `model_version` | Implemented + tested |
| Consistent inference interface | Pipeline resolves the adapter exclusively via `getAdapterForCrop('coffee')` (`lib/models/registry.ts`) | Implemented + tested |
| Deterministic behavior for demos/tests | Contract rule in `types.ts`; the current `mock-coffee` adapter is hash-deterministic | Implemented + tested |

Condition classes currently demonstrated by the clearly-labeled **simulated**
adapter `mock-coffee` (not a trained model): `healthy` and
`foliar-disease-suspected`. These are UX placeholders only — the real model's
condition classes must match its actual training dataset, and the mock classes
impose nothing on it. The real adapter (`coffee-real.ts`) is built around the
trained configuration (four independent sigmoids: miner, rust, phoma,
cercospora) and maps any of them into cautious, non-diagnostic Spanish text;
it is inactive while `COFFEE_MODEL_ENDPOINT` is unset.

---

## 8. Experimentation and optimization — documentation template

The training workstream must supply (none of this is claimed today):

1. Baseline model and its performance.
2. Final architecture (backbone, head, input size).
3. Training configuration: optimizer, learning rate/schedule, batch size,
   epochs, loss, seeds.
4. Optimization experiments and what changed between them.
5. Training/validation history (loss + accuracy curves).
6. Model selection rationale (e.g. best validation macro-F1, early-stop
   criterion).

When the real model lands, record these in this file (or a linked experiment
report) **without replacing** the app's honest "resultado simulado" labeling
contract until `registry.ts` registers the real adapter with `isMock: false`.

---

## 9. Model evaluation — reporting template

Once the real model is evaluated, report **validation metrics and independent
test metrics as separate tables** (never merged):

- Overall accuracy, precision, recall, F1 (macro and weighted).
- Per-class precision/recall/F1.
- Confusion matrix (predictions × true labels).
- Known limitations: class imbalance handling, dataset coverage gaps, and the
  Puerto Rico domain-shift caveat from §6.

Until then, the application honestly communicates uncertainty the only way it
can: every simulated result is flagged ("⚠️ Resultado simulado"), a confidence
percentage is shown, and low-certainty results (< 60%) render an explicit
"honest low-certainty" course of action (re-photograph in better lighting
before acting) — `app/dashboard/history/page.tsx`.

---

## 10. Deployment and inference — architecture in place

| Stage | Implementation |
|---|---|
| Model loading | **In the Python service** (`model-service/app/inference.py`): the `.keras` checkpoint loads ONCE per process at startup (lifespan) — never in the client bundle, never per request. The app side (`coffee-real.ts`) is a stateless HTTP client. |
| Image preprocessing | In the service (`app/images.py`): decode → RGB → 224×224 bilinear → float32 pixels kept 0–255 (EfficientNet preprocessing, no /255). The adapter forwards the ORIGINAL bytes untouched. |
| Inference | `predict()` receives already-validated bytes from `lib/models/pipeline.ts` and POSTs them multipart to `POST <COFFEE_MODEL_ENDPOINT>/predict`. |
| Thresholds + mapping | **Adapter-side (`coffee-real.ts`, authoritative)**: miner ≥ 0.31 · rust ≥ 0.42 · phoma ≥ 0.21 · cercospora ≥ 0.31 (inclusive); confidence = max fired probability, or 1 − max when nothing fires; cautious Spanish mapping with `estimatedSeverity: 'unknown'` while patterns are only suspected. |
| Prediction response | Structured `PlantModelPrediction` persisted to `analyses` (severity, confidence, symptoms, explanations, actions, follow-up) |
| Confidence reporting | `confidence_score` (0–1) rendered as a percentage chip + low-certainty guidance |
| Error handling | Adapters throw (`CoffeeModelServiceError`: not-configured / network / timeout / HTTP status / invalid payload); the pipeline converts failures to `analysis.status = 'failed'` with a farmer-safe Spanish message. No adapter ever writes to the database |
| Activation / fallback | Env-gated: `COFFEE_MODEL_ENDPOINT` configured → real adapter; unset → `mock-coffee` fallback with its simulation banner. Rollback is the same one env var. No schema or UI changes required |

**Hosting the service is still an operational pending item** (Python
3.10–3.13 runtime, checkpoint transfer, private network, `GET /health` → 200):
see `docs/models.md` §Hosting & deployment. Integration code is NOT an
operational claim — results keep the "resultado simulado" labeling until the
service is actually reachable and loaded.

---

## Responsible diagnosis policy (applies to every category)

Regardless of which adapter produces a result, AgriTech always presents:

- **Health status vocabulary** — "Sana" (healthy), "Potencialmente enferma"
  (potentially unhealthy), "Resultado incierto" (uncertain); never a
  definitive phytopathological diagnosis.
- **Multiple plausible causes** for suspected disease (the structured
  `potentialExplanations` list — the simulated flow demonstrates exactly two).
- **Confidence and uncertainty** — percentage chip plus explicit guidance when
  certainty is low.
- **Separation of model output and human review** — `human-review` results are
  visually distinct from model results.
- **A referral route** — expert-inspection flag and the standing disclaimer
  that evaluations are orientative.

The separate field-log (bitácora) keeps the farmer's own observations strictly
apart from automated results.
