# Security — Plant Health Application

## Authentication
- Provider: Supabase Auth (email and password).
- Secure sessions are handled by Supabase; application tables do not store plaintext passwords.
- Administrator accounts are provisioned server-side by an existing administrator.
- Email password recovery uses Supabase Auth; new and reset passwords require at least 12 characters. Production must configure HTTPS app URL, redirect allowlist, and outbound email.

## Authorization & Role Enforcement
- Roles: `farmer` and `administrator`.
- Database access is restricted with PostgreSQL Row Level Security (RLS), in addition to server and page checks. Users cannot change their own role. Administrators read protected records; changes to another user's profile and human-review writes run through server routes using the service-role client.
- A trigger prevents authenticated users from changing their own role or removing the last administrator; migration 004 removes direct authenticated-admin profile and analysis write policies so these mutations cannot bypass server validation and audit logging.
- Storage paths include the authenticated owner and plant ID; policies check both the user path and plant ownership.

## Image Storage
- `plant-images` is a private bucket with a 10 MB limit and JPEG, PNG, and WebP allowlist.
- Uploads check the declared MIME type and the file signature; only metadata and storage references are kept in PostgreSQL.
- Image access uses signed URLs or RLS-protected Storage operations.

## Secrets Handling
- The service-role key is server-side only (`lib/supabase/service.ts`).
- Real environment values must be configured outside source control. Never expose the service-role key to browser code.

## Audit Logging
- `audit_logs` records actor, action, entity type, entity ID, and details.
- Inserts use the service role; returned database errors are surfaced to callers.
- Human review records an audit event; if that audit write fails after the review save, the API returns a visible warning.

## Rate Limiting & Input Validation
- Zod validates JSON request bodies.
- JSON API bodies are capped at 64 KiB while streaming; oversized requests receive 413 even if `Content-Length` is absent.
- Image uploads enforce MIME type, binary signature, and 10 MB file size. The request body is read with a hard streaming cap of 10 MB plus 256 KiB multipart overhead, so the cap also applies when `Content-Length` is absent; the stream is cancelled as soon as it exceeds that bound.
- Rate limiting is enforced by Cloudflare Workers bindings, not in application code: login (10/min), farmer provisioning (3/min), recovery (3/min), and photo upload (12/min), keyed by route and client IP. The local Worker preview returned 429 after the configured upload threshold; verify the bindings after deployment because edge counts are approximate and location-scoped.

## Security Testing
- `lib/security.test.ts` checks key SQL policy declarations and role-change trigger protections; it is not a PostgreSQL integration suite.
- Local PostgreSQL transaction checks verified self-role escalation blocking, owner isolation, and farmer denial for analysis updates. A fresh scratch database replayed migrations 001–004 and verified direct administrator profile/analysis writes are denied, service-role review/audit writes succeed, and the private Storage path policy allows an owner while rejecting another user's path. This harness does not replace hosted Supabase Auth/Storage tests.
- Full multi-farmer and staging access tests remain required.

## Known Limitations
- Mobile camera access requires HTTPS in production.
- No automatic inference worker/model is connected; pending uploads need human review.
- Staging Auth, storage, recovery-email delivery, redirect allowlist, authenticated ownership checks, and deployed edge protections have not yet been verified.





