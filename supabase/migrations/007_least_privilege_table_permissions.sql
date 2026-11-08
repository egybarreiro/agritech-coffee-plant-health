-- =============================================================================
-- Plant Health App — Migration 007: Least-privilege table permissions
-- =============================================================================
-- Forward-only. Applies after migration 006.
--
-- Purpose:
--   Migrations 001-006 never granted table privileges to the application
--   roles; the schema relied entirely on hosted platform default grants.
--   Remote evidence (admin_guard privileges false for anon, authenticated and
--   service_role) shows those defaults did not reach migration-created
--   tables. This migration makes the permission model explicit and
--   least-privileged:
--
--   1. Revoke ALL table privileges (SELECT, INSERT, UPDATE, DELETE, TRUNCATE,
--      REFERENCES, TRIGGER) from the three application roles on every table
--      in schema public, including admin_guard.
--   2. Grant only the application-required operations per table
--      (the approved permission matrix).
--   3. Configure default table privileges FOR ROLE postgres IN SCHEMA public
--      so future public tables do not inherit application-role privileges;
--      any new table must be granted explicitly by its own migration.
--
-- Deliberately unchanged:
--   - RLS enablement and all RLS policies (001/002/003/004/005/006).
--   - Storage bucket and Storage policies (003).
--   - Function and sequence privileges (no code evidence requires changes).
--   - admin_guard stays inaccessible directly to application roles; the only
--     writer remains the SECURITY DEFINER trigger maintain_admin_counter()
--     (migration 002), and the table owner retains implicit access.
--
-- Idempotent by nature: GRANT/REVOKE statements with no matching ACLs are
-- no-ops (no error), matching the replay-safe style of migrations 004-006.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Revoke all table privileges from the application roles
--    ("all privileges" covers SELECT, INSERT, UPDATE, DELETE, TRUNCATE,
--    REFERENCES and TRIGGER on every existing table in schema public).
-- ---------------------------------------------------------------------------
revoke all privileges on all tables in schema public from anon;
revoke all privileges on all tables in schema public from authenticated;
revoke all privileges on all tables in schema public from service_role;

-- ---------------------------------------------------------------------------
-- 2. Re-grant only the approved operations.
--
--   Table                    authenticated          service_role
--   profiles                 SELECT                 SELECT, INSERT
--   crops                    SELECT                 none
--   plants                   SELECT,INSERT,UPDATE   none
--   plant_images             SELECT,INSERT          none
--   analyses                 SELECT                 SELECT, INSERT, UPDATE
--   audit_logs               none                   INSERT
--   admin_guard              none                   none
--   analysis_observations    none                   none
--   recommendations          none                   none
--   model_versions           none                   none
--   anon: no table privileges at all.
--
--   Notes:
--   - INSERT/UPDATE ... RETURNING also requires the SELECT privilege:
--     covered by explicitly granting SELECT where the code returns rows
--     (app/api/plants/route.ts, app/api/images/route.ts,
--     app/api/admin/analyses/route.ts).
--   - service_role bypasses RLS (BYPASSRLS) but not table privileges, so
--     these grants are required for the service-role client paths
--     (analyses insert/human-review update in
--     app/api/admin/analyses/route.ts and lib/audit.ts audit-log inserts).
-- ---------------------------------------------------------------------------

-- profiles: farmers/administrators read own row via profiles_select_own /
-- profiles_select_all_admin; provisioning routes insert via service role.
grant select on public.profiles to authenticated;
grant select, insert on public.profiles to service_role;

-- crops: read-only to application roles (selection dropdowns and validation).
grant select on public.crops to authenticated;

-- plants: farmers manage their own plants (ownership enforced by RLS);
-- the PATCH path updates with RETURNING, hence SELECT + UPDATE.
grant select, insert, update on public.plants to authenticated;

-- plant_images: farmers insert upload metadata (RETURNING selects the row)
-- and read their own images; administrators read all.
grant select, insert on public.plant_images to authenticated;

-- analyses: farmers read their own analyses; analysis creation and human
-- review run server-side through the service-role client (INSERT with
-- RETURNING, UPDATE with RETURNING).
grant select on public.analyses to authenticated;
grant select, insert, update on public.analyses to service_role;

-- audit_logs: append-only audit trail for service-role flows
-- (audit_logs_insert_service policy enforces the service_role claim).
grant insert on public.audit_logs to service_role;

-- admin_guard, analysis_observations, recommendations, model_versions:
-- intentionally no grants for anon, authenticated or service_role.

-- ---------------------------------------------------------------------------
-- 3. Default privileges FOR ROLE postgres IN SCHEMA public:
--    future tables created by postgres must not inherit application-role
--    privileges. Grants for future tables belong in the migration that
--    creates them.
-- ---------------------------------------------------------------------------
alter default privileges for role postgres in schema public
  revoke all privileges on tables from anon;

alter default privileges for role postgres in schema public
  revoke all privileges on tables from authenticated;

alter default privileges for role postgres in schema public
  revoke all privileges on tables from service_role;

-- =============================================================================
-- End of migration 007
-- =============================================================================