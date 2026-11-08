# Public farmer self-registration with Cloudflare Turnstile

Public registration route: `POST /api/auth/register-public` (`app/api/auth/register-public/route.ts`).
Confirmation resend: `POST /api/auth/resend-confirmation` (`app/api/auth/resend-confirmation/route.ts`).
UI: `/auth/register` (`app/auth/register/page.tsx` + `components/public-registration-form.tsx` + `components/turnstile-widget.tsx`).

## Email-confirmation architecture (corrected)

The registration endpoint uses the **standard Supabase Auth `signUp()` flow**
through the anon, non-cookie client `lib/supabase/public-auth.ts`.

Why not `auth.admin.createUser()`?

> Official Supabase documentation (`auth-admin-createuser`):
> "`createUser()` will not send a confirmation email to the user."

A previous iteration used `admin.createUser({ email_confirm: false })`
believing the API would mail the confirmation link; it does not — the farmer
would have been stuck with an unconfirmed account and no email. The current
endpoint:

1. Calls `signUp({ email, password, options: { data, emailRedirectTo } })`
   server-side. signUp() **sends the real signup confirmation email**,
   **preserves the password the farmer chose**, and (with "Confirm email"
   enabled) returns `session: null` — so no session exists in the browser
   until the emailed token-hash link is used at `{app-url}/auth/confirm`.
   (`emailRedirectTo` is stored with Supabase and must be allow-listed; the
   template-based link itself is what the farmer clicks.)
2. Detects duplicate emails from the synthetic-user response (Supabase
   answers `error: null` with a user whose `identities` array is empty and
   sends no email) and answers HTTP 409.
3. Maps "Signups not allowed / signup_disabled" to HTTP 503 with a Spanish
   configuration message — see the manual Supabase step about enabling
   signup below.
4. Inserts the `profiles` row (`role: farmer`) and the audit entry with the
   service client, exactly like the administrator flow.

The signUp client sets `persistSession: false`: even a misconfigured Supabase
project (confirmations turned off) could never persist a login session into
the registration response.

## Confirmation link: token hash (`/auth/confirm`), NOT PKCE

