# Model Integration — Plant Health Application

This document is the contract for the coffee (*Coffea* spp.)
deep-learning model
(developed and trained in a separate workstream) to be integrated into the
application **without touching any other application code**.

## Where the integration point lives

```
lib/models/
  types.ts       — the integration contract (read this first)
  registry.ts    — env-gated selection: real adapter when configured, mock otherwise
  coffee-real.ts — REAL adapter: HTTP client for the Python FastAPI model service
  sanitize.ts    — defensive normalization applied to every prediction
  pipeline.ts    — pending → processing → completed | failed orchestration
  mock-coffee.ts — clearly-labeled placeholder adapter (documented fallback)
```

The pipeline resolves the active adapter **only** through
`getAdapterForCrop('coffee')`. Which adapter that returns is decided in
`registry.ts` from `COFFEE_MODEL_ENDPOINT`: configured →
`coffee-efficientnetb0` (real), unset/blank/invalid → `mock-coffee`
(fallback). Nothing else moves when the real model goes live or when it must
be rolled back to the mock.

## The adapter contract (`lib/models/types.ts`)

```ts
interface PlantModelAdapter {
  id: string            // persisted to analyses.model_provider
  version: string       // persisted to analyses.model_version
  crop: 'coffee'
  isMock: boolean       // true ONLY for placeholder/simulated models
  description: string
  predict(input: PlantModelInput): Promise<PlantModelPrediction>
}
```

Rules:

1. `predict()` receives validated image bytes (`Uint8Array`, MIME type,
   filename) and resolves with a complete `PlantModelPrediction` — or throws.
   Adapters never write to the database and never swallow errors.
2. `confidence` is a probability in [0, 1]. `sanitize.ts` clamps and
   re-validates it anyway; invalid outputs degrade to `unknown` severity
   rather than breaking the workflow.
3. Farmer-facing text fields (`generalHealthAssessment`, symptoms, actions,
   follow-up) are Spanish strings rendered verbatim in the UI.
4. Adapters MUST be deterministic for identical input (models are, mocks are
   by design), which keeps demos and tests reproducible.

### Prediction shape persisted to `analyses`

| Prediction field | Table column |
|---|---|
| `confidence` | `confidence_score` (0–1 CHECK) |
| `estimatedSeverity` | `estimated_severity` (enum CHECK) |
| `generalHealthAssessment` | `general_health_assessment` |
| `detectedSymptoms` | `detected_symptoms` (jsonb array) |
| `potentialExplanations` | `potential_explanations` (jsonb array) |
| `recommendedPreventiveActions` | `recommended_preventive_actions` |
| `recommendedCorrectiveActions` | `recommended_corrective_actions` |
| `followUpInstructions` | `follow_up_instructions` |
| `expertInspectionRecommended` | `expert_inspection_recommended` |

`model_versions` remains a manually maintained audit table; the pipeline does
not write to it (farmers can never insert model versions, and no migration
creates an automatic register — if the grader wants automatic registration,
add it when a real model lands).

## The real adapter (implemented): `lib/models/coffee-real.ts`

The TypeScript side of the real-model integration is **implemented and
tested** (`coffee-real.test.ts` with a mocked `fetch`). What it does:

- POSTs the **original image bytes** (multipart field `file`) to
  `POST <COFFEE_MODEL_ENDPOINT>/predict` — all preprocessing (decode → RGB →
  224×224 → float32 0–255, no /255) lives in the Python service.
- Applies the **classification thresholds locally** (adapter-authoritative,
  inclusive `>=`): miner ≥ 0.31 · rust ≥ 0.42 · phoma ≥ 0.21 · cercospora ≥ 0.31.
  The service's `fired` field is informational (its own copy may differ) and
  is deliberately not consumed.
- **Confidence rule**: when one or more thresholds fire, the highest
  probability among the fired classes; when none fires, `1 − highest
  probability`. Severity is honestly reported as `unknown` while patterns are
  suspected (four independent sigmoids do not grade severity).
- Maps the fired classes into the farmer-facing Spanish
  `PlantModelPrediction` with **cautious, non-diagnostic** language: detected
  patterns are described as *possible causes requiring direct inspection*;
  every treatment decision defers to a técnico agrícola; suspected disease
  sets `expertInspectionRecommended: true`.
- Wrap every HTTP call in a configurable timeout
  (`COFFEE_MODEL_SERVICE_TIMEOUT_MS`, default 15000 ms) via
  `AbortController`, and map every failure (unconfigured endpoint, network
  error, timeout, non-2xx, malformed/out-of-range payload) to a typed
  `CoffeeModelServiceError` — the pipeline converts the throw into
  `analyses.status = 'failed'` with a farmer-safe message.
