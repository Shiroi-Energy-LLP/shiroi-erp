'use server';

import { getOrphansForCustomer, getCandidateProjectsForCustomer, searchAllProjects } from '@/lib/orphan-triage-queries';
import { createClient } from '@repo/supabase/server';

export async function getOrphansForCustomerClient(name: string) {
  return getOrphansForCustomer(name);
}

export async function fetchCandidatesClient(name: string) {
  return getCandidateProjectsForCustomer(name);
}

export async function fetchAllProjectsClient(query: string) {
  return searchAllProjects(query);
}

export async function fetchByStatus(status: 'deferred' | 'excluded') {
  const supabase = await createClient();
  const [inv, pay] = await Promise.all([
    supabase
      .from('invoices')
      .select('id, invoice_number, invoice_date, total_amount, zoho_customer_name, attribution_status, excluded_from_cash')
      .eq('source', 'zoho_import')
      .eq('attribution_status', status)
      .order('invoice_date', { ascending: false })
      .limit(200),
    supabase
      .from('customer_payments')
      .select('id, receipt_number, payment_date, amount, zoho_customer_name, attribution_status, excluded_from_cash')
      .eq('source', 'zoho_import')
      .eq('attribution_status', status)
      .order('payment_date', { ascending: false })
      .limit(200),
  ]);
  return {
    invoices: inv.data ?? [],
    payments: pay.data ?? [],
  };
}

import { getAttributionAudit } from '@/lib/orphan-triage-queries';

export async function fetchAuditClient(opts: { page: number; decision?: string }) {
  return getAttributionAudit(opts);
}
