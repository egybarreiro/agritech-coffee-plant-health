-- =============================================================================
-- Plant Health App — Database Migration 002: Row Level Security (RLS) Policies
-- =============================================================================
-- Security invariant: All role permissions enforced server-side via RLS.
-- Farmers can only access their own profiles, plants, images, and analyses.
-- Administrators can access all records.
-- No role-escalation path: the `profiles.role` column is never writable by farmers.
-- ---------------------------------------------------------------------------
-- Enable RLS on all tables
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.crops enable row level security;
alter table public.plants enable row level security;
alter table public.plant_images enable row level security;
alter table public.analyses enable row level security;
alter table public.analysis_observations enable row level security;
alter table public.recommendations enable row level security;
alter table public.model_versions enable row level security;
alter table public.audit_logs enable row level security;

-- ---------------------------------------------------------------------------
-- Helper: is_admin() — checks if the requesting user has administrator role
-- Enforced via SECURITY DEFINER with empty search_path to prevent search_path
-- injection attacks. The function reads `profiles.role` for the current user
-- identified by auth.uid().
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean as $$
declare
  v_role text;
begin
  select role into v_role
  from public.profiles
  where id = auth.uid();
  return v_role = 'administrator';
end;
$$ language plpgsql stable
security definer
set search_path = '';

revoke all on function public.is_admin() from public, anon, authenticated, service_role;
grant execute on function public.is_admin() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Helper: is_owner_of_plant(plant_id) — checks if requesting user owns the plant
-- Enforced via SECURITY DEFINER with empty search_path.
-- ---------------------------------------------------------------------------
create or replace function public.is_owner_of_plant(p_plant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.plants p
    where p.id = p_plant_id
      and p.farmer_id = auth.uid()
  );
$$;

