# PostgreSQL Migration Test Plan

## Purpose

Reproducible test plan for migrations 001–004 in an isolated PostgreSQL test environment. This plan distinguishes between tests that have been **executed** and tests that are **documented only**.

## Test Environment Requirements

- PostgreSQL 15+ (Supabase-compatible)
- Isolated database (not the production Supabase project)
- `pgcrypto` and `uuid-ossp` extensions available
- A database user with superuser or sufficient privileges to create tables, functions, triggers, and RLS policies
- No connection to or modification of the remote Supabase project

---

## Current Local Validation Status

### Static Checks Performed (separate from transaction checks)

| Check | Result |
|-------|--------|
| Invalid `#` SQL comments in migration 002 | 0 found |
| Dollar-quote pairs balanced | 3 pairs |
| Parentheses balanced | 119 open / 119 close |
| `CREATE FUNCTION` count | 3 (is_admin, is_owner_of_plant, maintain_admin_counter) |
| `CREATE TRIGGER` count | 1 (trg_maintain_admin_counter) |
| `CREATE TABLE` count | 1 (admin_guard) |
| `pg_advisory_xact_lock` removed | Confirmed absent |
| `COUNT(*) FOR UPDATE` removed | Confirmed absent |
| `OLD`/`NEW` in RLS expressions | Confirmed absent |
| All 28 RLS policies present | Confirmed |
| `SECURITY DEFINER set search_path = ''` | Confirmed |
| `REVOKE ALL` on `maintain_admin_counter()` from PUBLIC | Confirmed |
| TypeScript compilation (`tsc --noEmit`) | Zero errors |

**Current evidence:** the existing local Supabase PostgreSQL has migrations 001–003 recorded; migration 004 has not been applied to that database. A separate throwaway database replayed migrations 001–004 successfully with the test-only Auth/Storage shim in `supabase/tests/isolated_auth_harness.sql`. `supabase/tests/isolated_rls_smoke.sql` verified seed data, all nine public tables with RLS, 28 public policies and five Storage policies, farmer profile/plant isolation, self-promotion and self-demotion rejection, private image paths, denied direct administrator writes, service-role review/audit writes, multi-row last-admin rollback, and counter consistency. No remote Supabase project was touched. The shim does not emulate hosted Supabase Auth or Storage completely; staging tests remain required.

---

## Test Plan

### Test Group 1: Migration Application

#### Test 1.1 — Apply Migration 001

**Objective:** Verify all tables, extensions, indexes, triggers, and seed data from migration 001 apply cleanly.

**Steps:**
1. Create a fresh, empty PostgreSQL database.
2. Execute `supabase/migrations/001_initial_schema.sql`.
3. Verify all tables exist: `crops`, `profiles`, `plants`, `plant_images`, `analyses`, `analysis_observations`, `recommendations`, `model_versions`, `audit_logs`.
4. Migration 001 seeds `crops` with `coffee` (*Coffea* spp.) and the historical `cilantro` row, both `is_active = true` at that point; after applying `009_coffee_only_platform.sql` the table contains exactly 1 row (`coffee`).
5. Verify `profiles` table exists with `role` CHECK constraint (`'farmer'`, `'administrator'`).
6. Verify `admin_guard` table does NOT exist yet (it is created in migration 002).

**Expected result:** Migration 001 applies without errors. `crops` has 2 rows. `admin_guard` does not exist.

**Status:** Fresh-database replay not executed; current local database evidence is summarized above.

---

#### Test 1.2 — Apply Migration 002 After Migration 001

**Objective:** Verify migration 002 applies cleanly on top of migration 001.

**Steps:**
1. Start from the post-migration-001 state (Test 1.1).
2. Execute `supabase/migrations/002_rls_policies.sql`.
3. Verify `admin_guard` table exists with exactly 1 row (`id = 1`, `admin_count = 0`).
4. Verify RLS is enabled on all 9 tables.
5. Verify all 28 RLS policies exist.
6. Verify `maintain_admin_counter()` function exists and is `SECURITY DEFINER`.
7. Verify `trg_maintain_admin_counter` trigger exists on `profiles`.

**Expected result:** Migration 002 applies without errors. `admin_guard.admin_count = 0`.

**Status:** Fresh-database replay not executed; current local database evidence is summarized above.

---

### Test Group 2: Profile Creation

#### Test 2.1 — Farmer Profile Creation

**Objective:** Verify an authenticated user can create their own farmer profile.

