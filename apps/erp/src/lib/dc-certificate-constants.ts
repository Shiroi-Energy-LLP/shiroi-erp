/**
 * dc-certificate-constants.ts
 *
 * Constants + type alias for DC certificates. **No server imports** — safe to
 * import from `'use client'` components. Mirrors the pattern in
 * `documents-constants.ts`.
 *
 * The corresponding query/RPC code lives in `dc-certificate-queries.ts` and
 * imports the server Supabase client; a client component pulling
 * `CERTIFICATE_TYPE_LABELS` from there would fail the Next.js production
 * build with "You're importing a component that needs next/headers".
 */

import type { Database } from '@repo/types/database';

export type DcCertificateRow = Database['public']['Tables']['dc_certificates']['Row'];
export type CertificateType = DcCertificateRow['certificate_type'];

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
