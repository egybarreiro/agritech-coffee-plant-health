-- =============================================================================
-- Plant Health App — Migration 010: service-role pipeline reads
-- =============================================================================
-- Forward-only. Applies after 009 (coffee-only platform).
--
-- Purpose: migration 007's revocation swept table privileges from ALL three
-- application roles; service_role was granted only what its routes were then
-- known to touch (analyses, audit_logs, profiles). The inference pipeline
-- additionally reads plant_images, plants (with joined crops), for which
-- service_role holds NO privilege — every upload→prediction run would fail
-- with 42501 permission denied. This grants exactly the three missing SELECTs.
-- service_role already operates BYPASSRLS, so no policy changes are needed,
-- and the grants are read-only: service_role still cannot write rows in
-- these tables, still cannot grant to others, and anon/authenticated gains
-- nothing.
-- =============================================================================

grant select on public.plants       to service_role;
grant select on public.plant_images to service_role;
grant select on public.crops        to service_role;
