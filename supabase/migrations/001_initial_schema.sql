-- =============================================================================
-- Plant Health App — Database Migration 001: Initial Schema
-- =============================================================================
-- Supports exactly two crops: coffee (Coffea spp.) and cilantro (Coriandrum sativum).
-- Cilantro is reserved for future use; coffee is the active production crop.
-- No image binaries are stored in PostgreSQL — only metadata and storage references.

-- Enable UUID extension
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- crops — Supported crop definitions (server-controlled; not user-editable)
-- ---------------------------------------------------------------------------
create table public.crops (
  id              uuid primary key default gen_random_uuid(),
  name            text not null unique check (name in ('coffee', 'cilantro')),
  scientific_name text not null,
  description     text,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Seed the two supported crops.
-- coffee: Coffea spp. — indoor potted cultivation target
-- cilantro: Coriandrum sativum — active (public datasets verified: Mendeley k7bmn7295r, 568p8cynps; BDHerbalPlants PMC12301944)
-- NOT culantro/recao (Eryngium foetidum) — explicitly excluded per project requirements.
insert into public.crops (id, name, scientific_name, description, is_active) values
  (gen_random_uuid(), 'coffee',  'Coffea spp.',  'Coffee plant — all Coffea species supported for indoor potted cultivation.', true),
  (gen_random_uuid(), 'cilantro', 'Coriandrum sativum', 'Cilantro (Coriandrum sativum) — supported crop. Distinguished from culantro/recao (Eryngium foetidum), which is NOT supported.', true)
on conflict (name) do nothing;

-- ---------------------------------------------------------------------------
-- profiles — Extends Supabase Auth users with role and display name
-- ---------------------------------------------------------------------------
create table public.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  full_name       text,
  email           text,
  role            text not null default 'farmer' check (role in ('farmer', 'administrator')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- plants — Farmer-registered plants, each assigned to one crop
-- ---------------------------------------------------------------------------
create table public.plants (
  id          uuid primary key default gen_random_uuid(),
  farmer_id   uuid not null references public.profiles(id) on delete cascade,
  crop_id     uuid not null references public.crops(id) on delete restrict,
  name        text not null,                  -- farmer-assigned name/identifier
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index idx_plants_farmer_id on public.plants(farmer_id);
create index idx_plants_crop_id on public.plants(crop_id);

-- ---------------------------------------------------------------------------
-- plant_images — Submitted photograph metadata (binary stored in Supabase Storage)
-- ---------------------------------------------------------------------------
create table public.plant_images (
  id            uuid primary key default gen_random_uuid(),
  plant_id      uuid not null references public.plants(id) on delete cascade,
  submitted_by  uuid not null references public.profiles(id) on delete cascade,
  storage_bucket text not null default 'plant-images',
  storage_path  text not null,                 -- unique path within bucket
  filename      text not null,
  mime_type     text not null,
  size_bytes    bigint not null check (size_bytes > 0),
  width         integer,
  height        integer,
  uploaded_at   timestamptz not null default now(),
  submitted_at  timestamptz not null default now(),
  constraint plant_images_storage_unique unique(storage_bucket, storage_path)
);

create index idx_plant_images_plant_id on public.plant_images(plant_id);
create index idx_plant_images_submitted_by on public.plant_images(submitted_by);
create index idx_plant_images_submitted_at on public.plant_images(submitted_at);

-- ---------------------------------------------------------------------------
-- analyses — Analysis records with async processing state machine
-- States: pending → processing → completed / failed
-- ---------------------------------------------------------------------------
create table public.analyses (
  id                uuid primary key default gen_random_uuid(),
  plant_image_id    uuid not null references public.plant_images(id) on delete cascade,
  status            text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed')),
  model_provider    text,                        -- e.g. 'internal-pytorch', 'external-vision-api'
  model_version     text,                        -- version string from model_versions or provider
  confidence_score  double precision check (confidence_score >= 0 and confidence_score <= 1),
  estimated_severity text check (estimated_severity in ('none', 'low', 'medium', 'high', 'critical', 'unknown')),
  general_health_assessment text,
  visible_observations    jsonb default '[]'::jsonb,
  detected_symptoms       jsonb default '[]'::jsonb,
  potential_explanations  jsonb default '[]'::jsonb,
  recommended_preventive_actions jsonb default '[]'::jsonb,
  recommended_corrective_actions jsonb default '[]'::jsonb,
  follow_up_instructions    text,
  expert_inspection_recommended boolean default false,
  analysis_timestamp      timestamptz,
  error_message           text,
  retry_count             integer not null default 0 check (retry_count >= 0),
  submitted_at            timestamptz not null default now(),
  completed_at            timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index idx_analyses_plant_image_id on public.analyses(plant_image_id);
create index idx_analyses_status on public.analyses(status);
create index idx_analyses_submitted_at on public.analyses(submitted_at);

-- ---------------------------------------------------------------------------
-- analysis_observations — Structured symptom/observation output
-- ---------------------------------------------------------------------------
create table public.analysis_observations (
  id               uuid primary key default gen_random_uuid(),
  analysis_id      uuid not null references public.analyses(id) on delete cascade,
  symptom          text not null,
  description      text,
  confidence       double precision check (confidence >= 0 and confidence <= 1),
  is_visible_observation boolean not null default true,  -- true = model can see it; false = suspected cause
  created_at       timestamptz not null default now()
);

create index idx_analysis_observations_analysis_id on public.analysis_observations(analysis_id);

-- ---------------------------------------------------------------------------
-- recommendations — Preventive, corrective, and follow-up recommendations
-- ---------------------------------------------------------------------------
create table public.recommendations (
  id          uuid primary key default gen_random_uuid(),
  analysis_id uuid not null references public.analyses(id) on delete cascade,
  type        text not null check (type in ('preventive', 'corrective', 'follow_up')),
  content     text not null,
  priority    text not null default 'medium' check (priority in ('low', 'medium', 'high', 'critical')),
  created_at  timestamptz not null default now()
);

create index idx_recommendations_analysis_id on public.recommendations(analysis_id);

-- ---------------------------------------------------------------------------
-- model_versions — Registered model/provider metadata (auditability)
-- ---------------------------------------------------------------------------
create table public.model_versions (
  id          uuid primary key default gen_random_uuid(),
  provider    text not null,                   -- e.g. 'internal', 'external-vision-api'
  version     text not null,
  crop_id     uuid not null references public.crops(id) on delete restrict,
  is_active   boolean not null default true,
  registered_at timestamptz not null default now()
);

create index idx_model_versions_crop_id on public.model_versions(crop_id);
create index idx_model_versions_is_active on public.model_versions(is_active);

-- ---------------------------------------------------------------------------
-- audit_logs — Immutable administrative audit trail
-- ---------------------------------------------------------------------------
create table public.audit_logs (
  id         uuid primary key default gen_random_uuid(),
  actor_id   uuid references public.profiles(id) on delete set null,  -- nullable: system actions may have no actor
  action     text not null,
  entity_type text not null,
  entity_id  uuid,
  details    jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index idx_audit_logs_actor_id on public.audit_logs(actor_id);
create index idx_audit_logs_created_at on public.audit_logs(created_at);
create index idx_audit_logs_entity on public.audit_logs(entity_type, entity_id);

-- ---------------------------------------------------------------------------
-- Helper: auto-update updated_at via trigger function
-- ---------------------------------------------------------------------------
create or replace function public.update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- Attach updated_at triggers
create trigger trg_profiles_updated_at before update on public.profiles for each row execute function public.update_updated_at_column();
create trigger trg_plants_updated_at before update on public.plants for each row execute function public.update_updated_at_column();
create trigger trg_analyses_updated_at before update on public.analyses for each row execute function public.update_updated_at_column();

-- =============================================================================
-- End of migration 001
-- =============================================================================
