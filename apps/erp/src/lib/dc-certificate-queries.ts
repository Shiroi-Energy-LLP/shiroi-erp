import { createClient } from '@repo/supabase/server';
import type { Database } from '@repo/types/database';

type DcCertificateRow = Database['public']['Tables']['dc_certificates']['Row'];
type CertificateType = DcCertificateRow['certificate_type'];

export type { DcCertificateRow, CertificateType };

export const CERTIFICATE_TYPE_LABELS: Record<CertificateType, string> = {
  dc_completion: 'DC Completion Certificate',
  handing_over: 'Handing Over Certificate',
  net_metering_submission: 'Net Metering Submission',
};

export const CERTIFICATE_TYPE_ORDER: CertificateType[] = [
  'dc_completion',
  'handing_over',
  'net_metering_submission',
];

export interface DcCertificateWithEmployee extends DcCertificateRow {
  profiles: { full_name: string | null } | null;
}

export async function getDcCertificatesForProject(
  projectId: string,
): Promise<DcCertificateWithEmployee[]> {
  const op = '[getDcCertificatesForProject]';
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('dc_certificates')
    .select('*, profiles!dc_certificates_signed_by_employee_fkey(full_name)')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error(`${op} Query failed`, { code: error.code, message: error.message, projectId });
    return [];
  }

  return (data ?? []) as DcCertificateWithEmployee[];
}