**Steps:**
1. Insert an auth user record (simulate Supabase Auth user creation).
2. INSERT into `public.profiles` with `id = <auth-user-id>`, `role = 'farmer'`.
3. Verify the profile row was created with `role = 'farmer'`.
4. Verify `admin_guard.admin_count` remains 0.

**Expected result:** Profile created successfully. Counter unchanged at 0.

**Status:** Fresh-database replay not executed; current local database evidence is summarized above.

---

#### Test 2.2 — Rejection of Authenticated Self-Registration as Administrator

**Objective:** Verify an authenticated user cannot INSERT a profile with `role = 'administrator'`.

**Steps:**
1. Create an authenticated session (simulate `auth.uid()`).
2. Attempt INSERT into `public.profiles` with `role = 'administrator'`.
3. Verify RLS rejects the insert (`profiles_insert_own` WITH CHECK requires `role = 'farmer'`).
4. If RLS is somehow bypassed, verify the trigger raises `auth.uid() is not null` exception.

**Expected result:** INSERT rejected with error.

**Status:** Authenticated self-registration with the administrator role was rejected in the isolated smoke test.

---

#### Test 2.3 — Trusted Server-Side Administrator Provisioning

**Objective:** Verify the service-role path can create the first administrator.

**Steps:**
1. Simulate a service-role session (`auth.uid() = NULL`).
2. INSERT into `public.profiles` with `role = 'administrator'`.
3. Verify the profile was created.
4. Verify `admin_guard.admin_count` incremented from 0 to 1.

**Expected result:** Administrator profile created. Counter = 1.

**Status:** Fresh-database replay not executed; current local database evidence is summarized above.

---

### Test Group 3: Role Change Protection

#### Test 3.1 — Prevention of Administrator Self-Demotion

**Objective:** Verify an administrator cannot demote themselves.

**Steps:**
1. Ensure at least 2 administrators exist (provision 2 via service-role).
2. Authenticate as administrator A.
3. Attempt UPDATE `profiles SET role = 'farmer' WHERE id = A`.
4. Verify trigger raises `Cannot change your own role`.

**Expected result:** UPDATE rejected. Both administrators remain.

**Status:** Administrator self-demotion and farmer self-promotion were rejected in the isolated smoke test.

---

#### Test 3.2 — Prevention of Removing the Last Administrator

**Objective:** Verify the last administrator cannot be demoted or removed.

**Steps:**
1. Ensure exactly 1 administrator exists.
2. Attempt UPDATE `profiles SET role = 'farmer' WHERE id = <last-admin-id>`.
3. Verify trigger raises `Cannot remove the last remaining administrator`.
4. Verify `admin_guard.admin_count` remains 1.

**Expected result:** UPDATE rejected. Counter unchanged at 1.

**Status:** Last-administrator deletion was rejected and rollback preserved the counter; the separate demotion form remains untested.

---

#### Test 3.3 — Administrator Promotion of Another User

**Objective:** Verify trusted server-side provisioning can promote a farmer to administrator and update the guard counter.

**Steps:**
1. Ensure at least 1 administrator exists and at least 1 farmer exists.
2. Use the trusted service-role path; authenticated administrator clients do not have direct profile write access after migration 004.
3. Update `profiles SET role = 'administrator' WHERE id = <farmer-id>`.
4. Verify profile updated. Verify `admin_guard.admin_count` incremented.

**Expected result:** Farmer promoted to administrator. Counter incremented.

**Status:** Service-role promotion and guard increment passed in the isolated smoke test; manual admin promotion route is not implemented.

---

#### Test 3.4 — Administrator Demotion of Another User (Not Last Admin)

**Objective:** Verify trusted server-side provisioning can demote another administrator when ≥2 admins exist.

**Steps:**
1. Ensure exactly 2 administrators exist.
2. Use the trusted service-role path; authenticated administrator clients do not have direct profile write access after migration 004.
3. UPDATE `profiles SET role = 'farmer' WHERE id = B` (administrator B).
4. Verify profile updated. Verify `admin_guard.admin_count` decremented from 2 to 1.
5. Verify administrator A remains the only administrator.

**Expected result:** Administrator B demoted. Counter = 1.

**Status:** Service-role demotion and guard decrement passed in the isolated smoke test.

---

#### Test 3.5 — Authenticated Administrator Cannot Bypass Server Mutations

**Objective:** Verify authenticated administrators cannot directly update another profile or an analysis through the Supabase Data API.

**Steps:**
1. Apply migration 004.
2. Authenticate as an administrator.
3. Attempt to update another profile and a pending analysis directly.
4. Verify both updates affect zero rows; confirm the server-side review path uses the service role and writes an audit record.

