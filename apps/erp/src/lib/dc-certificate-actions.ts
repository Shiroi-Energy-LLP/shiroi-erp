'use server';

import { createClient } from '@repo/supabase/server';
import { revalidatePath } from 'next/cache';
import type { Database } from '@repo/types/database';
import { type ActionResult, ok, err } from '@/lib/types/actions';
import { headers } from 'next/headers';

type CertificateType = Database['public']['Tables']['dc_certificates']['Row']['certificate_type'];

interface SignDcCertificateInput {
  projectId: string;
  certificateType: CertificateType;
  customerName: string;
  customerPhone: string;
  notes?: string;
}

/**
 * Record a DC certificate signature (C12).
 * v1: typed name + phone, no OTP (deferred to Phase E).
 */
export async function signDcCertificate(
  input: SignDcCertificateInput,
): Promise<ActionResult<void>> {
  const op = '[signDcCertificate]';
  console.log(`${op} Starting`, { projectId: input.projectId, certificateType: input.certificateType });

  if (!input.projectId || !input.certificateType) return err('Missing required fields');
  if (!input.customerName.trim()) return err('Customer name is required');
  if (!input.customerPhone.trim()) return err('Customer phone is required');

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return err('Not authenticated');

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile || !['founder', 'project_manager', 'site_supervisor'].includes(profile.role)) {
    return err('Only founders, project managers, and site supervisors can record signatures');
  }

  // Immutability gate: a once-signed certificate cannot be re-signed.
  // The previous upsert pattern silently overwrote signer name, phone, IP, and
  // timestamp on every call — defeating the audit-trail intent of C12.
  const { data: existing, error: existErr } = await supabase
    .from('dc_certificates')
    .select('id, signed_at')
    .eq('project_id', input.projectId)
    .eq('certificate_type', input.certificateType)
    .maybeSingle();

  if (existErr) {
    console.error(`${op} existing-cert lookup failed`, {
      code: existErr.code,
      message: existErr.message,
      timestamp: new Date().toISOString(),
    });
    return err(existErr.message, existErr.code);
  }

  if (existing?.signed_at) {
    return err('This certificate has already been signed and cannot be re-signed.');
  }

  // Attempt to get caller IP (best-effort in Next.js)
  let ipAddress: string | null = null;
  try {
    const headersList = await headers();
    ipAddress =
      headersList.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      headersList.get('x-real-ip') ??
      null;
  } catch {
    // headers() not available in some call paths — safe to ignore
  }

  const { error } = await supabase
    .from('dc_certificates')
    .upsert(
      {
        project_id: input.projectId,
        certificate_type: input.certificateType,
        signed_by_employee: profile.id,
        signed_by_customer_name: input.customerName.trim(),
        signed_by_customer_phone: input.customerPhone.trim(),
        signed_at: new Date().toISOString(),
        otp_verified: false,
        ip_address: ipAddress,
        notes: input.notes?.trim() ?? null,
      },
      { onConflict: 'project_id,certificate_type' },
    );

  if (error) {
    console.error(`${op} Failed`, {
      code: error.code,
      message: error.message,
      projectId: input.projectId,
      certificateType: input.certificateType,
      timestamp: new Date().toISOString(),
    });
    return err(error.message, error.code);
  }

  revalidatePath(`/projects/${input.projectId}`);
  return ok(undefined);
}
