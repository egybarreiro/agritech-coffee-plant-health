# Administrator Bootstrap Procedure

## Purpose

Document how to provision the first administrator in a fresh Supabase project. This procedure must be executed exactly once per deployment environment.

---

## Why the Existing Admin-Only Registration Endpoint Cannot Create the First Administrator

The application's registration endpoint (`app/api/auth/register/route.ts`) requires an **existing authenticated administrator** session:

1. It calls `supabase.auth.getUser()` to verify the caller is authenticated.
2. It queries `public.profiles` via the service-role client and requires `profile.role = 'administrator'`.
3. If no authenticated administrator exists, the endpoint returns `403 Forbidden`.

On a fresh Supabase project, no administrator profile exists in `public.profiles`. Therefore, no authenticated administrator session can be established, and the endpoint cannot be used to create the first administrator. This is a deliberate chicken-and-egg constraint — the first administrator must be provisioned out-of-band through the server-side service-role client.

---

## Secure Server-Side Provisioning Sequence

### Prerequisites

- Access to the Supabase Secret API key (`SUPABASE_SECRET_KEY`, which acts with the `service_role` role) from the Supabase dashboard (Settings → API).
- A secure server-side environment (Node.js, Python, or similar) where the server-side secret key (`SUPABASE_SECRET_KEY`) can be used without exposure to the browser or version control.
- The Supabase project URL (`NEXT_PUBLIC_SUPABASE_URL`).

### Step-by-Step Procedure

#### Step 0: Pre-Execution Verification (read-only, Supabase Dashboard SQL Editor)

Before running the bootstrap, verify the target environment is clean using the
Dashboard SQL Editor (read-only `SELECT`s only):

```
select id, admin_count from public.admin_guard;
-- expect exactly one row: id = 1, admin_count = 0

select count(*) from public.profiles where role = 'administrator';
-- expect 0
```

If either result differs, stop and investigate — do not run the bootstrap.
The SQL Editor is the correct read path for `admin_guard` because migration 007
leaves `admin_guard` with no table privileges for `anon`, `authenticated`, or
`service_role` (deny-by-default RLS).

#### Step 1: Create the Auth User via Service-Role Client

Using the Supabase service-role client, create the first administrator's auth user:

```
serviceClient.auth.admin.createUser({
  email: "admin@example.com",
  password: "<strong-random-password>",
  email_confirm: true,  // Auto-confirm the email
  user_metadata: {
    full_name: "Initial Administrator",
    role: "administrator",
  },
})
```

**Security notes:**
- The service-role key bypasses RLS, but database access remains subject to
  the explicit table privileges granted by migration 007 (e.g., no direct
  privileges on `admin_guard`).
- This operation must be performed from a server-side environment only.
- The service-role key must never be committed to version control or exposed in browser bundles.
- Use a strong, randomly generated password and store it in a secure secrets manager.

#### Step 2: Insert the Profile Row via Service-Role Client

Immediately after creating the auth user, insert the corresponding profile row:

```
serviceClient.from('profiles').insert({
  id: newUserId,       // The auth user ID returned by createUser
  email: "admin@example.com",
  full_name: "Initial Administrator",
  role: 'administrator',
})
```

**Why this order matters:** The `profiles.id` column has a foreign key to `auth.users(id)`. The auth user must exist before the profile can be inserted.

**If the profile insertion fails**, compensate immediately by deleting the
newly created auth user (mirroring the rollback in
`app/api/auth/register/route.ts`):

```
serviceClient.auth.admin.deleteUser(newUserId)
```

This leaves the environment in its original empty state so the procedure can
be retried cleanly. Never write directly to `admin_guard` to "fix" a failed
run — the SECURITY DEFINER trigger is the only legitimate writer of the
counter.

#### Step 3: admin_guard Counter Behavior

The `maintain_admin_counter()` trigger fires AFTER INSERT on `public.profiles`:

- `tg_op = 'INSERT'`, `new.role = 'administrator'` → `net_change = +1`
- The `auth.uid()` self-promotion protection (`auth.uid() is not null` and
  `old.id = auth.uid()`) applies **only to UPDATE** (an authenticated user
  changing their own role); there is no such check on INSERT. This is safe
  because authenticated users cannot INSERT profiles at all: migration 005
  removed the INSERT policy on `public.profiles`, so RLS applies its default
  deny-all, and only trusted server-side service-role provisioning inserts
  profiles.
- The trigger acquires a row-level lock on `admin_guard(id=1)`, reads `admin_count` (initially 0 from migration seeding), computes `tentative = 0 + 1 = 1`
- `tentative < 1` is FALSE → the update proceeds
- `admin_guard.admin_count` is updated to `1`

**Result:** The first administrator is created and the counter is consistent.

---

## Verification Steps

After provisioning, confirm the following. Steps 1–2 use the service-role
client (the required `profiles` SELECT privileges were granted by migration
007); step 3 **must use the Supabase Dashboard SQL Editor** because the
service-role client has no direct privileges on `admin_guard` after migration
007 (deny-by-default RLS).

