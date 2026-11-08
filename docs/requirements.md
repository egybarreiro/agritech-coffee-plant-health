# Requirements & User Stories — Plant Health Application

Scope of this document: the Software Engineering acceptance criteria
(requirements, user stories, system architecture, technical feasibility).
Architecture details live in `docs/architecture.md`; the database and RLS
model in `docs/database-schema.md`; the API surface in `docs/api.md`; the
model contract in `docs/models.md`; the deep-learning support requirements in
`docs/deep-learning.md`.

## 1. Client requirements

Primary client context (Puerto Rico agriculture classroom/hobby context):

- Small-scale farmers growing **coffee** (*Coffea* spp., indoor potted
  cultivation) — the platform's only supported crop.
- Devices: smartphones (camera-first upload, mobile web), Spanish-speaking
  users of varied technical levels.
- Constraints: photos are private per farmer; outcomes must be actionable;
  the system gives orientative results, never a replacement for an agronomist.

Functional requirements (all implemented):

| # | Requirement | Where |
|---|---|---|
| F1 | Farmer self-registration with email confirmation + captcha | `docs/farmer-registration.md`, `/auth/register`, `/auth/confirm` |
| F2 | Administrator creates farmer accounts | `POST /api/auth/register` (admin-only) |
| F3 | Password login/logout, password recovery | `/auth/login`, `/auth/callback`, `POST /api/auth/*` |
| F4 | Register plant units tied to a supported crop | `/dashboard/plants`, `POST /api/plants` |
| F5 | Unique QR labels per unit, scannable deep links | `/dashboard/labels`, `/dashboard/units/[id]/qr`, `/dashboard/scan` |
| F6 | Upload coffee photos: JPEG/PNG/WebP ≤10 MB, real signature check, private storage; each assessment requires one whole-plant framing photo plus one or more `leaf_details` close-ups attached to the same assessment | `POST /api/images`, `lib/images/validation.ts`, `/dashboard/submit` |
| F7 | Automatic model evaluation per photo with status machine | `lib/models/pipeline.ts`, `analyses` status: pending→processing→completed/failed |
| F8 | Prediction display: condition, confidence %, severity, symptoms, preventive/corrective actions, follow-up | `/dashboard/history` |
| F9 | Clearly label simulated (mock) results; never present them as real model output | `isMockProvider` + banner in history page |
| F10 | Human administrator review path (parallel to the model) | `GET/PATCH /api/admin/analyses`, `lib/admin/analysis-review.ts` |
| F11 | Farmer field log (observation diary, no AI result mixups) | `lib/field-log.ts`, unit detail page |
| F12 | Audit trail of administrative actions | `lib/audit.ts`, `audit_logs` |

Non-functional requirements:

- Security: RLS-enforced farmer scoping; service-role key server-only;
  anti-enumeration auth responses; no secrets in client bundles; rate
  limiting on public endpoints.
- Privacy: private Storage bucket, 1-hour signed URLs.
- Usability: Spanish UI, farmer-friendly language, mobile-first responsive
  layouts, publicly stated uncertainty (confidence + low-certainty guidance).
- Reliability: bounded request bodies, compensating cleanup on partial
  failures, non-throwing pipeline (analysis rows end in a defined state).
- Maintainability: typed end-to-end (TypeScript strict), ESLint, Vitest
  (30 files / 208 tests), documented modules.

### Puerto Rico relevance (explicit, unverified claims forbidden)

- Target users: small-scale coffee growers and agriculture classrooms in
  Puerto Rico; Spanish-first, smartphone-first UX.
- The dataset-to-farm domain gap is documented, not hand-waved: public
  leaf datasets are usually clean, controlled photographs, while farm photos
  vary in lighting, angle, background, and image quality. The app asks
  farmers for a full-plant framing plus leaf close-ups partly to give
  reviewers and future models richer evidence.
- Responsibly regulated claims: model generalization to Puerto Rican coffee
  plants is **not** claimed anywhere in the product or docs unless a
  documented local evaluation has been performed (`docs/deep-learning.md`).

