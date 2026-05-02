'use server';

/**
 * Vendor master server actions.
 *
 * RLS (migration 009): vendors_write allows founder, finance, project_manager,
 * purchase_officer. Anyone else is rejected at the DB.
 */

import { createClient } from '@repo/supabase/server';
import { revalidatePath } from 'next/cache';
import { ok, err, type ActionResult } from '@/lib/types/actions';
import type { Database } from '@repo/types/database';

type VendorInsert = Database['public']['Tables']['vendors']['Insert'];
type VendorUpdate = Database['public']['Tables']['vendors']['Update'];

const ALLOWED_VENDOR_TYPES = [
  'panel_supplier',
  'inverter_supplier',
  'structure_supplier',
  'cable_supplier',
  'electrical_supplier',
  'civil_contractor',
  'labour_contractor',
  'transport',
  'other',
] as const;

export type VendorType = (typeof ALLOWED_VENDOR_TYPES)[number];

export interface CreateVendorInput {
  companyName: string;
  vendorType: VendorType;
  contactPerson?: string;
  phone?: string;
  email?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  pincode?: string;
  gstin?: string;
  panNumber?: string;
  paymentTermsDays?: number;
  isMsme?: boolean;
  isPreferred?: boolean;
  notes?: string;
}

export async function createVendor(
  input: CreateVendorInput,
): Promise<ActionResult<{ vendorId: string; vendorCode: string }>> {
  const op = '[createVendor]';
  console.log(`${op} Starting`, { companyName: input.companyName, vendorType: input.vendorType });

  try {
    if (!input.companyName?.trim()) return err('Company name is required');
    if (!ALLOWED_VENDOR_TYPES.includes(input.vendorType)) {
      return err(`Invalid vendor type: ${input.vendorType}`);
    }
    if (!input.phone?.trim() && !input.email?.trim()) {
      return err('Provide at least a phone or email');
    }

    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return err('Not authenticated');

    // Auto-generate a unique vendor code: SHIROI/VEN/{YEAR}/{6-rand}.
    const randSuffix = Math.random().toString(36).slice(2, 8).toUpperCase();
    const vendorCode = `SHIROI/VEN/${new Date().getFullYear()}/${randSuffix}`;

    const insert: VendorInsert = {
      company_name: input.companyName.trim(),
      vendor_code: vendorCode,
      vendor_type: input.vendorType,
      contact_person: input.contactPerson?.trim() || null,
      phone: input.phone?.trim() || null,
      email: input.email?.trim() || null,
      address_line1: input.addressLine1?.trim() || null,
      address_line2: input.addressLine2?.trim() || null,
      city: input.city?.trim() || null,
      state: input.state?.trim() || null,
      pincode: input.pincode?.trim() || null,
      gstin: input.gstin?.trim() || null,
      pan_number: input.panNumber?.trim() || null,
      payment_terms_days: input.paymentTermsDays ?? 30,
      is_msme: input.isMsme ?? false,
      is_preferred: input.isPreferred ?? false,
      is_blacklisted: false,
      is_active: true,
      notes: input.notes?.trim() || null,
    };

    const { data, error } = await supabase
      .from('vendors')
      .insert(insert)
      .select('id, vendor_code')
      .single();

    if (error) {
      console.error(`${op} Insert failed`, {
        code: error.code,
        message: error.message,
        timestamp: new Date().toISOString(),
      });
      return err(error.message, error.code);
    }
    if (!data) return err('Vendor created but no row returned');

    revalidatePath('/vendors');
    return ok({ vendorId: data.id, vendorCode: data.vendor_code });
  } catch (e) {
    console.error(`${op} threw`, { e });
    return err(e instanceof Error ? e.message : 'Unknown error');
  }
}

export interface UpdateVendorInput extends Partial<CreateVendorInput> {
  vendorId: string;
  isActive?: boolean;
}

export async function updateVendor(
  input: UpdateVendorInput,
): Promise<ActionResult<void>> {
  const op = '[updateVendor]';
  console.log(`${op} Starting`, { vendorId: input.vendorId });

  try {
    if (!input.vendorId) return err('Vendor id is required');
    if (input.vendorType && !ALLOWED_VENDOR_TYPES.includes(input.vendorType)) {
      return err(`Invalid vendor type: ${input.vendorType}`);
    }

    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return err('Not authenticated');

    const update: VendorUpdate = {};
    if (input.companyName !== undefined) update.company_name = input.companyName.trim();
    if (input.vendorType !== undefined) update.vendor_type = input.vendorType;
    if (input.contactPerson !== undefined) update.contact_person = input.contactPerson.trim() || null;
    if (input.phone !== undefined) update.phone = input.phone.trim() || null;
    if (input.email !== undefined) update.email = input.email.trim() || null;
    if (input.addressLine1 !== undefined) update.address_line1 = input.addressLine1.trim() || null;
    if (input.addressLine2 !== undefined) update.address_line2 = input.addressLine2.trim() || null;
    if (input.city !== undefined) update.city = input.city.trim() || null;
    if (input.state !== undefined) update.state = input.state.trim() || null;
    if (input.pincode !== undefined) update.pincode = input.pincode.trim() || null;
    if (input.gstin !== undefined) update.gstin = input.gstin.trim() || null;
    if (input.panNumber !== undefined) update.pan_number = input.panNumber.trim() || null;
    if (input.paymentTermsDays !== undefined) update.payment_terms_days = input.paymentTermsDays;
    if (input.isMsme !== undefined) update.is_msme = input.isMsme;
    if (input.isPreferred !== undefined) update.is_preferred = input.isPreferred;
    if (input.isActive !== undefined) update.is_active = input.isActive;
    if (input.notes !== undefined) update.notes = input.notes.trim() || null;

    const { error } = await supabase
      .from('vendors')
      .update(update)
      .eq('id', input.vendorId);

    if (error) {
      console.error(`${op} Update failed`, {
        vendorId: input.vendorId,
        code: error.code,
        message: error.message,
      });
      return err(error.message, error.code);
    }

    revalidatePath('/vendors');
    return ok(undefined);
  } catch (e) {
    console.error(`${op} threw`, { e });
    return err(e instanceof Error ? e.message : 'Unknown error');
  }
}
