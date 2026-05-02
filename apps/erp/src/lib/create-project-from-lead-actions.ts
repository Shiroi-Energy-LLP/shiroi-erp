'use server';

import { createClient } from '@repo/supabase/server';
import { revalidatePath } from 'next/cache';
import { ok, err, type ActionResult } from '@/lib/types/actions';

/**
 * Manual fallback when the won → proposal-accepted → project cascade
 * doesn't fire (e.g. lead bulk-imported as 'won' with the proposal
 * already 'accepted', so the lead trigger no-ops).
 *
 * Inserts a project row mirroring create_project_from_accepted_proposal
 * (migs 063/064/094). The BEFORE INSERT trigger
 * trg_default_project_manager_on_insert (mig 104) fills
 * project_manager_id with the latest active PM (Manivel today).
 *
 * Idempotent: if a non-deleted project already exists for this lead,
 * returns its id unchanged.
 *
 * Requires a proposal — projects.proposal_id is NOT NULL. If the lead
 * has no proposal yet, return an error so the user creates a quote
 * first.
 */
export async function createProjectFromLead(
  leadId: string,
): Promise<ActionResult<{ projectId: string; projectNumber: string }>> {
  const op = '[createProjectFromLead]';
  console.log(`${op} starting`, { leadId });

  const supabase = await createClient();

  const { data: lead, error: leadErr } = await supabase
    .from('leads')
    .select(
      'id, status, customer_name, phone, email, address_line1, city, state, pincode, map_link',
    )
    .eq('id', leadId)
    .single();
  if (leadErr) {
    console.error(`${op} lead lookup failed`, { leadId, error: leadErr });
    return err(leadErr.message, leadErr.code);
  }
  if (!lead) {
    return err('Lead not found');
  }
  if (lead.status !== 'won') {
    return err(`Lead is "${lead.status}", not won — only won leads can spawn a project`);
  }

  const { data: existing, error: existingErr } = await supabase
    .from('projects')
    .select('id, project_number')
    .eq('lead_id', leadId)
    .is('deleted_at', null)
    .maybeSingle();
  if (existingErr) {
    console.error(`${op} existing-project lookup failed`, { leadId, error: existingErr });
    return err(existingErr.message, existingErr.code);
  }
  if (existing) {
    console.log(`${op} idempotent — project already exists`, {
      leadId,
      projectId: existing.id,
    });
    return ok({ projectId: existing.id, projectNumber: existing.project_number });
  }

  const { data: proposal, error: proposalErr } = await supabase
    .from('proposals')
    .select(
      'id, system_type, system_size_kwp, panel_brand, panel_model, panel_wattage, panel_count, inverter_brand, inverter_model, inverter_capacity_kw, battery_brand, battery_model, battery_capacity_kwh, total_after_discount',
    )
    .eq('lead_id', leadId)
    .order('is_budgetary', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (proposalErr) {
    console.error(`${op} proposal lookup failed`, { leadId, error: proposalErr });
    return err(proposalErr.message, proposalErr.code);
  }
  if (!proposal) {
    return err(
      'No proposal found for this lead. Create a quote first, then retry "Create project".',
    );
  }

  const { data: docNum, error: docNumErr } = await supabase.rpc('generate_doc_number', {
    doc_type: 'PROJ',
  });
  if (docNumErr || !docNum) {
    console.error(`${op} project-number generation failed`, { leadId, error: docNumErr });
    return err(docNumErr?.message ?? 'Could not allocate project number', docNumErr?.code);
  }

  const { data: inserted, error: insErr } = await supabase
    .from('projects')
    .insert({
      lead_id: leadId,
      proposal_id: proposal.id,
      project_number: docNum,
      customer_name: lead.customer_name,
      customer_phone: lead.phone,
      customer_email: lead.email,
      site_address_line1: lead.address_line1 ?? lead.city ?? 'Address pending',
      site_city: lead.city ?? 'Chennai',
      site_state: lead.state ?? 'Tamil Nadu',
      site_pincode: lead.pincode,
      location_map_link: lead.map_link,
      system_type: proposal.system_type,
      system_size_kwp: proposal.system_size_kwp ?? 0,
      panel_brand: proposal.panel_brand,
      panel_model: proposal.panel_model,
      panel_wattage: proposal.panel_wattage,
      panel_count: proposal.panel_count ?? 0,
      inverter_brand: proposal.inverter_brand,
      inverter_model: proposal.inverter_model,
      inverter_capacity_kw: proposal.inverter_capacity_kw,
      battery_brand: proposal.battery_brand,
      battery_model: proposal.battery_model,
      battery_capacity_kwh: proposal.battery_capacity_kwh,
      contracted_value: proposal.total_after_discount ?? 0,
      advance_amount: 0,
      advance_received_at: new Date().toISOString().slice(0, 10),
      status: 'order_received',
    })
    .select('id, project_number')
    .single();
  if (insErr) {
    console.error(`${op} project insert failed`, { leadId, error: insErr });
    return err(insErr.message, insErr.code);
  }
  if (!inserted) {
    return err('Project insert returned no row — RLS may be blocking');
  }

  revalidatePath(`/sales/${leadId}`);
  revalidatePath(`/leads/${leadId}`);
  revalidatePath('/projects');

  console.log(`${op} done`, { leadId, projectId: inserted.id });
  return ok({ projectId: inserted.id, projectNumber: inserted.project_number });
}