- Exposes `checkCoffeeModelService()` probing `GET /health` for readiness
  tooling and demos.

**Activation is one environment variable.** Set `COFFEE_MODEL_ENDPOINT` to
the base URL of the hosted FastAPI service (see `.env.example`). With it
unset, `registry.ts` keeps serving `mock-coffee` — the simulation banner
("⚠️ Resultado simulado", driven by `isMockProvider`) also disappears and
reappears automatically with the same configuration.

### Hosting & deployment of the model service (separate, still pending)

Model **integration** (application code) and model **hosting** (operations)
are different disciplines with different owners:

1. Transfer the trained checkpoint OUT-OF-BAND into
   `model-service/checkpoints/coffee_efficientnetb0_finetuned_best.keras`
   (gitignored — weights never enter Git and are never served over HTTP).
2. Run the FastAPI service on Python **3.10–3.13** (TensorFlow 2.21.0 has no
   wheel beyond 3.13 — verified on PyPI, 2026-11-07); verify serialization
   compatibility with `python -c "import tensorflow as tf, keras;
   print(tf.__version__, keras.__version__)"`.
3. Host it on a private network (`uvicorn app.main:app`); `GET /health` →
   200 is the readiness gate. Only then set `COFFEE_MODEL_ENDPOINT` in the
   app's environment.
4. Until step 3 succeeds, `isMockProvider` keeps labeling results as
   simulated — the system can never present real-model output that the
   service has not actually produced.

## Request/response example (what the adapter feeds/pulls)

Input (built by the pipeline):

```json
{ "imageBytes": "<raw file bytes>", "mimeType": "image/jpeg", "filename": "hoja.jpg" }
```

The adapter forwards these bytes to the service, which answers (curl-shaped):

```json
{
  "model_version": "1.0.0",
  "classes": ["miner", "rust", "phoma", "cercospora"],
  "probabilities": { "miner": 0.87, "rust": 0.22, "phoma": 0.05, "cercospora": 0.28 },
  "fired": ["miner"],
  "thresholds": { "miner": 0.5, "rust": 0.65, "phoma": 0.1, "cercospora": 0.3 },
  "processing_ms": 142.7
}
```

The adapter applies ITS OWN thresholds (0.31/0.42/0.21/0.31) and maps the
result into the standardized prediction it returns to the pipeline:

```json
{
  "conditionKey": "coffee-foliar-disease:miner",
  "generalHealthAssessment": "El modelo detectó patrones con probabilidad superior a su umbral de referencia para: minador de hoja. Estos patrones son una señal, no un diagnóstico definitivo: son posibles causas que requieren inspección directa para confirmarse.",
  "confidence": 0.87,
  "estimatedSeverity": "unknown",
  "detectedSymptoms": ["Se observan patrones compatibles con minado de hoja: galerías o líneas serpenteantes dentro del tejido foliar."],
  "potentialExplanations": ["Posible minador de la hoja u otro insecto cuyas larvas excavan galerías dentro de las hojas del café."],
  "recommendedPreventiveActions": [
    "Riega el sustrato sin mojar el follaje y mantiene ventilación alrededor de la planta.",
    "Revisa el envés de las hojas nuevas cada semana y retira las hojas con lesiones usando una herramienta desinfectada."
  ],
  "recommendedCorrectiveActions": ["Fotografía las galerías observadas y consulta con un técnico agrícola el manejo antes de aplicar cualquier producto."],
  "followUpInstructions": "Repite la evaluación con fotografías nuevas en 7 días; si las señales avanzan a hojas nuevas, solicita una revisión presencial.",
  "expertInspectionRecommended": true
}
```

## Current state (env-gated: mock default, real when configured)

- The real-model integration code (`coffee-real.ts` + env-gated `registry.ts`
  + tests) is implemented and green. **This does not mean the real model is
  operational**: until the `.keras` checkpoint is transferred and the FastAPI
  service actually loads it, the endpoint stays unset and coffee runs on the
  clearly-labeled deterministic mock (`mock-coffee`), spread over healthy /
  low-certainty healthy / one foliar condition.
- When `COFFEE_MODEL_ENDPOINT` is configured, results come from the model
  service and show NO simulation banner. Every consumer checks
  `isMockProvider(model_provider)`: the history page shows an amber
  "⚠️ Resultado simulado" banner on mock results. Human reviews
  (`human-review`) keep their own banner.
