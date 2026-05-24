import { createClient } from '@repo/supabase/server';
import type { DcCertificateRow, CertificateType } from './dc-certificate-constants';

// Re-export constants + types for any code that imports them from the queries
// file. New client components should import directly from
// `./dc-certificate-constants` to keep the server client out of the client bundle.
export type { DcCertificateRow, CertificateType };
export { CERTIFICATE_TYPE_LABELS, CERTIFICATE_TYPE_ORDER } from './dc-certificate-constants';

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