Because the flow above initiates `signUp()` from a **server process**, the
PKCE code verifier — if any were generated — lives in server-side per-request
storage and can never be present in the farmer's browser when they later click
the confirmation link. `exchangeCodeForSession()` in `/auth/callback` would
fail with `pkce_code_verifier_not_found` (the SDK documents exactly this:
"use @supabase/ssr on both the server and client to store the code verifier in
cookies"). Instead, the Confirm signup email links to the first-party route
`/auth/confirm` (`app/auth/confirm/route.ts`) with the Supabase
`{{ .TokenHash }}` variable, and the route verifies the link with
`verifyOtp({ token_hash, type })` — no client-side verifier involved.

Route behavior:

- Accepts only signup-confirmation token hashes: a well-shaped `token_hash`
  and `type` of `email` (the OTC type GoTrue issues for signup confirmations —
  the official ConfirmationURL format is `token_hash=...&type=email`) or
  `signup` (documented legacy alias). Anything else is rejected before any
  Supabase call.
- On success: session cookies (written by the SSR cookie client) are carried
  onto the redirect — `/dashboard` when Supabase returned a session, or
  `/auth/login` (sign in with the chosen password) when it returned none.
- On invalid/expired/already-used tokens, throwing, or any Supabase error:
  redirect to `/auth/login?error=invalid_code` — the same generic notice the
  PKCE callback route uses. Supabase's internal error text and the token hash
  itself are never shown or logged.

## Security model (server-side)

1. **Turnstile is verified server-side.** The browser widget only produces a
   one-time token. `lib/turnstile.ts` exchanges it with
   `https://challenges.cloudflare.com/turnstile/v0/siteverify` using
   `TURNSTILE_SECRET_KEY`. Missing secret ⇒ fail closed (503), network failure
   ⇒ fail closed (400), invalid/expired token ⇒ fail closed (400).
2. **Role is decided on the server.** The zod schema does not have a `role`
   field and strips unknown keys; `farmer` is the only role the endpoint can
   create (metadata and `profiles.role`). A client cannot submit or escalate
   its own role.
3. **Email confirmation required before access.** `signUp()` creates the user
   unconfirmed and sends the confirmation email; middleware (`getUser()`
   fail-closed) and RLS keep protected farmer pages unreachable for
   unconfirmed accounts.
4. **Rate limiting.** `/api/auth/resend-confirmation` allows 1 resend per
   email per 60 s and 8 per connection per hour (`auth.resend({type:'signup'})`
   — the supported resend operation; it never creates accounts and answers an
   identical `{success:true}` regardless of account state, so it never
   reveals whether an email exists); registration allows 3 attempts per IP
   per 10 min (`lib/http/rate-limiter.ts`, in-process).
5. **Consistent JSON errors.** Duplicate email → 409 with a farmer-facing
   message; partial-account failures roll the auth user back and warn in the
   JSON when rollback itself fails. No secrets or internal errors are ever
   returned to the browser.

## Environment variables

`.env.example` documents the layout (copy into `.env.local` locally and into
production secrets):

- `NEXT_PUBLIC_TURNSTILE_SITE_KEY` — public widget key (safe in the browser).
- `TURNSTILE_SECRET_KEY` — **server-only**. Never prefix with `NEXT_PUBLIC_`;
  never log it.

## Manual steps — Cloudflare dashboard (required before this works)

1. Sign in at <https://dash.cloudflare.com> → **Turnstile** → **Add site**.
2. Name the widget (e.g. "AgriTech farmer registration").
3. Under "Domains", add the exact origins: locally `localhost` (and
   `127.0.0.1` if needed), in production your deployed domain
   (e.g. `agritech.example.com`). No port needed; subdomains must match.
4. Create the widget. You receive:
   - **Site key** → `NEXT_PUBLIC_TURNSTILE_SITE_KEY`
   - **Secret key** → `TURNSTILE_SECRET_KEY` (server-side only)

## Manual steps — Supabase dashboard (required in production)

1. **Authentication → Sign In / Up**:
   - Confirm **"Confirm email"** is enabled (the local
     `supabase/config.toml` already ships `email_confirmations = true`; the
     remote project's equivalent must be checked in the dashboard — a remote
     setting, not a migration).
   - Confirm **signup is enabled** (the local config has
     `enable_signup = true`). The public flow uses the standard `signUp()`
     endpoint, so if the remote project had "Allow new users to sign up"
     disabled, registration returns 503
     ("El registro público está deshabilitado…").
   - Keep **CAPTCHA protection for sign ups** DISABLED: the application
     already verifies Turnstile server-side, and Turnstile tokens are
     single-use — a token consumed by our siteverify call would fail a second
     verification inside Supabase.
2. **Authentication → URL Configuration**:
   - **Site URL**: your production origin (e.g. `https://agritech.example.com`).
     The Confirm signup template below builds its link with `{{ .SiteURL }}`, so
     this must be the exact HTTPS origin.
   - **Redirect URLs**: add `{origin}/auth/confirm` (the redirect Supabase
     stores/validates for the signup flow) and keep `{origin}/auth/callback`
     (still used by the password-recovery PKCE flow).
   - Keep `NEXT_PUBLIC_APP_URL` equal to the production origin.
3. **Authentication → Emails → Templates → "Confirm signup"**: replace the
   default template content with a link created from the **`{{ .TokenHash }}`**
   variable, pointing at the application's first-party confirmation route.
   Exact, verified template (the confirmation URL format for signup emails is
   documented by Supabase as `token_hash=...&type=email`):

   ```html
   <h2>Confirm your signup</h2>
   <p>Follow this link to confirm your user:</p>
   <p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email">
     Confirm your email
   </a></p>
   ```

   Notes verified against the installed Supabase conventions
   (`@supabase/auth-js` 2.118.0):
   - `{{ .TokenHash }}` is the documented template variable for constructing
     your own link ("A hashed version of the {{ .Token }}" — Email Templates
     guide; the `verifyOtp` reference states "The `TokenHash` is contained in
     the email templates and can be used to sign in… use the hash for the
     PKCE flow for Server Side Auth").
   - `verifyOtp({ token_hash, type })` is a first-class SDK API
     (`VerifyTokenHashParams`).
   - Use **`type=email`**, not `type=signup`: Supabase's own generated signup
     ConfirmationURL carries `type=email`, and the SDK reference marks
     `signup` as a deprecated verify type (kept as a legacy alias; the
     application's route still accepts it defensively).
   - Do NOT add `&next={{ .RedirectTo }}` to this template — the application
     route decides the redirect destination itself (dashboard when a session
     is returned, login otherwise).
   - Use plain `&` exactly as shown; these templates are Go placeholders, not
     HTML entities.
   - The link token is single-use: a second click lands on the
     "invalid_code" login notice.
4. Optional hardening: also enable **"CAPTCHA protection for sign ups"**
   (Turnstile provider) in Authentication → Sign In / Up with the same
   Turnstile secret and set "Protect sign ups at: moderate". This adds a
   Supabase-side check on ordinary `signUp` calls; this application's
   server-side verification remains the primary gate.
5. **Authentication → Emails**: confirm SMTP is configured (Supabase built-in
   sender has tight daily limits; use custom SMTP for real traffic).

## Testing with Cloudflare's dummy keys (local development)

Turnstile provides official test keys documented at
<https://developers.cloudflare.com/turnstile/troubleshooting/testing/>:

- Site key that always passes (visible): `1x00000000000000000000AA`
- Secret key that always passes: `1x0000000000000000000000000000000AA`
- Secret key that always fails: `2x0000000000000000000000000000000AA`
  (use this pair to verify the 400 "Verificación anti-bots" path locally, and
  that the API never creates an account).

Real widget + real domain is required before production signups.

## Limitations

- The rate limiter is per server process: on multi-instance deployments use a
  shared store, or rely on Cloudflare/Supabase platform limits.
- Supabase sends emails only if SMTP is configured; without it, the
  confirmation email never arrives (users can still be confirmed manually via
  the dashboard's Users table).
- The confirmation link is built by the Confirm signup template with
  `{{ .SiteURL }}`; if the Site URL/redirect configuration points elsewhere,
  the farmer will land on a broken link.
- The emailed token is single-use: opening the link twice (or an email
  security scanner prefetching it) consumes it; a later legit click gets the
  generic "invalid_code" login notice. The farmer can then still use the
  resend endpoint (`/api/auth/resend-confirmation`) to get a fresh link —
  `auth.resend({ type: 'signup', email })` sends the same Confirm signup
  template, so resend remains fully compatible with the token-hash flow, with
  its existing rate limits (1/email per 60 s, 8/IP per hour) and
  anti-enumeration behavior unchanged.
- Partial-failure recovery: Supabase sends the confirmation email *before*
  this endpoint writes the profile/audit rows. If profile or audit fails
  afterwards, the just-created auth user is deleted and the previously
  emailed link becomes inert (the farmer simply retries the registration).
  If the rollback `deleteUser` itself fails, an unconfirmed orphaned auth
  user can remain; the JSON response then carries a `warning` asking to
  inform the system administrator, who can delete it in Authentication →
  Users. Orphaned unconfirmed users cannot sign in and cannot pass the
  middleware, so they hold no access.
- Mocked tests prove the application calls `auth.signUp()` (the operation
  that sends the confirmation email), `verifyOtp({ token_hash, type })` for
  the link, and never `admin.createUser()` for the public flow. Mocks do NOT
  verify real delivery or real token validation; production readiness
  requires the manual end-to-end check (register → mail arrives → click link
  → confirm → sign in) with the configured SMTP and the updated template.
- Production readiness is NOT claimed until: Turnstile widget created, both
  keys configured, the Confirm signup template updated, Supabase mail + URL
  configuration verified end-to-end (register → receive mail → confirm →
  sign in) with manual verification.
