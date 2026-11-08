# Database Schema — Plant Health Application

## Entity Relationship Summary

```
profiles  1 ──┬──< plants  1 ──┬──< plant_images  1 ──┬──< analyses
(auth.users)     (farmer)              (submitted_by)          │
                                                │               ├────< analysis_observations
                                                │               ├────< recommendations
                                                │               └──── (status: pending/processing/completed/failed)
crops  1 ──┬──< plants                                          └──── model_provider, model_version
           (crop_id)
model_versions 1 ──┬──< analyses (via crop_id + provider/version)
audit_logs (actor_id → profiles, entity_type/entity_id)
```

## Tables

| Table | Purpose | RLS |
|-------|---------|-----|
| `profiles` | Extends auth.users with full_name, role (farmer/administrator) | Own read/write; admin read |
| `crops` | Supported crops: coffee (*Coffea* spp.) only | Auth read; admin write |
| `plants` | Farmer-registered plants with name and crop assignment | Own CRUD; admin read |
| `plant_images` | Photograph metadata + Supabase Storage path reference | Own read/insert; admin read |
| `analyses` | Async analysis record + status machine + structured results | Own read/insert; admin read; server-only updates |
| `analysis_observations` | Structured symptom/observation output (visible vs. suspected) | Own read; admin read |
| `recommendations` | Preventive/corrective/follow-up actions | Own read; admin read |
| `model_versions` | Registered model/provider metadata | Auth read; admin write |
| `audit_logs` | Immutable administrative audit trail | Own read (actor); admin read all; service-role insert only |

## Key Constraints
- `profiles.role` CHECK: `farmer` \| `administrator` — never writable by farmers (trigger guards role changes)
- `crops.name` CHECK: `coffee` only (migration `009_coffee_only_platform.sql` replaces the original `coffee` \| `cilantro` constraint)
- `plant_images.size_bytes` > 0
- `analyses.confidence_score` between 0 and 1
- `analyses.status` CHECK: `pending` \| `processing` \| `completed` \| `failed`
- `analyses.estimated_severity` CHECK: `none` \| `low` \| `medium` \| `high` \| `critical` \| `unknown`
- `recommendations.type` CHECK: `preventive` \| `corrective` \| `follow_up`
- Foreign keys with `on delete cascade` where appropriate; `restrict` on crops

## Indexes
- `plants(farmer_id)`, `plants(crop_id)`
- `plant_images(plant_id)`, `plant_images(submitted_by)`, `plant_images(submitted_at)`
- `analyses(plant_image_id)`, `analyses(status)`, `analyses(submitted_at)`
- `analysis_observations(analysis_id)`
- `recommendations(analysis_id)`
- `model_versions(crop_id)`, `model_versions(is_active)`
- `audit_logs(actor_id)`, `audit_logs(created_at)`, `audit_logs(entity_type, entity_id)`

## RLS Policy Design (server-enforced)
- **Farmers**: read/update their own profile; read/insert/update their own plants; read/insert their image metadata; read/insert their analyses and read their results
- **Administrators**: read all records; mutations go through server routes using the service role
- **Service role only**: administrator mutations and inserts into `audit_logs`
- **No role escalation**: `profiles` update policy blocks `role` changes by non-admins

## Migrations
- `supabase/migrations/001_initial_schema.sql` — tables, constraints, indexes, seed data, updated_at triggers
- `supabase/migrations/002_rls_policies.sql` — RLS enablement, helper functions, all policies
- `supabase/migrations/003_storage_policies.sql` — private image bucket and owner-path Storage policies
- `supabase/migrations/004_server_only_admin_writes.sql` — removes direct authenticated-admin write paths for profiles and analyses
