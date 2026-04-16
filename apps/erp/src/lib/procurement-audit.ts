import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@repo/types/database';

// ═══════════════════════════════════════════════════════════════════════
// Procurement Audit Log Helper
//
// Fire-and-forget audit trail for all procurement mutations.
// NEVER throws — failures are logged to console only so they don't
// interrupt the caller's transaction.
// ═══════════════════════════════════════════════════════════════════════

export type ProcurementAuditInput = {
  entityType: 'rfq' | 'rfq_invitation' | 'rfq_quote' | 'rfq_award' | 'purchase_order' | 'boq_item';
  entityId: string;
  action: string;
  actorId: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string;
};

type AuditInsert = Database['public']['Tables']['procurement_audit_log']['Insert'];

export async function logProcurementAudit(
  supabase: SupabaseClient<Database>,
  input: ProcurementAuditInput,
): Promise<void> {
  const op = '[logProcurementAudit]';
  try {
    const row: AuditInsert = {
      entity_type: input.entityType,
      entity_id: input.entityId,
      action: input.action,
      actor_id: input.actorId,
      old_value: input.oldValue !== undefined ? (input.oldValue as Database['public']['Tables']['procurement_audit_log']['Insert']['old_value']) : null,
      new_value: input.newValue !== undefined ? (input.newValue as Database['public']['Tables']['procurement_audit_log']['Insert']['new_value']) : null,
      reason: input.reason ?? null,
    };

    const { error } = await supabase
      .from('procurement_audit_log')
      .insert(row);

    if (error) {
      console.error(`${op} Insert failed`, {
        entity_type: input.entityType,
        entity_id: input.entityId,
        action: input.action,
        code: error.code,
        message: error.message,
      });
    }
  } catch (e) {
    console.error(`${op} Threw unexpectedly`, {
      entity_type: input.entityType,
      entity_id: input.entityId,
      action: input.action,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
