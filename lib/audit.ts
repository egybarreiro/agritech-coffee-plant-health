import { createServiceClient } from '@/lib/supabase/service'

/**
 * Creates an immutable audit log entry.
 * Only the service role can insert into audit_logs (RLS enforced).
 */
export async function createAuditLog(
  supabase: ReturnType<typeof createServiceClient>,
  actorId: string | null,
  action: string,
  entityType: string,
  entityId: string | null,
  details: Record<string, unknown> = {}
) {
  const { error } = await supabase.from('audit_logs').insert({
    actor_id: actorId,
    action,
    entity_type: entityType,
    entity_id: entityId,
    details,
  })

  if (error) throw new Error('Failed to write audit log')
}

