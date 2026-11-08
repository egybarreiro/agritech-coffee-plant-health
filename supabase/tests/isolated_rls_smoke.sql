-- Run only in a throwaway database after the isolated Auth harness and migrations 001, 002, 004.
-- This tests database policies; it does not call remote Supabase services or Storage.
\set ON_ERROR_STOP on

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;

INSERT INTO auth.users (id) VALUES
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222'),
  ('33333333-3333-4333-8333-333333333333'),
  ('44444444-4444-4444-8444-444444444444');

INSERT INTO public.profiles (id, full_name, role) VALUES
  ('11111111-1111-4111-8111-111111111111', 'Test Admin', 'administrator'),
  ('22222222-2222-4222-8222-222222222222', 'Farmer A', 'farmer'),
  ('33333333-3333-4333-8333-333333333333', 'Farmer B', 'farmer');

INSERT INTO public.plants (id, farmer_id, crop_id, name)
SELECT 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '22222222-2222-4222-8222-222222222222', id, 'plant-a'
FROM public.crops WHERE name = 'coffee';
INSERT INTO public.plants (id, farmer_id, crop_id, name)
SELECT 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '33333333-3333-4333-8333-333333333333', id, 'plant-b'
FROM public.crops WHERE name = 'coffee';

INSERT INTO public.plant_images (plant_id, submitted_by, storage_path, filename, mime_type, size_bytes)
SELECT id, farmer_id, name || '/test.jpg', 'test.jpg', 'image/jpeg', 12
FROM public.plants WHERE name IN ('plant-a', 'plant-b');
INSERT INTO public.analyses (plant_image_id)
SELECT id FROM public.plant_images;

DO $$
BEGIN
  IF (SELECT admin_count FROM public.admin_guard WHERE id = 1) <> 1 THEN
    RAISE EXCEPTION 'admin_guard did not seed the first administrator';
  END IF;
  IF (SELECT count(*) FROM public.crops) <> 2 THEN
    RAISE EXCEPTION 'migration seed data did not contain both supported crops';
  END IF;
  IF (
    SELECT count(*) FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = current_schema() AND c.relrowsecurity
  ) <> 9 THEN
    RAISE EXCEPTION 'RLS is not enabled on all nine application tables';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = current_schema()) <> 28 THEN
    RAISE EXCEPTION 'unexpected public RLS policy count after migration 004';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'storage') <> 5 THEN
    RAISE EXCEPTION 'Storage RLS policies were not all installed';
  END IF;
END;
$$;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
SELECT set_config('request.jwt.claim.role', 'authenticated', false);
DO $$
DECLARE affected integer;
BEGIN
  IF (SELECT count(*) FROM public.profiles) <> 3 THEN
    RAISE EXCEPTION 'administrator cannot read all profiles';
  END IF;
  BEGIN
    UPDATE public.profiles SET role = 'farmer'
    WHERE id = '11111111-1111-4111-8111-111111111111';
    RAISE EXCEPTION 'administrator self-demotion unexpectedly succeeded';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'administrator self-demotion unexpectedly succeeded' THEN
      RAISE;
    END IF;
  END;
END;
$$;
DO $$
DECLARE affected integer;
BEGIN
  UPDATE public.profiles SET role = 'administrator'
  WHERE id = '33333333-3333-4333-8333-333333333333';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN
    RAISE EXCEPTION 'authenticated administrator can directly change another profile role';
  END IF;
  UPDATE public.analyses SET status = 'completed';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN
    RAISE EXCEPTION 'authenticated administrator can bypass the review route';
  END IF;
END;
$$;
RESET ROLE;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', false);
SELECT set_config('request.jwt.claim.role', 'authenticated', false);
DO $$
DECLARE affected integer;
BEGIN
  IF (SELECT count(*) FROM public.profiles) <> 1 THEN
    RAISE EXCEPTION 'farmer can read another farmer''s profile';
  END IF;
  UPDATE public.profiles SET full_name = 'Farmer A Updated'
  WHERE id = '22222222-2222-4222-8222-222222222222';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN
    RAISE EXCEPTION 'farmer cannot update their own profile fields';
  END IF;
  BEGIN
    UPDATE public.profiles SET role = 'administrator'
    WHERE id = '22222222-2222-4222-8222-222222222222';
    RAISE EXCEPTION 'farmer self-promotion unexpectedly succeeded';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'farmer self-promotion unexpectedly succeeded' THEN
      RAISE;
    END IF;
  END;
  IF (SELECT count(*) FROM public.plants) <> 1 OR EXISTS (
    SELECT 1 FROM public.plants WHERE name = 'plant-b'
  ) THEN
    RAISE EXCEPTION 'farmer can read another farmer''s plant';
  END IF;
  INSERT INTO storage.objects (bucket_id, name)
  VALUES ('plant-images', '22222222-2222-4222-8222-222222222222/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/own.jpg');
  BEGIN
    INSERT INTO storage.objects (bucket_id, name)
    VALUES ('plant-images', '33333333-3333-4333-8333-333333333333/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/other.jpg');
    RAISE EXCEPTION 'cross-owner Storage insert was not rejected';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  IF (SELECT count(*) FROM storage.objects) <> 1 THEN
    RAISE EXCEPTION 'Storage policy allowed a cross-owner path';
  END IF;
  UPDATE public.analyses SET status = 'completed';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN
    RAISE EXCEPTION 'farmer can update an analysis';
  END IF;