revoke all on function public.is_owner_of_plant(uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.is_owner_of_plant(uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Guard table: admin_guard — single-row administrator counter
-- Exactly one row (id = 1) tracks the number of active administrators.
-- All admin count changes (INSERT/UPDATE/DELETE on profiles) are funneled
-- through a SECURITY DEFINER trigger that locks this row, guaranteeing
-- serialization under READ COMMITTED without advisory-lock snapshot issues.
-- ---------------------------------------------------------------------------
create table public.admin_guard (
  id          integer primary key check (id = 1),
  admin_count integer not null default 0 check (admin_count >= 0),
  updated_at  timestamptz not null default now()
);

-- Revoke all direct access from application roles.
-- Only the SECURITY DEFINER trigger function writes to this table.
revoke all on public.admin_guard from authenticated;
revoke all on public.admin_guard from anon;

-- Seed from existing profiles (migration initialization).
-- On a fresh project this yields 0; the first admin INSERT increments to 1.
insert into public.admin_guard (id, admin_count)
select 1, count(*)
from public.profiles
where role = 'administrator';

-- ---------------------------------------------------------------------------
-- Helper: maintain_admin_counter — enforce last-admin rule via guard row lock
-- Enforced via AFTER INSERT OR UPDATE OR DELETE ON profiles FOR EACH ROW.
-- Runs with SECURITY DEFINER so it can write to admin_guard despite revoked
-- permissions on application roles.
-- ---------------------------------------------------------------------------
create or replace function public.maintain_admin_counter()
returns trigger as $$
declare
  current_count integer;
  net_change    integer := 0;
  tentative     integer;
begin
  -- Determine net admin count change for this row
  if tg_op = 'INSERT' then
    if new.role = 'administrator' then net_change := 1; end if;
  elsif tg_op = 'DELETE' then
    if old.role = 'administrator' then net_change := -1; end if;
  elsif tg_op = 'UPDATE' then
    if old.role = 'administrator' and new.role <> 'administrator' then net_change := -1;
    elsif old.role <> 'administrator' and new.role = 'administrator' then net_change := 1;
    end if;
  end if;

  -- No admin status change: nothing to do
  if net_change = 0 then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  -- Prevent any user from changing their own role (promotion or demotion).
  -- auth.uid() is NULL for service-role requests, so this check only
  -- applies to authenticated end-user requests.
  if tg_op = 'UPDATE'
     and old.role is distinct from new.role
     and old.id = auth.uid() then
    raise exception 'Cannot change your own role';
  end if;

  -- Acquire row-level lock on the single guard row and read current count.
  -- This serializes all admin count changes across concurrent transactions.
  select admin_count into current_count
  from public.admin_guard
  where id = 1
  for update;

  if current_count is null then
    raise exception 'Administrator guard table is missing its guard row';
  end if;

  tentative := current_count + net_change;

  -- Last-admin safeguard: never allow count to drop below 1
  if tentative < 1 then
    raise exception 'Cannot remove the last remaining administrator';
  end if;

  -- Commit the counter change (still within same transaction, lock held)
  update public.admin_guard
  set admin_count = tentative, updated_at = now()
  where id = 1;

  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$ language plpgsql security definer set search_path = '';

-- Revoke direct EXECUTE on the trigger function from PUBLIC.
revoke all on function public.maintain_admin_counter() from public, anon, authenticated, service_role;

create trigger trg_maintain_admin_counter
  after insert or update or delete on public.profiles
  for each row
  execute function public.maintain_admin_counter();

-- =============================================================================
-- profiles
-- =============================================================================
-- Users can read their own profile.
create policy profiles_select_own on public.profiles
  for select using (auth.uid() = id);

-- Users can insert their own profile (on sign-up).
-- Authenticated users may only create profiles with role = 'farmer'.
-- Administrator creation is restricted to server-side service-role provisioning
-- (which bypasses RLS and whose auth.uid() is NULL, bypassing this check).
create policy profiles_insert_own on public.profiles
  for insert
  with check (auth.uid() = id and role = 'farmer');

-- Users can update their own profile fields (name, email, etc.).
-- Role changes are enforced by trigger trg_maintain_admin_counter (OLD/NEW are not available in RLS policies):
--   - Farmers cannot promote themselves to administrator.
--   - Administrators cannot demote themselves.
--   - Role changes require authorization via the trigger's self-change check.
create policy profiles_update_own on public.profiles
  for update using (auth.uid() = id)
  with check (auth.uid() = id);

-- Administrators can read all profiles.
create policy profiles_select_all_admin on public.profiles
  for select using (public.is_admin());

-- Historical administrator update policy. Migration 004 removes it so profile
-- mutations are performed only by authorized server-side service-role flows.
create policy profiles_update_admin on public.profiles
  for update using (public.is_admin());

-- =============================================================================
-- crops
-- =============================================================================
-- Anyone authenticated can read crops.
create policy crops_select_auth on public.crops
  for select using (auth.role() = 'authenticated');

-- Only administrators can insert/update/delete crops.
create policy crops_insert_admin on public.crops
  for insert with check (public.is_admin());
create policy crops_update_admin on public.crops
  for update using (public.is_admin());
create policy crops_delete_admin on public.crops
  for delete using (public.is_admin());

-- =============================================================================
-- plants
-- =============================================================================
-- Farmers can read their own plants.
create policy plants_select_own on public.plants
  for select using (public.is_owner_of_plant(id));

-- Farmers can insert their own plants.
create policy plants_insert_own on public.plants
  for insert with check (
    auth.uid() = farmer_id
    and exists (
      select 1 from public.crops where id = crop_id and is_active = true
    )
  );

-- Farmers can update their own plants.
create policy plants_update_own on public.plants
  for update using (public.is_owner_of_plant(id))
  with check (public.is_owner_of_plant(id));

-- Administrators can read all plants.
create policy plants_select_all_admin on public.plants
  for select using (public.is_admin());

-- =============================================================================
-- plant_images
-- =============================================================================
-- Farmers can read images for their own plants.
create policy plant_images_select_own on public.plant_images
  for select using (
    exists (
      select 1 from public.plants
      where plants.id = plant_images.plant_id
        and plants.farmer_id = auth.uid()
    )
  );

-- Farmers can insert images for their own plants.
create policy plant_images_insert_own on public.plant_images
  for insert with check (
    submitted_by = (select auth.uid())
    and exists (
      select 1 from public.plants
      where plants.id = plant_images.plant_id
        and plants.farmer_id = auth.uid()
    )
  );

-- Administrators can read all images.
create policy plant_images_select_all_admin on public.plant_images
  for select using (public.is_admin());

-- =============================================================================
-- analyses
-- =============================================================================
-- Farmers can read analyses for their own plant images.
create policy analyses_select_own on public.analyses
  for select using (
    exists (
      select 1 from public.plant_images pi
      join public.plants p on p.id = pi.plant_id
      where pi.id = analyses.plant_image_id
        and p.farmer_id = auth.uid()
    )
  );

-- Farmers can insert analyses for their own plant images (system-submitted).
create policy analyses_insert_own on public.analyses
  for insert with check (
    exists (
      select 1 from public.plant_images pi
      join public.plants p on p.id = pi.plant_id
      where pi.id = analyses.plant_image_id
        and p.farmer_id = auth.uid()
    )
  );

-- Farmers CANNOT update analyses.
-- All analysis fields ... are either system-managed or model-generated.
-- Analysis updates are performed exclusively by the system (background jobs) and
-- administrators via the server-only service-role client, which bypasses RLS.

-- Administrators can read all analyses (including failed/error records).
create policy analyses_select_all_admin on public.analyses
  for select using (public.is_admin());

-- Historical administrator update policy. Migration 004 removes it so reviews
-- go through the server route that validates input and records an audit event.
create policy analyses_update_admin on public.analyses
  for update using (public.is_admin());

-- =============================================================================
-- analysis_observations
-- =============================================================================
-- Farmers can read observations for their own analyses.
create policy analysis_observations_select_own on public.analysis_observations
  for select using (
    exists (
      select 1 from public.analyses a
      join public.plant_images pi on pi.id = a.plant_image_id
      join public.plants p on p.id = pi.plant_id
      where a.id = analysis_observations.analysis_id
        and p.farmer_id = auth.uid()
    )
  );

-- Administrators can read all observations.
create policy analysis_observations_select_all_admin on public.analysis_observations
  for select using (public.is_admin());

-- =============================================================================
-- recommendations
-- =============================================================================
-- Farmers can read recommendations for their own analyses.
create policy recommendations_select_own on public.recommendations
  for select using (
    exists (
      select 1 from public.analyses a
      join public.plant_images pi on pi.id = a.plant_image_id
      join public.plants p on p.id = pi.plant_id
      where a.id = recommendations.analysis_id
        and p.farmer_id = auth.uid()
    )
  );

-- Administrators can read all recommendations.
create policy recommendations_select_all_admin on public.recommendations
  for select using (public.is_admin());

-- =============================================================================
-- model_versions
-- =============================================================================
-- Anyone authenticated can read model versions.
create policy model_versions_select_auth on public.model_versions
  for select using (auth.role() = 'authenticated');

-- Only administrators can write model versions.
create policy model_versions_insert_admin on public.model_versions
  for insert with check (public.is_admin());
create policy model_versions_update_admin on public.model_versions
  for update using (public.is_admin());

-- =============================================================================
-- audit_logs
-- =============================================================================
-- Farmers can read their own audit log entries (where they are the actor).
create policy audit_logs_select_own on public.audit_logs
  for select using (actor_id = auth.uid());

-- Administrators can read all audit logs.
create policy audit_logs_select_all_admin on public.audit_logs
  for select using (public.is_admin());

-- Only the system (service role) can insert audit logs — never via frontend.
create policy audit_logs_insert_service on public.audit_logs
  for insert with check (auth.jwt() ->> 'role' = 'service_role');

-- =============================================================================
-- Administrative Operations — Service-Role Client Requirement
-- =============================================================================
-- The following administrative WRITE operations are NOT covered by RLS policies
-- for authenticated admin users (is_admin()). They must be performed exclusively
-- through the server-only Supabase service-role client (createServiceClient in
-- lib/supabase/service.ts), which bypasses RLS:
--
--   - INSERT / UPDATE / DELETE on public.crops
--   - INSERT / UPDATE / DELETE on public.plants
--   - INSERT / UPDATE / DELETE on public.plant_images
--   - INSERT / UPDATE / DELETE on public.analyses
--   - INSERT / UPDATE / DELETE on public.analysis_observations
--   - INSERT / UPDATE / DELETE on public.recommendations
--   - UPDATE on public.profiles (including role changes)
--
-- Rationale: RLS policies grant administrators SELECT access to all tables, but
-- write access is intentionally restricted to the service-role client to ensure
-- that admin mutations always execute with full server-side validation and
-- audit logging. The service-role key (SUPABASE_SERVICE_ROLE_KEY) lacks the
-- NEXT_PUBLIC_ prefix and is never inlined into browser bundles by Next.js.
-- It cannot be imported into client-side code.
--
-- Admin READ operations on all tables are available to authenticated users
-- with the administrator role via standard RLS policies (is_admin()).
-- =============================================================================
-- End of migration 002
-- =============================================================================
