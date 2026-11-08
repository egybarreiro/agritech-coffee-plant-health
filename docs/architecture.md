# Architecture — Plant Health Application

## Current product scope

The application lets farmers register coffee (*Coffea* spp.) plants, upload private photos, and view review results. Administrators create farmer accounts and review submitted photos manually. **There is no automatic diagnosis service or background inference worker.** Coffee is the platform's only supported crop.

## Current tiers

```text
CLIENT
Next.js 16 App Router + React + TypeScript + Tailwind
- Farmer login, plants, photo upload, and review history
- Administrator account provisioning and manual review queue

APPLICATION SERVER
Next.js Route Handlers + server components
- Supabase session and role checks
- File validation, private upload coordination, and review writes
- Safe internal redirects and password recovery
- Audit logging for account creation and human reviews

DATA AND STORAGE
Supabase Auth + PostgreSQL + private Supabase Storage
- RLS enforces farmer ownership and administrator access
- Image binaries stay in Storage; PostgreSQL stores metadata/results
```

## Current photo flow

1. A farmer chooses an owned plant and selects/captures a JPEG, PNG, or WebP photo.
2. The server checks declared MIME type, file signature, size, and plant ownership.
3. The server stores the photo at `farmer_id/plant_id/object_id` in the private bucket and records metadata.
4. A `pending` analysis is created. No inference job is enqueued.
5. An administrator opens the review queue, views a short-lived signed URL, and records observations, severity, and follow-up.
6. The farmer sees the result labeled as a human review; no model confidence is invented.

## Future work, not implemented

- A trained and evaluated model for supported crops and conditions.
- A background queue, retry policy, and inference service.
- Verification of Cloudflare rate-limit bindings after deployment, including thresholds and shared-IP behavior.
- Staging verification with separate farmer/admin accounts, SMTP, and Storage.

## Security boundaries

- The service-role key is server-only and used for administrator provisioning and audit logging.
- Farmer database and Storage operations use the authenticated session and RLS.
- Admin pages and APIs check the administrator role server-side.
- Supabase Auth controls email recovery; production redirect URLs and mail delivery must be configured.
