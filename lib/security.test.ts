import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'supabase', 'migrations', '002_rls_policies.sql'),
  'utf8',
)

const lockdown = readFileSync(
  resolve(process.cwd(), 'supabase', 'migrations', '005_farmer_write_scope_lockdown.sql'),
  'utf8',
)

const uniqueIndex = readFileSync(
  resolve(process.cwd(), 'supabase', 'migrations', '006_unique_analysis_per_image.sql'),
  'utf8',
)

describe('plant row-level security declarations', () => {
  it('limits farmer plant reads to plants they own', () => {
    expect(migration).toMatch(/create policy plants_select_own on public\.plants\s+for select using \(public\.is_owner_of_plant\(id\)\)/i)
  })

  it('allows plant creation only for the authenticated owner and an active crop', () => {
    expect(migration).toMatch(/create policy plants_insert_own on public\.plants[\s\S]*?auth\.uid\(\)\s*=\s*farmer_id[\s\S]*?from public\.crops where id = crop_id and is_active = true/i)
  })

  it('restricts plant updates to the existing owner and has no farmer delete policy', () => {
    expect(migration).toMatch(/create policy plants_update_own on public\.plants[\s\S]*?using \(public\.is_owner_of_plant\(id\)\)[\s\S]*?with check \(public\.is_owner_of_plant\(id\)\)/i)
    expect(migration).not.toMatch(/create policy plants_delete_\w+ on public\.plants/i)
  })
  it('enforces profile role immutability in the trigger, not with OLD/NEW in an RLS policy', () => {
    const ownProfilePolicy = migration.match(/create policy profiles_update_own on public\.profiles[\s\S]*?;/i)?.[0]
    expect(ownProfilePolicy).toMatch(/with check \(auth\.uid\(\) = id\)/i)
    expect(ownProfilePolicy).not.toMatch(/\b(?:old|new)\.role\b/i)
    expect(migration).toMatch(/old\.role is distinct from new\.role[\s\S]*?old\.id = auth\.uid\(\)[\s\S]*?raise exception 'Cannot change your own role'/i)
  })
})

describe('farmer write scope lockdown (migration 005)', () => {
  it('removes farmer profile self-provisioning: accounts are administrator-provisioned only', () => {
    expect(lockdown).toMatch(/drop policy if exists profiles_insert_own on public\.profiles/i)
  })

  it('removes direct farmer analyses inserts: creation is server-controlled', () => {
    expect(lockdown).toMatch(/drop policy if exists analyses_insert_own on public\.analyses/i)
  })

  it('makes original storage objects immutable for farmers regardless of analysis status', () => {
    expect(lockdown).toMatch(/drop policy if exists plant_images_storage_update_own on storage\.objects/i)
    expect(lockdown).toMatch(/drop policy if exists plant_images_storage_delete_own on storage\.objects/i)
  })

  it('preserves farmer Storage INSERT/SELECT and administrator Storage SELECT policies', () => {
    expect(lockdown).not.toMatch(/drop policy if exists plant_images_storage_insert_own/i)
    expect(lockdown).not.toMatch(/drop policy if exists plant_images_storage_select_own/i)
    expect(lockdown).not.toMatch(/drop policy if exists plant_images_storage_select_admin/i)
  })

  it('does not weaken profile update policies or the administrator counter mechanism', () => {
    expect(lockdown).not.toMatch(/drop policy if exists profiles_update_own/i)
    expect(lockdown).not.toMatch(/drop policy if exists profiles_update_admin/i)
    expect(lockdown).not.toMatch(/alter table/i)
    expect(lockdown).not.toMatch(/drop (?:function|trigger)\s+[\s\S]*?maintain_admin_counter/i)
  })
})

describe('one analysis per image (migration 006)', () => {
  it('stops with an explicit human-review error when duplicates exist, without deleting records', () => {
    expect(uniqueIndex).toMatch(/having count\(\*\) > 1/i)
    expect(uniqueIndex).toMatch(/raise exception/i)
    expect(uniqueIndex).not.toMatch(/\bdelete\b|\bupdate\b(?!.*idx_one_analysis)/i)
  })

  it('creates the unique index on analyses.plant_image_id after the duplicate check', () => {
    expect(uniqueIndex).toMatch(
      /create unique index if not exists idx_one_analysis_per_image\s+on public\.analyses \(plant_image_id\)/i,
    )
  })

  it('is forward-only: does not add or re-create any RLS policy', () => {
    expect(uniqueIndex).not.toMatch(/create policy/i)
  })
})
