'use server';

import { createClient } from '@repo/supabase/server';
import { revalidatePath } from 'next/cache';

// ── Contacts ──

export async function createContact(input: {
  name: string;
  phone?: string;
  email?: string;
  designation?: string;
  notes?: string;
}): Promise<{ success: boolean; contactId?: string; error?: string }> {
  const op = '[createContact]';
  console.log(`${op} Starting for: ${input.name}`);

  if (!input.name.trim()) return { success: false, error: 'Name is required' };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('contacts' as any)
    .insert({
      name: input.name.trim(),
      phone: input.phone?.trim() || null,
      email: input.email?.trim()?.toLowerCase() || null,
      designation: input.designation?.trim() || null,
      notes: input.notes?.trim() || null,
    })
    .select('id')
    .single();

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath('/contacts');
  return { success: true, contactId: (data as any).id };
}

export async function updateContact(id: string, input: {
  name?: string;
  phone?: string;
  email?: string;
  designation?: string;
  notes?: string;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[updateContact]';
  console.log(`${op} Starting for: ${id}`);

  const supabase = await createClient();
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.name !== undefined) updates.name = input.name.trim();
  if (input.phone !== undefined) updates.phone = input.phone.trim() || null;
  if (input.email !== undefined) updates.email = input.email.trim().toLowerCase() || null;
  if (input.designation !== undefined) updates.designation = input.designation.trim() || null;
  if (input.notes !== undefined) updates.notes = input.notes.trim() || null;

  const { error } = await supabase.from('contacts' as any).update(updates).eq('id', id);
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
    .from('companies' as any)
    .insert({
      name: input.name.trim(),
      segment: input.segment as any,
      gstin: input.gstin?.trim() || null,
      address_line1: input.addressLine1?.trim() || null,
      address_line2: input.addressLine2?.trim() || null,
      city: input.city?.trim() || null,
      state: input.state?.trim() || 'Tamil Nadu',
      pincode: input.pincode?.trim() || null,
      website: input.website?.trim() || null,
      notes: input.notes?.trim() || null,
    })
    .select('id')
    .single();

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath('/companies');
  return { success: true, companyId: (data as any).id };
}

export async function updateCompany(id: string, input: {
  name?: string;
  segment?: string;
  gstin?: string;
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
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.name !== undefined) updates.name = input.name.trim();
  if (input.segment !== undefined) updates.segment = input.segment;
  if (input.gstin !== undefined) updates.gstin = input.gstin.trim() || null;
  if (input.addressLine1 !== undefined) updates.address_line1 = input.addressLine1.trim() || null;
  if (input.addressLine2 !== undefined) updates.address_line2 = input.addressLine2.trim() || null;
  if (input.city !== undefined) updates.city = input.city.trim() || null;
  if (input.state !== undefined) updates.state = input.state.trim() || null;
  if (input.pincode !== undefined) updates.pincode = input.pincode.trim() || null;
  if (input.website !== undefined) updates.website = input.website.trim() || null;
  if (input.notes !== undefined) updates.notes = input.notes.trim() || null;

  const { error } = await supabase.from('companies' as any).update(updates).eq('id', id);
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
    .from('entity_contacts' as any)
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
    .from('entity_contacts' as any)
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
    .from('contact_company_roles' as any)
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
    .from('contact_company_roles' as any)
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