### 1. Verify the Auth User Exists

```
serviceClient.auth.admin.listUsers()
```
Confirm the admin user appears with `email` and `email_confirmed_at` set.

### 2. Verify the Profile Row Exists

```
serviceClient.from('profiles').select('*').eq('id', adminUserId).single()
```
Confirm:
- `id` matches the auth user ID
- `role = 'administrator'`
- `full_name` and `email` are correct

### 3. Verify the admin_guard Counter (Dashboard SQL Editor)

Run this read-only query in the Supabase Dashboard SQL Editor — **never**
through the service-role client, and never as a write:

```
select (select admin_count from public.admin_guard where id = 1) as guard_count,
       (select count(*) from public.profiles where role = 'administrator') as admin_profiles;
```

Confirm:
- `guard_count = 1`
- `admin_profiles = 1` (exactly one administrator profile)
- `guard_count` and `admin_profiles` are equal

### 4. RLS Blocks Authenticated Profile Insertion

After migrations 005–007, there is **no INSERT policy on `public.profiles` for
any application role** (`profiles_insert_own` was dropped by migration 005 the
same way as the other farmer write policies). With RLS enabled and no
applicable INSERT policy, PostgreSQL's default deny-all applies: an
authenticated user cannot INSERT a profile row with **any** role value, and
`anon` has no privileges at all. The only legitimate insertion paths are the
server-side service-role client (which bypasses RLS via BYPASSRLS and holds
the migration-007 grants) — used by the bootstrap and by
`app/api/auth/register/route.ts` — and the `maintain_admin_counter()` SECURITY
DEFINER trigger, whose only role is to keep `admin_guard` consistent
(last-admin protection: `admin_count` may never drop below 1).

---

## Subsequent Administrator Provisioning

Once the first administrator exists:

1. An administrator logs in through the normal application login flow (`app/api/auth/login/route.ts`).
2. The administrator calls `POST /api/auth/register` with the new user's email, password, and optional full name.
3. The endpoint verifies the caller is an administrator, creates the user via `serviceClient.auth.admin.createUser()`, inserts a `farmer` profile, and logs the action.
4. To create an additional administrator, the administrator would call `register/route.ts` with the new user's details, then separately update the new profile's `role` to `'administrator'` via the service-role client (which bypasses RLS and whose `auth.uid()` is NULL, bypassing the trigger's self-role-change check).

---

## What Not to Do

- **Do not create a public bootstrap endpoint.** This would allow unauthenticated self-registration as administrator.
- **Do not weaken RLS or privileges.** Since migration 005 there is no INSERT policy on `public.profiles` for application roles, so RLS deny-all blocks authenticated users from inserting profiles with any role value. Do not restore such a policy, do not grant application roles privileges on `admin_guard` (`admin_guard` has no privileges for `anon`, `authenticated`, or `service_role` under migration 007, and the SECURITY DEFINER trigger must be its only writer), and never write directly to `admin_guard`.
- **Do not expose or commit `SUPABASE_SECRET_KEY`.** Use server-side environment variables only. (Historical note: earlier versions of this procedure referenced the legacy JWT secret `SUPABASE_SERVICE_ROLE_KEY`, which has been replaced by the Supabase Secret API key.)
- **Do not include real credentials in this document.** Replace all example values with placeholders.

---

## Summary

| Step | Actor | Method | Bypasses RLS? | `auth.uid()` |
|------|-------|--------|---------------|--------------|
| Create auth user | Service-role client | `auth.admin.createUser()` | Yes | NULL |
| Insert profile row | Service-role client | `from('profiles').insert()` | Yes | NULL |
| admin_guard counter | Trigger (SECURITY DEFINER) | AFTER INSERT trigger | N/A | NULL |
| Subsequent farmer creation | Admin via `/api/auth/register` | `auth.admin.createUser()` + `from('profiles').insert()` | Yes | NULL |
| Farmer self-registration | (Not supported) | — | N/A | Authenticated user ID |

---

## Files Referenced

- `supabase/migrations/001_initial_schema.sql` — `profiles` table definition, `role` CHECK constraint
- `supabase/migrations/002_rls_policies.sql` — `profiles` RLS policies, `maintain_admin_counter()` trigger, `admin_guard` table
- `supabase/migrations/005_farmer_write_scope_lockdown.sql` — removes the `profiles` INSERT policy (farmer accounts are administrator-provisioned only)
- `supabase/migrations/007_least_privilege_table_permissions.sql` — grants `service_role` SELECT/INSERT on `profiles` and extends the deny-all posture to `admin_guard` for application roles
- `plant-health-app/lib/supabase/service.ts` — `createServiceClient()` for server-side provisioning
- `plant-health-app/app/api/auth/register/route.ts` — Admin-only farmer registration endpoint (requires existing admin)

---