END;
$$;
RESET ROLE;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '44444444-4444-4444-8444-444444444444', false);
SELECT set_config('request.jwt.claim.role', 'authenticated', false);
DO $$
BEGIN
  BEGIN
    INSERT INTO public.profiles (id, full_name, role)
    VALUES ('44444444-4444-4444-8444-444444444444', 'Rogue Admin', 'administrator');
    RAISE EXCEPTION 'authenticated administrator profile INSERT unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END;
$$;
RESET ROLE;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
SELECT set_config('request.jwt.claim.role', 'authenticated', false);
DO $$
BEGIN
  IF (SELECT count(*) FROM storage.objects) <> 1 THEN
    RAISE EXCEPTION 'administrator cannot read the private review image';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM storage.buckets
    WHERE id = 'plant-images' AND public = false AND file_size_limit = 10485760
      AND allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']
  ) THEN
    RAISE EXCEPTION 'plant-images bucket configuration is incorrect';
  END IF;
END;
$$;
RESET ROLE;

SET ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
UPDATE public.analyses SET status = 'completed' WHERE status = 'pending';
INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id)
SELECT '11111111-1111-4111-8111-111111111111', 'analysis.human_review_completed', 'analyses', id
FROM public.analyses WHERE status = 'completed' LIMIT 1;
UPDATE public.profiles SET role = 'administrator'
WHERE id = '33333333-3333-4333-8333-333333333333';
DO $$
BEGIN
  IF (SELECT admin_count FROM public.admin_guard WHERE id = 1) <> 2 THEN
    RAISE EXCEPTION 'service-role administrator promotion did not update admin_guard';
  END IF;
  BEGIN
    UPDATE public.profiles SET role = 'farmer' WHERE role = 'administrator';
    RAISE EXCEPTION 'multi-row last-admin demotion unexpectedly succeeded';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'multi-row last-admin demotion unexpectedly succeeded' THEN
      RAISE;
    END IF;
  END;
  IF (SELECT admin_count FROM public.admin_guard WHERE id = 1) <> 2
     OR (SELECT count(*) FROM public.profiles WHERE role = 'administrator') <> 2 THEN
    RAISE EXCEPTION 'multi-row rollback corrupted admin counter or profiles';
  END IF;
END;
$$;
UPDATE public.profiles SET role = 'farmer'
WHERE id = '33333333-3333-4333-8333-333333333333';
DO $$
BEGIN
  IF (SELECT admin_count FROM public.admin_guard WHERE id = 1) <> 1 THEN
    RAISE EXCEPTION 'service-role administrator demotion did not update admin_guard';
  END IF;
  IF (SELECT admin_count FROM public.admin_guard WHERE id = 1)
     <> (SELECT count(*) FROM public.profiles WHERE role = 'administrator') THEN
    RAISE EXCEPTION 'admin_guard does not match the profile table';
  END IF;
  BEGIN
    DELETE FROM public.profiles WHERE id = '11111111-1111-4111-8111-111111111111';
    RAISE EXCEPTION 'last-administrator removal was not rejected';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'last-administrator removal was not rejected' THEN
      RAISE;
    END IF;
  END;
  IF (SELECT admin_count FROM public.admin_guard WHERE id = 1) <> 1
     OR (SELECT count(*) FROM public.profiles WHERE role = 'administrator') <> 1 THEN
    RAISE EXCEPTION 'last-admin rollback corrupted the counter or profile';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.audit_logs WHERE action = 'analysis.human_review_completed') THEN
    RAISE EXCEPTION 'service-role audit insert was rejected';
  END IF;
END;
$$;
RESET ROLE;

SELECT 'isolated RLS smoke checks passed' AS result;
