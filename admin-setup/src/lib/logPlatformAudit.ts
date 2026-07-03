import { supabase } from './supabase';

export type PlatformAuditCategory = 'auth' | 'admin' | 'security';

export async function logPlatformAudit(params: {
  category: PlatformAuditCategory;
  action: string;
  targetUserId?: string | null;
  targetEmail?: string | null;
  targetName?: string | null;
  eventId?: string | null;
  details?: Record<string, unknown>;
}): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) return;

  const { error } = await supabase.rpc('insert_platform_audit_log', {
    p_category: params.category,
    p_action: params.action,
    p_actor_user_id: user.id,
    p_target_user_id: params.targetUserId ?? null,
    p_target_email: params.targetEmail ?? null,
    p_target_name: params.targetName ?? null,
    p_event_id: params.eventId ?? null,
    p_ip_address: null,
    p_details: params.details ?? {},
  });
  if (error) {
    console.warn('[logPlatformAudit]', error.message);
  }
}
