'use server';

import { createClient } from '@repo/supabase/server';
import { revalidatePath } from 'next/cache';

// ── Contacts ──

export async function createContact(input: {
  firstName: string;
  lastName?: string;
  phone?: string;
  secondaryPhone?: string;
  email?: string;
  designation?: string;
  lifecycleStage?: string;
  source?: string;
  notes?: string;
}): Promise<{ success: boolean; contactId?: string; error?: string }> {
  const op = '[createContact]';
  console.log(`${op} Starting for: ${input.firstName} ${input.lastName ?? ''}`);

  if (!input.firstName.trim()) return { success: false, error: 'First name is required' };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('contacts')
    .insert({
      first_name: input.firstName.trim(),
      last_name: input.lastName?.trim() || null,
      name: `${input.firstName.trim()} ${input.lastName?.trim() || ''}`.trim(),
      phone: input.phone?.trim() || null,
      secondary_phone: input.secondaryPhone?.trim() || null,
      email: input.email?.trim()?.toLowerCase() || null,
      designation: input.designation?.trim() || null,
      lifecycle_stage: input.lifecycleStage || 'lead',
      source: input.source?.trim() || null,
      notes: input.notes?.trim() || null,
    } as any)
    .select('id')
    .single();

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath('/contacts');
  return { success: true, contactId: data.id };
}

