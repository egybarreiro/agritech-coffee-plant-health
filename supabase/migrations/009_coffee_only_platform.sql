-- =============================================================================
-- Plant Health App — Migration 009: coffee-only platform
-- Forward-only. Applies after 008 (leaf-evidence photo roles).
--
-- Context: AgriTech now supports coffee (Coffea spp.) exclusively. This
-- migration removes the cilantro crop definition and every row that depends on
-- it, and tightens the schema so no second crop can be created by mistake.
--
-- Non-destructive guarantees:
-- - User accounts, profiles, and farmer/admin records are untouched.
-- - Historical COFFEE submissions (plant_images, analyses, audit logs) are
--   untouched. Crops→plants uses ON DELETE RESTRICT, so the deletes below run
--   in dependency order and only affect cilantro rows.
-- - The `crops`/`plants`/`plant_images` tables and the crop_name column on
--   plants are intentionally kept: the model registry and several farmer/admin
--   screens join through `crops`, so shared infrastructure stays intact.
-- =============================================================================

-- 1. Remove cilantro plants (and their images/analyses via ON DELETE CASCADE).
-- AgriTech historically had no cilantro submissions in production; if any
-- exist, removing them is REQUIRED so no orphaned second-crop data remains.
delete from public.plant_images
  where plant_id in (
    select p.id from public.plants p
    where p.crop_id in (select id from public.crops where name = 'cilantro')
  );

delete from public.plants
  where crop_id in (select id from public.crops where name = 'cilantro');

-- 2. Remove the cilantro crop definition itself.
delete from public.crops where name = 'cilantro';

-- 3. Tighten the schema surface: `crops.name` may only ever be 'coffee'.
-- The original CHECK from migration 001 was an unnamed inline constraint, so
-- it received the default name `crops_name_check`.
alter table public.crops
  drop constraint if exists crops_name_check;
alter table public.crops
  add constraint crops_name_check check (name = 'coffee');

-- 4. Defense in depth: no inactive leftovers may resurface.
delete from public.crops where name <> 'coffee';
