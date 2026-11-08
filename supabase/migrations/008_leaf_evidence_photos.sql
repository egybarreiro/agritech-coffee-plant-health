-- =============================================================================
-- Plant Health App — Migration 008: complementary leaf-evidence photos
-- Schema: plant_images image roles + per-assessment attachment of leaf photos.
-- Forward-only. Applies after 007 (least privilege table permissions).
--
-- Context: the farmer submission flow requires two complementary photo kinds —
-- exactly one "full plant" framing (one assessment) and one or more
-- "leaf details" close-ups that attach to the SAME assessment record.
-- =============================================================================

-- Role of the photograph inside its assessment:
--   'full_plant'   — the assessment's primary framing photo; all pre-existing
--                    rows fall in this group.
--   'leaf_details' — complementary close-up evidence attached to one analysis.
alter table public.plant_images
  add column image_role text not null default 'full_plant'
  check (image_role in ('full_plant', 'leaf_details'));

-- Link for complementary photos to the assessment they belong to (the analysis
-- created for the 'full_plant' image). Nullable: every 'full_plant' row keeps
-- referencing its assessment through analyses.plant_image_id (unchanged);
-- 'leaf_details' rows point at analyses.id explicitly.
alter table public.plant_images
  add column analysis_id uuid references public.analyses(id) on delete set null;

create index idx_plant_images_analysis_id on public.plant_images(analysis_id);

-- Backward compatibility notes:
-- - Table-level grants from 007 (select, insert to authenticated) already
--   cover the new columns; no privilege changes are needed.
-- - RLS is unchanged: policies select whole rows, and the API still verifies
--   ownership (plant + linked analysis belong to the authenticated farmer)
--   before writing either role.
-- - Data: existing rows keep their storage paths, filenames and analyses; the
--   added default makes them 'full_plant' with no analysis_id, exactly as the
--   admin queue interpreted them before this migration.
