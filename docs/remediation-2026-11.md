# Security Remediation — November 2026

Implemented security remediation, executed in staged forward-only changes.

## Implemented changes

### 1. Server-controlled analysis creation (`app/api/images/route.ts`)

- The `analyses` INSERT moved from the farmer's authenticated SSR client to the
  server-only service-role client (`lib/supabase/service.ts`).
- `status = 'pending'` and safe defaults are fixed server-side. Farmers can
  never choose analysis status, confidence scores, model results, model
  identifiers, or another user's image identifiers.
- Failure handling (Storage and PostgreSQL do not share an atomic transaction):
  - If `plant_images` insert fails after the Storage upload succeeded, the
    implementation performs compensating cleanup of the uploaded object and
    logs cleanup failures explicitly.
  - If the `analyses` insert fails, the image and its metadata are preserved
    as valid records and the existing response contract returns a warning.

### 2. Database migrations (forward-only)

- `005_farmer_write_scope_lockdown.sql`
  - Drops `profiles_insert_own` — farmer accounts are administrator-provisioned
    only through `app/api/auth/register/route.ts`.
  - Drops `analyses_insert_own` — analysis creation is server-controlled only.
  - Drops `plant_images_storage_update_own` and `plant_images_storage_delete_own`
    — original submitted images are immutable evidence for farmers regardless
    of analysis status.
  - Preserves farmer Storage INSERT/SELECT and administrator Storage SELECT
    policies; does not alter `trg_maintain_admin_counter()`, `admin_guard`,
    `profiles_update_own`, `profiles_update_admin`, `is_admin()`,
    `is_owner_of_plant()`.
- `006_unique_analysis_per_image.sql`
  - Duplicate check first: if any `plant_image_id` has multiple analysis rows,
    the migration fails with an explicit message and modifies nothing.
  - Creates unique index `idx_one_analysis_per_image` on
    `public.analyses(plant_image_id)` (one analysis per submitted image;
    reanalysis requires a new image and a new `plant_image_id`).

### 3. Service-role usage boundaries (stage 3)

- Farmer upload: SSR client for authentication, ownership validation, Storage
  upload and `plant_images` insertion; service-role client for the
  server-controlled `analyses` INSERT and, on failure of that flow, the
  narrowly scoped compensating Storage DELETE (see section 4). No
  administrator authorization is required for this farmer-initiated flow.
- Administrator operations (`/api/admin/*`, `/api/auth/register`): the caller
  is authenticated and administrator authorization is verified (middleware +
  `getAdminContext()` / route-level role checks) before privileged use.
- Shared rule: the service-role key never reaches the browser; service-role is
  never a substitute for caller authentication, ownership checks, or
  authorization.

### 4. Compensating Storage cleanup (service-role)

- When the `plant_images` INSERT fails after a successful Storage upload, the
  compensating deletion of the uploaded object runs with the server-only
  service-role client (`app/api/images/route.ts`). This is required because
  migration 005 intentionally removed the farmer Storage DELETE policy: the
  farmer's SSR client can no longer delete, so an earlier version of this fix
  that attempted cleanup with the SSR client would always fail and leave an
  orphaned object.
- The privileged deletion is restricted to the exact `storagePath` generated
  server-side for that request (`farmer_id/plant_id/uuid.ext`, built from the
  authenticated farmer identity and the ownership-verified plant id — never
  client-supplied input). The service-role client is not used for any other
  farmer-facing operation, no farmer JWT or cookies reach it, and its key is
  never exposed to the browser.

## Known limitations

- If the `analyses` INSERT fails after `plant_images` succeeds, the image and
  its `plant_images` record remain on storage without a corresponding analysis
  row. This is a deliberate trade-off: deleting the object there would orphan
  the database row and deleting the row is not automated either. **No automated
  retry or recovery mechanism exists.** Re-submission by the farmer creates a
  new image and plant_image_id pair; the old rows must be reconciled manually.
  This is a known operational/consistency limitation, not a security bypass.

## Deployment steps requiring operator action

1. Apply migrations `005` then `006` in order
   (`supabase db push` or CLI equivalent) against the target project.
2. Verify public Supabase Auth signup is disabled in the **deployed**
   project's Auth settings (dashboard → Authentication → Sign up). The local
   `supabase/config.toml` contains `enable_signup = true`, which only affects
   the local CLI environment and does not prove the deployed setting.
3. After migration 006, decide whether to drop the now-redundant non-unique
   index `idx_analyses_plant_image_id` (optional housekeeping).
