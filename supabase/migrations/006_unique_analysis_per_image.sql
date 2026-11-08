-- =============================================================================
-- Plant Health App — Migration 006: One analysis per plant image
-- =============================================================================
-- Forward-only. Applies after migration 005 (farmer write scope lockdown).
--
-- `analyses.plant_image_id` is NOT NULL (migration 001). This migration
-- enforces the intended invariant: at most one analysis row per submitted
-- plant image. Reanalysis is performed by submitting a new image (new
-- plant_images record and new plant_image_id), not by creating a duplicate
-- analysis for an existing image.
--
-- Duplicate data check: if any plant_image_id already has more than one
-- analysis row, this migration fails with an explicit message and NO records
-- are modified, merged, or deleted. Resolving duplicates requires human
-- review before this migration can be applied.
-- =============================================================================

do $$
declare
  duplicate_groups integer;
begin
  select count(*)
    into duplicate_groups
    from (
      select plant_image_id
        from public.analyses
       group by plant_image_id
      having count(*) > 1
    ) duplicates;

  if duplicate_groups > 0 then
    raise exception using
      message = format(
        'Migration 006 stopped: %s plant_image_id value(s) in public.analyses '
          || 'have more than one analysis row. Resolve duplicates by manual '
          || 'review (no records were modified) before applying this migration.',
        duplicate_groups
      );
  end if;
end;
$$;

create unique index if not exists idx_one_analysis_per_image
  on public.analyses (plant_image_id);

-- Note: the pre-existing non-unique index idx_analyses_plant_image_id
-- (migration 001) is intentionally left in place; the unique index above
-- supersedes it for lookups and can be dropped in a later migration if desired.