**Expected result:** Direct writes are denied; service-role review and audit writes succeed.

**Status:** Database policy behavior and service-role writes passed in the isolated smoke test; hosted integration remains pending.

---

### Test Group 4: Multi-Row and Concurrent Operations

#### Test 4.1 — Multi-Row UPDATE Demoting All Administrators

**Objective:** Verify a single multi-row UPDATE cannot demote all administrators.

**Steps:**
1. Ensure exactly 2 administrators exist (A and B).
2. Execute: `UPDATE profiles SET role = 'farmer' WHERE role = 'administrator'`.
3. Verify trigger raises `Cannot remove the last remaining administrator` on the second row.
4. Verify entire transaction rolled back — both A and B remain administrators.
5. Verify `admin_guard.admin_count` remains 2.

**Expected result:** Transaction rolled back. Both admins remain. Counter = 2.

**Status:** Multi-row demotion was rejected; the transaction preserved both administrator profiles and the counter in the isolated smoke test.

---

#### Test 4.2 — Concurrent Administrator Demotions

**Objective:** Verify concurrent demotions are serialized and at least one admin remains.

**Steps:**
1. Ensure exactly 2 administrators exist (A and B).
2. Start Transaction T1: demote administrator A.
3. Start Transaction T2: demote administrator B (concurrent with T1).
4. Observe that one transaction acquires the `admin_guard` row lock first.
5. The second transaction blocks until the first commits or rolls back.
6. If T1 commits first (A demoted, count = 1), T2 reads count = 1 and raises `Cannot remove the last remaining administrator`.
7. Verify exactly 1 administrator remains.

**Expected result:** Serialized execution. Exactly 1 administrator remains. No deadlock involving admin_guard.

**Status:** Not tested; requires two concurrent PostgreSQL sessions.

---

#### Test 4.3 — Deadlock Behavior (Profile Row Level)

**Objective:** Verify profile-level deadlocks are detected and aborted by PostgreSQL without counter corruption.

**Steps:**
1. Ensure 2 administrators exist (A and B).
2. Start Transaction T1: `UPDATE profiles SET role = 'farmer' WHERE id IN (A, B)`.
3. Start Transaction T2: `UPDATE profiles SET role = 'farmer' WHERE id IN (B, A)`.
4. Observe PostgreSQL detects deadlock (SQLSTATE 40P01) and aborts one transaction.
5. Verify the aborted transaction rolled back completely.
4. Verify `admin_guard.admin_count` is consistent with remaining administrator profiles.

**Expected result:** One transaction aborted with deadlock error. Other transaction completes or also aborts. Counter consistent.

**Status:** Not tested; requires two conflicting sessions and lock observation.

---

### Test Group 5: RLS Isolation

#### Test 5.1 — Farmer Cannot Access Another Farmer's Profile

**Objective:** Verify farmer data isolation via RLS.

**Steps:**
1. Create two farmer profiles (farmer A and farmer B).
2. Authenticate as farmer A.
3. Attempt SELECT on farmer B's profile row.
4. Verify RLS blocks access (`profiles_select_own` requires `auth.uid() = id`).

**Expected result:** Farmer A cannot read farmer B's profile.

**Status:** Farmer A could not read farmer B's profile or plant in the isolated smoke test.

---

#### Test 5.2 — Administrator Can Read All Profiles

**Objective:** Verify administrator RLS access.

**Steps:**
1. Create multiple farmer profiles.
2. Authenticate as administrator.
3. SELECT all profiles.
4. Verify administrator can read all profile rows (`profiles_select_all_admin`).

**Expected result:** Administrator reads all profiles.

**Status:** Administrator could read all three profiles in the isolated smoke test.

---

### Test Group 6: Counter Integrity

#### Test 6.1 — Counter Matches Actual Administrator Count After Operations

**Objective:** Verify `admin_guard.admin_count` equals `count(*) FROM profiles WHERE role = 'administrator'`.

**Steps:**
1. Perform a sequence of INSERTs, UPDATEs, and DELETEs that change administrator count.
2. After each operation, compare `admin_guard.admin_count` with `count(*) FROM profiles WHERE role = 'administrator'`.
3. Verify they always match.

**Expected result:** Counter always consistent.

**Status:** Counter matched the profile table after service-role promotion/demotion in the isolated smoke test.

---

#### Test 6.2 — Rollback Preserves Counter Consistency

**Objective:** Verify a failed transaction does not leave the counter inconsistent.

