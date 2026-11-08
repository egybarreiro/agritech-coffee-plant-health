# API — Plant Health Application

All endpoints are Next.js Route Handlers. Authenticated data routes verify the Supabase session and use row-level security.

## Authentication

### POST /api/auth/login
Body: `{ email: string, password: string }`.
Returns `200 { success: true }` or a generic `401` error to avoid email enumeration.

### POST /api/auth/register
Body: `{ email: string, password: string, full_name?: string }`. New passwords must have at least 12 characters.
Administrator only. Creates a confirmed farmer account using the server-only service-role client. If profile creation or audit logging fails, the route attempts to delete the new Auth user to avoid an incomplete account.

### POST /api/auth/reset-password
Body: `{ email: string }`. Requests a recovery link and returns the same success response for known/unknown accounts or provider errors. The redirect uses `NEXT_PUBLIC_APP_URL` and returns through `/auth/callback` to `/auth/update-password`.

### POST /api/auth/update-password
Authenticated recovery session only. Body: `{ password: string }`; requires at least 12 characters.

### POST /api/auth/logout
Clears the current authenticated session.

## Plants

### GET /api/plants
Farmer only. Returns the active crop catalog and the farmer’s own plants.

### POST /api/plants
Body: `{ name: string, crop_id: string }`. Creates a plant owned by the authenticated farmer.

### PATCH /api/plants
Body: `{ id: string, name: string }`. Renames a plant owned by the authenticated farmer.

## Images

### POST /api/images
Body: `multipart/form-data` with `file` and `plant_id`.
Accepts JPEG, PNG, or WebP up to 10 MB. Checks both declared MIME type and file signature, verifies plant ownership, uploads to the private `plant-images` bucket using the owner/plant/object path required by Storage RLS, inserts image metadata, creates a `pending` analysis record, and immediately runs the model-inference pipeline for it (`lib/models/pipeline.ts`). The response reflects the pipeline's final status (`completed`/`failed`), with a `warning` message when inference could not complete.

## Analyses

### GET /api/analyses
Farmer only. Returns up to 100 of the farmer’s analysis records with plant names and signed private image URLs that expire after one hour.

### POST /api/analyses
Body: `{ plant_image_id: string }`. Creates a pending record for the farmer's own image (or returns the existing record to avoid a repeat submission) and immediately runs the model-inference pipeline for it with the service-role client; the response status reflects the pipeline outcome.

## Human review

### GET /api/admin/analyses
Administrator only. Lists up to 100 pending/processing reviews, related plant/crop/farmer labels, and one-hour signed private image URLs.

### PATCH /api/admin/analyses
Administrator only. Completes a pending review with an assessment, severity, observations, recommended actions, follow-up, and expert-review flag. High or critical severity requires expert follow-up. The record is marked `model_provider: human-review`, `model_version: manual-review-v1`, and has no model confidence score.

**Human review and the model pipeline coexist:** manual administrator reviews are stamped `model_provider: human-review` with no confidence score, while pipeline results are stamped with the provider id from the model registry (`mock-coffee` until the real model is integrated). Results whose provider id starts with `mock` are simulated placeholders, always labeled as such in the farmer UI — they must never be presented as real model output. See `docs/models.md`.

## Error Format

Errors return `{ error: string }` with an appropriate HTTP status.

## Security

- Ownership and role are checked on the server; RLS protects user-scoped database and Storage operations.
- The service-role key is used server-side for farmer provisioning and audit logging, and is never exposed to browser code.