## 2. User stories (with acceptance evidence)

**Farmer stories**

1. *Como agricultor nuevo, quiero registrarme con mi correo para empezar a
   usar el sistema.* → Public registration with Turnstile captcha, server-side
   role assignment, token-hash email confirmation (`/auth/confirm`); tests in
   `app/auth/confirm/route.test.ts` and `app/api/auth/register-public/route.test.ts`.
2. *Como agricultor, quiero registrar mis plantas para llevar control por
   unidad.* → Plant creation per supported crop; each plant gets a QR label.
3. *Como agricultor, quiero tomar o elegir una foto de mi planta para saber
   cómo está de salud.* → Camera-first upload (`capture="environment"`),
   client+server validation, private storage, immediate automatic evaluation.
4. *Como agricultor, quiero entender el resultado con certeza y severidad para
   decidir qué hacer.* → History cards show confidence % (with low-certainty
   warning text), severity chips, symptoms, potential explanations,
   preventive/corrective actions, follow-up, and expert-referral flag when
   recommended.
5. *Como agricultor, quiero saber si un resultado viene de un modelo de prueba
   para no tomarlo como definitivo.* → Amber "resultado simulado" banner plus
   an always-visible orientative notice.
6. *Como agricultor, quiero revisar el historial de mis evaluaciones con la
   foto asociada.* → `/dashboard/history` with plant name/filename/signed
   images; unit page links to the history.
7. *Como agricultor, quiero una bitácora propia por unidad independiente del
   diagnóstico.* → Farmer field log sections kept visually separate.

**Administrator stories**

8. *Como administrador, quiero crear cuentas confirmadas para agricultores sin
   que reciban el correo.* → Admin-only registration route.
9. *Como administrador, quiero revisar manualmente evaluaciones pendientes
   cuando el modelo falla o antes de integrar el modelo real.* → Admin review
   queue + PATCH review (severity-linked expert flag; `human-review` stamp).
10. *Como administrador, quiero registrar mis acciones en una auditoría.* →
    `audit_logs` for provision/review actions.

**System stories**

11. *Como sistema, solo debo permitir evaluaciones por el dueño de la foto y
    escrituras de resultados solo por el servidor.* → RLS: farmers read/insert
    own analyses; UPDATE denied (migrations 004/005); pipeline writes via
    service-role client with a conditional `status='pending'` claim.
12. *Como sistema, debo degradar con gracia cuando el modelo falla.* →
    Pipeline never throws to the farmer: row ends `failed` with a fixed
    farmer-safe message; upload still succeeds with a Spanish warning.

## 3. System architecture (summary)

```
Farmer (mobile web, Spanish UI)
  │ Next.js 16 App Router (RSC pages + client components)
  ▼
Route handlers (/api/*) ── Supabase SSR client (anon, RLS) ──► Postgres + Storage
  │                                                            (profiles, crops, plants,
  │                                                             plant_images, analyses,
  │                                                             recommendations, audit_logs)
  ├─ upload: mime+signature validation → Storage → plant_images row → analyses(pending)
  ├─ model pipeline (service-role client): claim pending → crop → adapter
  │    (lib/models registry: real/mock) → sanitize → analyses(completed|failed)
  ├─ admin review: readable queue + server-only completed review writes
  └─ auth: public self-registration (Turnstile + token-hash confirmation),
          admin provisioning, password recovery, rate limits, audit logging
```

Technical feasibility notes:

- All heavy computation lives behind the adapter contract; the app works
  with mock adapters today and real HTTP/ONNX adapters later without UI or
  DB changes (see `docs/models.md`).
- Inference is triggered synchronously after the `pending` insert, which is
  correct for fast adapters; if a real model needs minutes, move the single
  `runPendingAnalysisPipeline(...)` call into a queue/worker — the status
  machine and claim guard already make this safe.
- Deployment target documented in `docs/cloudflare-deployment.md`.
