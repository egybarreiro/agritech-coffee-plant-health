# Historical Review — Phase 3 Database and Security Preparation

> Historical Phase 3 review. This document predates the Phase 4 features and local PostgreSQL checks. Its statements are not current status; see `docs/project-status.md`, `docs/security.md`, and `docs/migration-test-plan.md` for the current evidence.

## Purpose

This document provides a final, independent review of the migration files and application code prior to Supabase migration. All statements are based on direct inspection of the actual SQL files and application code, not on prior reports.

---

## Files Reviewed

| File | Path | Status |
|------|------|--------|
| Migration 001 | `supabase/migrations/001_initial_schema.sql` | Reviewed |
| Migration 002 | `supabase/migrations/002_rls_policies.sql` | Reviewed |
| Service client | `plant-health-app/lib/supabase/service.ts` | Reviewed |
| Registration route | `plant-health-app/app/api/auth/register/route.ts` | Reviewed |

---

## 1. Profile Creation Flows

### 1.1 Farmer Registration Flow

**Application code:** `app/api/auth/register/route.ts`

There is **no public farmer self-registration endpoint**. The only registration endpoint requires an authenticated administrator:

1. `supabase.auth.getUser()` verifies the caller is authenticated.
2. `serviceClient.from('profiles').select('role').eq('id', user.id).single()` verifies `profile.role = 'administrator'`.
3. If not an administrator, returns `403 Forbidden`.
4. Creates the user via `serviceClient.auth.admin.createUser()` with `role: 'farmer'` in user_metadata.
5. Inserts profile with `role = 'farmer'` via service-role client.

**Confirmed behavior:** An authenticated farmer **cannot** create their own profile through this endpoint — administrator authentication is required.

### 2. Admin Provisioning Flow

**Application code:** `app/api/auth/register/route.ts` (same endpoint, requires existing admin)

**Server-side provisioning path:** `lib/supabase/service.ts` — `createServiceClient()` creates a Supabase client using `SUPABASE_SERVICE_ROLE_KEY`, bypassing RLS.

**Bootstrap sequence (manual, not implemented in application):**

1. Create auth user via `serviceClient.auth.admin.createUser()` with `role: 'administrator'` in user_metadata.
2. Insert profile row via `serviceClient.from('profiles').insert({ id: userId, role: 'administrator', ... })`.
3. Trigger fires: `tg_op = 'INSERT'`, `new.role = 'administrator'` → `net_change = +1`. `auth.uid()` is NULL for service-role → INSERT self-promotion check skipped. `net_change = +1`, guard counter goes from 0 → 1.

**Bootstrap problem:** On a fresh project, no administrator exists. The `register/route.ts` endpoint requires an existing authenticated administrator (`profile.role = 'administrator'`). Therefore, the first administrator **cannot** be created through the application endpoint. Manual service-role provisioning is required (documented in `docs/admin-bootstrap.md`).

### 3. Trigger Behavior

**File:** `supabase/migrations/002_rls_policies.sql`, lines 100-166

**Farmer registration (INSERT role = 'farmer'):**
- `tg_op = 'INSERT'`, `new.role = 'farmer'` → `net_change = 0` (not 'administrator') → trigger skips counter update.
- Counter unchanged at 0.

**Authenticated farmer attempts INSERT role = 'administrator':**
- RLS policy `profiles_insert_own` (line 188-190): `with check (auth.uid() = id and role = 'farmer')` → REJECTED at RLS layer.
- If RLS were bypassed, trigger line 135-139: `tg_op = 'INSERT'`, `new.role = 'administrator'`, `auth.uid() is not null` → RAISE exception.

**Service-role administrator creation (INSERT role = 'administrator'):**
- RLS bypassed (service-role client).
- Trigger: `auth.uid()` is NULL → INSERT self-promotion check skipped (`auth.uid() is not null` is FALSE).
- `net_change = +1`, guard counter incremented.
- Allowed.

**Confirmed:** All three flows behave correctly.

---

## 4. Deadlock Handling in Application Code

**Finding: No deadlock handling exists in application code.**

I searched `app/` and `lib/` directories for:
- SQLSTATE `40P01` — not found
- Deadlock detection/retry logic — not found
- Transaction management (`BEGIN`, `COMMIT`, `ROLLBACK`) — not found

The `register/route.ts` makes independent Supabase client calls (Auth API + DB insert + audit log insert), not a single database transaction. Deadlocks are not possible in this code path.

**However**, deadlocks ARE possible if:
- Multiple profile updates occur in separate statements within a single transaction
- Multi-row UPDATE statements are issued
- Concurrent transactions update overlapping profile rows in different orders

**Recommendation:** Add application-level retry logic for SQLSTATE `40P01` with:
- Exponential backoff (100ms, 200ms, 400ms)
- Maximum 3 retry attempts
- Only retry idempotent operations