export async function updateContact(id: string, input: {
  firstName?: string;
  lastName?: string;
  phone?: string;
  secondaryPhone?: string;
  email?: string;
  designation?: string;
  lifecycleStage?: string;
  source?: string;
  notes?: string;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[updateContact]';
  console.log(`${op} Starting for: ${id}`);

  const supabase = await createClient();
  const updates: Record<string, unknown> = {};
  if (input.firstName !== undefined) updates.first_name = input.firstName.trim();
  if (input.lastName !== undefined) updates.last_name = input.lastName.trim() || null;
  if (input.firstName !== undefined || input.lastName !== undefined) {
    const fn = input.firstName?.trim() ?? '';
    const ln = input.lastName?.trim() ?? '';
    updates.name = `${fn} ${ln}`.trim();
  }
  if (input.phone !== undefined) updates.phone = input.phone.trim() || null;
  if (input.secondaryPhone !== undefined) updates.secondary_phone = input.secondaryPhone.trim() || null;
  if (input.email !== undefined) updates.email = input.email.trim().toLowerCase() || null;
  if (input.designation !== undefined) updates.designation = input.designation.trim() || null;
  if (input.lifecycleStage !== undefined) updates.lifecycle_stage = input.lifecycleStage;
  if (input.source !== undefined) updates.source = input.source.trim() || null;
  if (input.notes !== undefined) updates.notes = input.notes.trim() || null;

  const { error } = await supabase.from('contacts').update(updates as any).eq('id', id);
  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath('/contacts');
  revalidatePath(`/contacts/${id}`);
  return { success: true };
}

// ── Companies ──

export async function createCompany(input: {
  name: string;
  segment: string;
  gstin?: string;
  pan?: string;
  industry?: string;
  companySize?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  pincode?: string;
  website?: string;
  notes?: string;
}): Promise<{ success: boolean; companyId?: string; error?: string }> {
  const op = '[createCompany]';
  console.log(`${op} Starting for: ${input.name}`);

  if (!input.name.trim()) return { success: false, error: 'Company name is required' };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('companies')
    .insert({
      name: input.name.trim(),
      segment: input.segment as any,
      gstin: input.gstin?.trim() || null,
      pan: input.pan?.trim() || null,
      industry: input.industry?.trim() || null,
      company_size: input.companySize || null,
      address_line1: input.addressLine1?.trim() || null,
      address_line2: input.addressLine2?.trim() || null,
      city: input.city?.trim() || null,
      state: input.state?.trim() || 'Tamil Nadu',
      pincode: input.pincode?.trim() || null,
      website: input.website?.trim() || null,
      notes: input.notes?.trim() || null,
    } as any)
    .select('id')
    .single();

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath('/companies');
  return { success: true, companyId: data.id };
}

export async function updateCompany(id: string, input: {
  name?: string;
  segment?: string;
  gstin?: string;
  pan?: string;
  industry?: string;
  companySize?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  pincode?: string;
  website?: string;
  notes?: string;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[updateCompany]';
  console.log(`${op} Starting for: ${id}`);

  const supabase = await createClient();
  const updates: Record<string, unknown> = {};
  if (input.name !== undefined) updates.name = input.name.trim();
  if (input.segment !== undefined) updates.segment = input.segment;
  if (input.gstin !== undefined) updates.gstin = input.gstin.trim() || null;
  if (input.pan !== undefined) updates.pan = input.pan.trim() || null;
  if (input.industry !== undefined) updates.industry = input.industry.trim() || null;
  if (input.companySize !== undefined) updates.company_size = input.companySize || null;
  if (input.addressLine1 !== undefined) updates.address_line1 = input.addressLine1.trim() || null;
  if (input.addressLine2 !== undefined) updates.address_line2 = input.addressLine2.trim() || null;
  if (input.city !== undefined) updates.city = input.city.trim() || null;
  if (input.state !== undefined) updates.state = input.state.trim() || null;
  if (input.pincode !== undefined) updates.pincode = input.pincode.trim() || null;
  if (input.website !== undefined) updates.website = input.website.trim() || null;
  if (input.notes !== undefined) updates.notes = input.notes.trim() || null;

  const { error } = await supabase.from('companies').update(updates as any).eq('id', id);
  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath('/companies');
  revalidatePath(`/companies/${id}`);
  return { success: true };
}

// ── Link/Unlink Contacts to Entities ──

export async function linkContactToEntity(input: {
  contactId: string;
  entityType: 'lead' | 'proposal' | 'project';
  entityId: string;
  roleLabel?: string;
  isPrimary?: boolean;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[linkContactToEntity]';
  console.log(`${op} Linking contact ${input.contactId} to ${input.entityType}/${input.entityId}`);

  const supabase = await createClient();
  const { error } = await supabase
    .from('entity_contacts')
    .insert({
      contact_id: input.contactId,
      entity_type: input.entityType,
      entity_id: input.entityId,
      role_label: input.roleLabel?.trim() || null,
      is_primary: input.isPrimary ?? false,
    });

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    if (error.code === '23505') return { success: false, error: 'This contact is already linked' };
    return { success: false, error: error.message };
  }

  revalidatePath(`/leads`);
  revalidatePath(`/proposals`);
  revalidatePath(`/projects`);
  return { success: true };
}

export async function unlinkContactFromEntity(entityContactId: string): Promise<{ success: boolean; error?: string }> {
  const op = '[unlinkContactFromEntity]';
  console.log(`${op} Unlinking: ${entityContactId}`);

  const supabase = await createClient();
  const { error } = await supabase
    .from('entity_contacts')
    .delete()
    .eq('id', entityContactId);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath(`/leads`);
  revalidatePath(`/proposals`);
  revalidatePath(`/projects`);
  return { success: true };
}

// ── Contact-Company Role ──

export async function addContactToCompany(input: {
  contactId: string;
  companyId: string;
  roleTitle: string;
  isPrimary?: boolean;
  startedAt?: string;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[addContactToCompany]';
  console.log(`${op} Adding contact ${input.contactId} to company ${input.companyId}`);

  const supabase = await createClient();
  const { error } = await supabase
    .from('contact_company_roles')
    .insert({
      contact_id: input.contactId,
      company_id: input.companyId,
      role_title: input.roleTitle.trim(),
      is_primary: input.isPrimary ?? false,
      started_at: input.startedAt || null,
    });

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath(`/contacts/${input.contactId}`);
  revalidatePath(`/companies/${input.companyId}`);
  return { success: true };
}

export async function endContactCompanyRole(roleId: string): Promise<{ success: boolean; error?: string }> {
  const op = '[endContactCompanyRole]';
  console.log(`${op} Ending role: ${roleId}`);

  const supabase = await createClient();
  const { error } = await supabase
    .from('contact_company_roles')
    .update({ ended_at: new Date().toISOString().split('T')[0] })
    .eq('id', roleId);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath('/contacts');
  revalidatePath('/companies');
  return { success: true };
}

// ── Activities ──

export async function createActivity(input: {
  activityType: string;
  title?: string;
  body?: string;
  occurredAt?: string;
  durationMinutes?: number;
  metadata?: Record<string, unknown>;
  entityLinks: { entityType: string; entityId: string }[];
}): Promise<{ success: boolean; activityId?: string; error?: string }> {
  const op = '[createActivity]';
  console.log(`${op} Starting: ${input.activityType}`);

  const supabase = await createClient();

  // Get current user profile id
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const { data: activity, error: actErr } = await supabase
    .from('activities')
    .insert({
      activity_type: input.activityType,
      title: input.title?.trim() || null,
      body: input.body?.trim() || null,
      occurred_at: input.occurredAt || new Date().toISOString(),
      duration_minutes: input.durationMinutes || null,
      owner_id: user.id,
      metadata: input.metadata || {},
    } as any)
    .select('id')
    .single() as any;

  if (actErr) {
    console.error(`${op} Insert failed:`, { code: actErr.code, message: actErr.message });
    return { success: false, error: actErr.message };
  }

  // Create associations
  if (input.entityLinks.length > 0) {
    const assocs = input.entityLinks.map((link) => ({
      activity_id: activity.id,
      entity_type: link.entityType,
      entity_id: link.entityId,
    }));

    const { error: linkErr } = await supabase
      .from('activity_associations')
      .insert(assocs as any);

    if (linkErr) {
      console.error(`${op} Association failed:`, { code: linkErr.code, message: linkErr.message });
    }
  }

  // Revalidate relevant paths
  for (const link of input.entityLinks) {
    revalidatePath(`/${link.entityType}s/${link.entityId}`);
  }
  revalidatePath('/contacts');
  revalidatePath('/companies');

  return { success: true, activityId: activity.id };
}
