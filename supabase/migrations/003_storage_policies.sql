BEGIN;

-- =============================================================================
-- Plant Health App — Migration 003: Private image storage and RLS
-- =============================================================================

-- Create a private bucket for plant images.
insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'plant-images',
  'plant-images',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Remove existing policies before recreating them.
drop policy if exists plant_images_storage_insert_own on storage.objects;
drop policy if exists plant_images_storage_select_own on storage.objects;
drop policy if exists plant_images_storage_select_admin on storage.objects;
drop policy if exists plant_images_storage_update_own on storage.objects;
drop policy if exists plant_images_storage_delete_own on storage.objects;

-- Farmers can upload images only to paths belonging to their own plants.
-- Required path: farmer_id/plant_id/filename
create policy plant_images_storage_insert_own
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'plant-images'
  and array_length(string_to_array(name, '/'), 1) = 3
  and split_part(name, '/', 1) = (select auth.uid()::text)
  and split_part(name, '/', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and split_part(name, '/', 3) <> ''
  and public.is_owner_of_plant(
    case
      when split_part(name, '/', 2) ~*
        '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then split_part(name, '/', 2)::uuid
      else null
    end
  )
);

-- Farmers can read their own images.
create policy plant_images_storage_select_own
on storage.objects
for select
to authenticated
using (
  bucket_id = 'plant-images'
  and array_length(string_to_array(name, '/'), 1) = 3
  and split_part(name, '/', 1) = (select auth.uid()::text)
  and split_part(name, '/', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and split_part(name, '/', 3) <> ''
  and public.is_owner_of_plant(
    case
      when split_part(name, '/', 2) ~*
        '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then split_part(name, '/', 2)::uuid
      else null
    end
  )
);

-- Administrators can read all images in the private bucket.
create policy plant_images_storage_select_admin
on storage.objects
for select
to authenticated
using (
  bucket_id = 'plant-images'
  and public.is_admin()
);

-- Farmers can update only their own images.
create policy plant_images_storage_update_own
on storage.objects
for update
to authenticated
using (
  bucket_id = 'plant-images'
  and array_length(string_to_array(name, '/'), 1) = 3
  and split_part(name, '/', 1) = (select auth.uid()::text)
  and split_part(name, '/', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and split_part(name, '/', 3) <> ''
  and public.is_owner_of_plant(
    case
      when split_part(name, '/', 2) ~*
        '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then split_part(name, '/', 2)::uuid
      else null
    end
  )
)
with check (
  bucket_id = 'plant-images'
  and array_length(string_to_array(name, '/'), 1) = 3
  and split_part(name, '/', 1) = (select auth.uid()::text)
  and split_part(name, '/', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and split_part(name, '/', 3) <> ''
  and public.is_owner_of_plant(
    case
      when split_part(name, '/', 2) ~*
        '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then split_part(name, '/', 2)::uuid
      else null
    end
  )
);

-- Farmers can delete only their own images.
create policy plant_images_storage_delete_own
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'plant-images'
  and array_length(string_to_array(name, '/'), 1) = 3
  and split_part(name, '/', 1) = (select auth.uid()::text)
  and split_part(name, '/', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and split_part(name, '/', 3) <> ''
  and public.is_owner_of_plant(
    case
      when split_part(name, '/', 2) ~*
        '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then split_part(name, '/', 2)::uuid
      else null
    end
  )
);

COMMIT;