**Not recommended:** Blind retries on non-idempotent operations (e.g., `auth.admin.createUser()` creates a new user each time).

**No retry logic was added** because no existing application operation demonstrably requires it at this time.

---

## 5. Migration File Validation

### Migration 001 (`supabase/migrations/001_initial_schema.sql`)

| Element | Status |
|---------|--------|
| `uuid-ossp`, `pgcrypto` extensions | Present |
| `crops` table with the historical `coffee`/`cilantro` seed rows (migration `009_coffee_only_platform.sql` later removes `cilantro`) | Present |
| `profiles` table with `role` CHECK constraint | Present |
| `plants`, `plant_images`, `analyses`, `analysis_observations`, `recommendations`, `model_versions`, `audit_logs` tables | Present |
| `updated_at` triggers on `profiles`, `plants`, `analyses` | Present |
| No invalid `#` SQL comments | Confirmed |
| Dollar-quote pairs balanced | Confirmed |

### Migration 002 (`supabase/migrations/002_rls_policies.sql`)

| Element | Location | Status |
|---------|----------|--------|
| `admin_guard` table | Line 63-67 | Present |
| `REVOKE ALL` on `admin_guard` from `authenticated`/`anon` | Lines 71-72 | Present |
| `admin_guard` seed from `profiles` | Lines 76-79 | Present |
| `maintain_admin_counter()` SECURITY DEFINER function | Lines 100-166 | Present |
| `set search_path = ''` | Line 166 | Present |
| `REVOKE ALL` on function from PUBLIC | Line 170 | Present |
| `trg_maintain_admin_counter` trigger | Lines 172-175 | Present |
| `profiles_insert_own` WITH CHECK `role = 'farmer'` | Line 190 | Present |
| INSERT self-promotion block | Lines 135-139 | Present |
| UPDATE self-role-change block | Lines 126-130 | Present |
| All 28 RLS policies | Throughout | Present |
| No `pg_advisory_xact_lock` | — | Confirmed absent |
| No `COUNT(*) FOR UPDATE` | — | Confirmed absent |
| No `OLD`/`NEW` in RLS expressions | — | Confirmed absent |

**TypeScript compilation:** `tsc --noEmit` — zero errors.

---

## 6. Files Created in This Session

| File | Purpose |
|------|---------|
| `docs/admin-bootstrap.md` | Initial administrator bootstrap procedure |
| `docs/migration-test-plan.md` | PostgreSQL migration test plan |
| `docs/final-review.md` | This final review document |

No existing code files were modified.

---

## 7. Remaining Risks

| Risk | Severity | Notes |
|------|----------|-------|
| SQL not executed against live PostgreSQL | High | All validation is manual code review. Migration has not been run against a live database. |
| Deadlock handling | Medium | SQLSTATE 40P01 possible in multi-statement/multi-row UPDATE scenarios. No application retry logic exists. |
| Initial admin bootstrap | Medium | No application code path creates the first admin. Manual service-role provisioning required. |
| `auth.uid()` in SECURITY DEFINER | Low | Supabase-specific behavior. Last-admin protection does not depend on `auth.uid()`. |
| Superuser bypass | Low | PostgreSQL superuser can bypass all application-level controls (unavoidable). |

---

## 8. Exact Steps to Validate Migrations in Isolated PostgreSQL Environment

1. Install PostgreSQL 15+ locally or in a container.
2. Create a test database: `createdb plant_health_test`
3. Enable extensions:
   ```sql
   CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
   CREATE EXTENSION IF NOT EXISTS "pgcrypto";
   ```
4. Execute migration 001:
   ```bash
   psql -d plant_health_test -f supabase/migrations/001_initial_schema.sql
   ```
5. Verify migration 001: verify `crops` table exists with its seed rows (after also applying `009_coffee_only_platform.sql`, exactly 1 row: `coffee`), `profiles` table exists.
6. Execute migration 002:
   ```bash
   psql -d plant_health_test -f supabase/migrations/002_rls_policies.sql
   ```
7. Verify migration 002: verify `admin_guard` table exists with 1 row (`id=1`, `admin_count=0`), RLS enabled on all 9 tables.
8. Run tests from `docs/migration-test-plan.md` (Tests 1.1 through 6.2).
9. Drop test database: `dropdb plant_health_test`

---

## Final Recommendation

**DO NOT APPROVE for production migration without:**

1. **Executing migrations 001 and 002 against an isolated PostgreSQL test environment** and verifying all 16 tests from `docs/migration-test-plan.md` pass.
2. **Performing initial administrator bootstrap** via manual service-role provisioning (documented in `docs/admin-bootstrap.md`).
3. **Adding deadlock retry handling** (SQLSTATE 40P01) for idempotent database operations if multi-statement/multi-row UPDATE patterns are used.

The migration files are syntactically valid and the security architecture is sound based on manual review. However, SQL execution against a live PostgreSQL instance is required before production deployment.

---

