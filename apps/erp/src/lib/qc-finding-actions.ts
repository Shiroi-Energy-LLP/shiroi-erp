'use server';

/**
 * S16 — B2 QC Finding Review Actions
 *
 * PM-level server actions for reviewing AI photo QC findings.
 * All three actions update pm_reviewed_at, pm_reviewed_by, pm_decision, pm_notes.
 * escalateQcFinding additionally creates a critical task assigned to the PM.
 */

import { revalidatePath } from 'next/cache';
import { createClient } from '@repo/supabase/server';
import { createAdminClient } from '@repo/supabase/admin';
import { ok, err, type ActionResult } from '@/lib/types/actions';
import type { Database } from '@repo/types/database';

type QcFindingUpdate = Database['public']['Tables']['qc_photo_findings']['Update'];
type TaskInsert = Database['public']['Tables']['tasks']['Insert'];

const REVIEWER_ROLES = new Set(['founder', 'project_manager']);

async function getCurrentUserAndRole(): Promise<
  { userId: string; role: string } | null
> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();

  if (authErr || !user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile) return null;
  return { userId: user.id, role: profile.role };
}

async function loadFinding(findingId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('qc_photo_findings')
    .select('id, project_id, finding_type, severity, ai_description, pm_reviewed_at')
    .eq('id', findingId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data;
}

/**
 * Accept a QC finding — PM has verified the issue is real and it's been noted.
 */
export async function acceptQcFinding(
  findingId: string,
  notes?: string,
): Promise<ActionResult<void>> {
  const op = '[acceptQcFinding]';

  const actor = await getCurrentUserAndRole();
  if (!actor) return err('Not authenticated');
  if (!REVIEWER_ROLES.has(actor.role)) {
    return err('Insufficient permissions — founder or project_manager required');
  }

  try {
    const finding = await loadFinding(findingId);
    if (!finding) return err('Finding not found');

    const update: QcFindingUpdate = {
      pm_reviewed_at: new Date().toISOString(),
      pm_reviewed_by: actor.userId,
      pm_decision: 'accepted',
      pm_notes: notes ?? null,
    };

    const admin = createAdminClient();
    const { error: updateErr } = await admin
      .from('qc_photo_findings')
      .update(update)
      .eq('id', findingId);

    if (updateErr) {
      console.error(`${op} update failed`, {
        findingId,
        error: updateErr.message,
        timestamp: new Date().toISOString(),
      });
      return err(updateErr.message, updateErr.code);
    }

    revalidatePath(`/projects/${finding.project_id}`, 'page');
    return ok(undefined);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${op} threw`, { findingId, error: msg, timestamp: new Date().toISOString() });
    return err(msg);
  }
}

/**
 * Dismiss a QC finding as a false positive — logged for prompt tuning.
 */
export async function dismissQcFinding(
  findingId: string,
  notes?: string,
): Promise<ActionResult<void>> {
  const op = '[dismissQcFinding]';

  const actor = await getCurrentUserAndRole();
  if (!actor) return err('Not authenticated');
  if (!REVIEWER_ROLES.has(actor.role)) {
    return err('Insufficient permissions — founder or project_manager required');
  }

  try {
    const finding = await loadFinding(findingId);
    if (!finding) return err('Finding not found');

    const update: QcFindingUpdate = {
      pm_reviewed_at: new Date().toISOString(),
      pm_reviewed_by: actor.userId,
      pm_decision: 'dismissed_false_positive',
      pm_notes: notes ?? null,
    };

    const admin = createAdminClient();
    const { error: updateErr } = await admin
      .from('qc_photo_findings')
      .update(update)
      .eq('id', findingId);

    if (updateErr) {
      console.error(`${op} update failed`, {
        findingId,
        error: updateErr.message,
        timestamp: new Date().toISOString(),
      });
      return err(updateErr.message, updateErr.code);
    }

    console.log(`${op} false positive logged`, {
      findingId,
      reviewer: actor.userId,
      timestamp: new Date().toISOString(),
    });

    revalidatePath(`/projects/${finding.project_id}`, 'page');
    return ok(undefined);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${op} threw`, { findingId, error: msg, timestamp: new Date().toISOString() });
    return err(msg);
  }
}

/**
 * Escalate a QC finding — marks as escalated and creates a critical task for the PM.
 */
export async function escalateQcFinding(
  findingId: string,
  notes?: string,
): Promise<ActionResult<void>> {
  const op = '[escalateQcFinding]';

  const actor = await getCurrentUserAndRole();
  if (!actor) return err('Not authenticated');
  if (!REVIEWER_ROLES.has(actor.role)) {
    return err('Insufficient permissions — founder or project_manager required');
  }

  try {
    const finding = await loadFinding(findingId);
    if (!finding) return err('Finding not found');

    const admin = createAdminClient();

    // Update the finding
    const update: QcFindingUpdate = {
      pm_reviewed_at: new Date().toISOString(),
      pm_reviewed_by: actor.userId,
      pm_decision: 'escalated',
      pm_notes: notes ?? null,
    };

    const { error: updateErr } = await admin
      .from('qc_photo_findings')
      .update(update)
      .eq('id', findingId);

    if (updateErr) {
      console.error(`${op} update failed`, {
        findingId,
        error: updateErr.message,
        timestamp: new Date().toISOString(),
      });
      return err(updateErr.message, updateErr.code);
    }

    // Create a critical task for the PM
    const taskTitle = `[QC ESCALATED] ${finding.finding_type.replace(/_/g, ' ')} — photo finding #${findingId.slice(0, 8)}`;
    const taskDescription = [
      `AI QC finding escalated: ${finding.ai_description}`,
      notes ? `Escalation notes: ${notes}` : null,
      `Finding ID: ${findingId}`,
    ]
      .filter(Boolean)
      .join('\n');

    // Look up the project manager (employee id) for this project
    const { data: projectRow } = await admin
      .from('projects')
      .select('project_manager_id')
      .eq('id', finding.project_id)
      .maybeSingle();

    const assigneeEmployeeId = projectRow?.project_manager_id ?? null;

    // Resolve the actor's employee id for created_by
    const { data: actorEmployee } = await admin
      .from('employees')
      .select('id')
      .eq('profile_id', actor.userId)
      .maybeSingle();

    if (assigneeEmployeeId && actorEmployee?.id) {
      const taskInsert: TaskInsert = {
        id: crypto.randomUUID(),
        title: taskTitle,
        description: taskDescription,
        project_id: finding.project_id,
        entity_type: 'project',
        entity_id: finding.project_id,
        category: 'project_followup',
        priority: 'high',
        due_date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        assigned_to: assigneeEmployeeId,
        created_by: actorEmployee.id,
      };

      const { error: taskErr } = await admin.from('tasks').insert(taskInsert);

      if (taskErr) {
        // Non-fatal: task creation failure doesn't roll back the escalation
        console.error(`${op} task creation failed (escalation still saved)`, {
          findingId,
          error: taskErr.message,
          timestamp: new Date().toISOString(),
        });
      }
    } else {
      console.warn(`${op} skipping task creation — missing assignee or actor employee id`, {
        findingId,
        has_assignee: !!assigneeEmployeeId,
        has_actor: !!actorEmployee?.id,
        timestamp: new Date().toISOString(),
      });
    }

    revalidatePath(`/projects/${finding.project_id}`, 'page');
    return ok(undefined);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${op} threw`, { findingId, error: msg, timestamp: new Date().toISOString() });
    return err(msg);
  }
}