**Steps:**
1. Record `admin_guard.admin_count` before a transaction.
2. Start a transaction that attempts to demote the last administrator.
3. Verify the trigger raises an exception and the transaction rolls back.
4. Verify `admin_guard.admin_count` equals the pre-transaction value.
5. Verify `count(*) FROM profiles WHERE role = 'administrator'` equals `admin_guard.admin_count`.

**Expected result:** Counter unchanged after rollback.

**Status:** Last-administrator deletion rollback preserved one administrator and a counter of 1 in the isolated smoke test.

---

### Test Summary Table

| Test | Description | Status |
|------|-------------|--------|
| 1.1 | Apply migration 001 | Scratch replay and post-migration schema checks passed; intermediate-state assertion pending |
| 1.2 | Apply migration 002 after 001 | Scratch replay and RLS/policy count checks passed |
| 2.1 | Farmer profile creation | Documented only |
| 2.2 | Rejection of authenticated self-registration as admin | Isolated smoke check passed |
| 2.3 | Trusted server-side admin provisioning | Documented only |
| 3.1 | Prevention of self-promotion/self-demotion | Isolated smoke checks passed |
| 3.2 | Prevention of removing last admin | Delete path and rollback checked in scratch; demotion path pending |
| 3.3 | Trusted service-role promotion of another user | Scratch check passed |
| 3.4 | Trusted service-role demotion of another user (≥2 admins) | Scratch check passed |
| 3.5 | Authenticated admin cannot bypass server mutations | Scratch policy checks passed; route/staging pending |
| 4.1 | Multi-row UPDATE demoting all admins | Isolated rollback check passed |
| 4.2 | Concurrent administrator demotions | Documented only |
| 4.3 | Deadlock behavior (profile row level) | Documented only |
| 5.1 | Farmer RLS isolation | Profile and plant ownership checks passed |
| 5.2 | Administrator RLS access | Admin profile reads checked in scratch |
| 6.1 | Counter consistency after operations | Promotion/demotion count checked in scratch |
| 6.2 | Counter consistency after rollback | Last-admin delete rollback checked in scratch |

**The full 17-scenario matrix has not been executed end to end.** The isolated smoke checks cover only the subsets identified in the table; multi-row/concurrency tests and hosted Supabase integration remain outstanding.

---

## Exact Steps to Validate in an Isolated PostgreSQL Environment

1. Use a throwaway Supabase-compatible PostgreSQL instance; never use the app or production database.
2. Create the Auth and Storage test scaffolding with `supabase/tests/isolated_auth_harness.sql`.
3. Apply migrations 001–004 in numeric order and stop on the first SQL error.
4. Run `supabase/tests/isolated_rls_smoke.sql` for the currently verified policy subset.
5. Run and record the remaining cases in this document, especially multi-row and concurrent admin changes.
6. Drop the throwaway database when complete.

---

## Files Created

| File | Purpose |
|------|---------|
| `docs/admin-bootstrap.md` | Initial administrator bootstrap procedure |
| `docs/migration-test-plan.md` | PostgreSQL migration test plan |
| `supabase/tests/isolated_auth_harness.sql` | Auth/Storage scaffolding for a throwaway PostgreSQL database |
| `supabase/tests/isolated_rls_smoke.sql` | Repeatable RLS and service-role smoke checks |

---

## Remaining Risks

1. **Hosted Supabase behavior not verified** — Migrations 001–004 applied in the scratch harness, not a hosted or full Supabase Auth/Storage stack. RLS claim behavior and Storage engine integration still need staging verification.
2. **Deadlock behavior not covered by the local subset** — The matrix describes multi-row and concurrent administrator changes, but those cases have not been executed locally. The application does not automatically retry SQLSTATE 40P01; only add retries for operations proven idempotent if these scenarios or staging evidence require them.
3. **Initial admin bootstrap is manual** — No application endpoint exists to create the first administrator. Manual service-role provisioning is required before the admin registration endpoint can function.
4. **`auth.uid()` in SECURITY DEFINER** — Supabase-specific behavior; last-admin protection does not depend on `auth.uid()` and always applies.

---

## Final Recommendation

The migration files are syntactically valid and the security architecture is sound based on manual review. **Do not apply to production until:**

1. Apply migration 004 in the intended environment and verify authenticated admin writes are denied while the server review path and audit record succeed; execute and record the remaining high-risk counter, concurrency, and cross-farmer cases before production use.
2. Initial administrator bootstrap is performed manually via the service-role client.

---


