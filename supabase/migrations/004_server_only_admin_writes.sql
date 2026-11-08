-- Keep administrator mutations behind server-side authorization and audit logging.
-- Reads remain available to authenticated administrators through migration 002.
drop policy if exists profiles_update_admin on public.profiles;
drop policy if exists analyses_update_admin on public.analyses;
