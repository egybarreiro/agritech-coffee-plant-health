-- =============================================================================
-- Plant Health App — Migration 005: Lock down farmer write scope
-- =============================================================================
-- Forward-only. Applies after migration 004 (server-only admin writes).
--
-- Rationale:
-- 1. Remove profiles_insert_own.
--    Farmer accounts are provisioned exclusively by administrators through
--    app/api/auth/register/route.ts (service-role client, which bypasses RLS).
--    Direct farmer profile self-insertion through the anon/authenticated
--    context is therefore disabled at the database level.
--
-- 2. Remove analyses_insert_own.
--    Analysis records are created server-side by app/api/images/route.ts with
--    the service-role client after the farmer's image upload is authenticated
--    and ownership-validated. Farmers must not be able to insert analysis rows
--    (or choose status, model results, confidence scores, or identifiers)
--    directly. Requires migration 006 for the one-analysis-per-image invariant.
--
-- 3. Remove farmer Storage UPDATE and DELETE policies on storage.objects.
--    Submitted original images are immutable evidence. Farmers may upload new
--    images (INSERT) and read their own images (SELECT) only. Reanalysis
--    requires a new image, a new plant_images record and a new plant_image_id.
--
-- Preserved (unchanged by this migration):
--   - plant_images_storage_insert_own   (farmer Storage INSERT)
--   - plant_images_storage_select_own   (farmer Storage SELECT)
--   - plant_images_storage_select_admin (administrator Storage SELECT)
--   - plant_images_insert_own / plant_images_select_own (metadata table RLS)
--   - analyses_select_own / analyses_select_all_admin
--   - trg_maintain_admin_counter(), admin_guard, profiles_update_own,
--     profiles_update_admin, is_admin(), is_owner_of_plant()
-- =============================================================================

-- Farmer accounts are administrator-provisioned only.
drop policy if exists profiles_insert_own on public.profiles;

-- Analysis creation is server-controlled via the service-role client.
drop policy if exists analyses_insert_own on public.analyses;

-- Original submitted images are immutable: no farmer updates or deletes.
drop policy if exists plant_images_storage_update_own on storage.objects;
drop policy if exists plant_images_storage_delete_own on storage.objects;
