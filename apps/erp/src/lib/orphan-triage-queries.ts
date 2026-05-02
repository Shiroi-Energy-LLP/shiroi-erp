// apps/erp/src/lib/orphan-triage-queries.ts
import { createClient } from '@repo/supabase/server';
import { unstable_cache } from 'next/cache';
import type { Database } from '@repo/types/database';

type Invoice = Database['public']['Tables']['invoices']['Row'];
type CustomerPayment = Database['public']['Tables']['customer_payments']['Row'];

export interface OrphanCustomerSummary {
  zoho_customer_name: string;
  invoice_count: number;
  invoice_total: string;
  payment_count: number;
  payment_total: string;
  candidate_project_count: number;
}

export interface OrphanInvoiceWithLineItems {
  invoice: Invoice;
  line_items: Array<{
    line_number: number;
    item_name: string | null;
    item_description: string | null;
    quantity: number;
    rate: number;
    amount: number;
  }>;
  linked_payments: CustomerPayment[];
}

export interface CandidateProject {
  project_id: string;
  project_number: string;
  customer_name: string;
  status: string;
  system_size_kwp: number | null;
  system_type: string | null;
  contracted_value: string;
  total_invoiced: string;
  total_received: string;
  net_cash_position: string;
  actual_start_date: string | null;
  actual_end_date: string | null;
}

export interface OrphanCounts {
  pendingInvoiceCount: number;
  pendingInvoiceTotal: string;
  pendingPaymentCount: number;
  pendingPaymentTotal: string;
  excludedCount: number;
  excludedTotal: string;
  deferredCount: number;
}

// ── Left pane ──

export async function getOrphanCustomerSummary(): Promise<OrphanCustomerSummary[]> {
  const op = '[getOrphanCustomerSummary]';
  console.log(`${op} Starting`);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('get_orphan_zoho_customer_summary');
  if (error) {
    console.error(`${op} RPC failed`, { error });
    throw new Error(`Failed to load orphan customer summary: ${error.message}`);
  }
  return (data ?? []).map((r: any) => ({
    zoho_customer_name: r.zoho_customer_name,
    invoice_count: Number(r.invoice_count),
    invoice_total: String(r.invoice_total ?? '0'),
    payment_count: Number(r.payment_count),
    payment_total: String(r.payment_total ?? '0'),
    candidate_project_count: Number(r.candidate_project_count),
  }));
}

// ── Middle pane ──

export async function getOrphansForCustomer(zohoCustomerName: string): Promise<{
  invoices: OrphanInvoiceWithLineItems[];
  orphan_payments_no_invoice: CustomerPayment[];
}> {
  const op = '[getOrphansForCustomer]';
  console.log(`${op} Starting`, { zohoCustomerName });
  const supabase = await createClient();

  const { data: invoices, error: invErr } = await supabase
    .from('invoices')
    .select('*')
    .eq('source', 'zoho_import')
    .eq('attribution_status', 'pending')
    .eq('zoho_customer_name', zohoCustomerName)
    .order('invoice_date', { ascending: false });
  if (invErr) {
    console.error(`${op} invoices query failed`, { error: invErr });
    throw new Error(`Failed to load orphan invoices: ${invErr.message}`);
  }

  const invoiceIds = (invoices ?? []).map((i) => i.id);

  const lineItemsByInvoice = new Map<string, OrphanInvoiceWithLineItems['line_items']>();
  if (invoiceIds.length > 0) {
    const { data: lineItems, error: liErr } = await supabase
      .from('zoho_invoice_line_items')
      .select('invoice_id, line_number, item_name, item_description, quantity, rate, amount')
      .in('invoice_id', invoiceIds)
      .order('line_number', { ascending: true });
    if (liErr) {
      console.error(`${op} line items query failed`, { error: liErr });
      throw new Error(`Failed to load line items: ${liErr.message}`);
    }
    for (const li of lineItems ?? []) {
      const arr = lineItemsByInvoice.get(li.invoice_id) ?? [];
      arr.push({
        line_number: li.line_number,
        item_name: li.item_name,
        item_description: li.item_description,
        quantity: Number(li.quantity ?? 0),
        rate: Number(li.rate ?? 0),
        amount: Number(li.amount ?? 0),
      });
      lineItemsByInvoice.set(li.invoice_id, arr);
    }
  }

  const linkedByInvoice = new Map<string, CustomerPayment[]>();
  if (invoiceIds.length > 0) {
    const { data: linked, error: lpErr } = await supabase
      .from('customer_payments')
      .select('*')
      .in('invoice_id', invoiceIds)
      .order('payment_date', { ascending: false });
    if (lpErr) {
      console.error(`${op} linked payments query failed`, { error: lpErr });
      throw new Error(`Failed to load linked payments: ${lpErr.message}`);
    }
    for (const p of linked ?? []) {
      if (!p.invoice_id) continue;
      const arr = linkedByInvoice.get(p.invoice_id) ?? [];
      arr.push(p);
      linkedByInvoice.set(p.invoice_id, arr);
    }
  }

  const { data: advances, error: advErr } = await supabase
    .from('customer_payments')
    .select('*')
    .eq('source', 'zoho_import')
    .eq('attribution_status', 'pending')
    .eq('zoho_customer_name', zohoCustomerName)
    .is('invoice_id', null)
    .order('payment_date', { ascending: false });
  if (advErr) {
    console.error(`${op} advances query failed`, { error: advErr });
    throw new Error(`Failed to load orphan advance payments: ${advErr.message}`);
  }

  return {
    invoices: (invoices ?? []).map((inv) => ({
      invoice: inv,
      line_items: lineItemsByInvoice.get(inv.id) ?? [],
      linked_payments: linkedByInvoice.get(inv.id) ?? [],
    })),
    orphan_payments_no_invoice: advances ?? [],
  };
}

// ── Right pane ──

export async function getCandidateProjectsForCustomer(zohoCustomerName: string): Promise<CandidateProject[]> {
  const op = '[getCandidateProjectsForCustomer]';
  console.log(`${op} Starting`, { zohoCustomerName });
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    'get_candidate_projects_for_zoho_customer',
    { p_zoho_name: zohoCustomerName },
  );
  if (error) {
    console.error(`${op} RPC failed`, { error });
    throw new Error(`Failed to load candidate projects: ${error.message}`);
  }
  return (data ?? []).map((r: any) => ({
    project_id: r.project_id,
    project_number: r.project_number,
    customer_name: r.customer_name,
    status: r.status,
    system_size_kwp: r.system_size_kwp == null ? null : Number(r.system_size_kwp),
    system_type: r.system_type,
    contracted_value: String(r.contracted_value ?? '0'),
    total_invoiced: String(r.total_invoiced ?? '0'),
    total_received: String(r.total_received ?? '0'),
    net_cash_position: String(r.net_cash_position ?? '0'),
    actual_start_date: r.actual_start_date,
    actual_end_date: r.actual_end_date,
  }));
}

export async function searchAllProjects(query: string): Promise<CandidateProject[]> {
  const op = '[searchAllProjects]';
  console.log(`${op} Starting`, { query });
  if (!query || query.length < 2) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('projects')
    .select('id, project_number, customer_name, status, system_size_kwp, system_type, contracted_value, actual_start_date, actual_end_date')
    .or(`customer_name.ilike.%${query}%,project_number.ilike.%${query}%`)
    .limit(50);
  if (error) {
    console.error(`${op} query failed`, { error });
    throw new Error(`Project search failed: ${error.message}`);
  }
  const ids = (data ?? []).map((p) => p.id);
  const cashByProj = new Map<string, { invoiced: number; received: number; net: number }>();
  if (ids.length > 0) {
    const { data: cash } = await supabase
      .from('project_cash_positions')
      .select('project_id, total_invoiced, total_received, net_cash_position')
      .in('project_id', ids);
    for (const c of cash ?? []) {
      cashByProj.set(c.project_id, {
        invoiced: Number(c.total_invoiced ?? 0),
        received: Number(c.total_received ?? 0),
        net: Number(c.net_cash_position ?? 0),
      });
    }
  }
  return (data ?? []).map((p) => {
    const c = cashByProj.get(p.id) ?? { invoiced: 0, received: 0, net: 0 };
    return {
      project_id: p.id,
      project_number: p.project_number,
      customer_name: p.customer_name,
      status: p.status,
      system_size_kwp: p.system_size_kwp == null ? null : Number(p.system_size_kwp),
      system_type: p.system_type,
      contracted_value: String(p.contracted_value ?? '0'),
      total_invoiced: String(c.invoiced),
      total_received: String(c.received),
      net_cash_position: String(c.net),
      actual_start_date: p.actual_start_date,
      actual_end_date: p.actual_end_date,
    };
  });
}

// ── Counts (for KPI strip and /cash banner) ──

export const getOrphanCounts = unstable_cache(
  async (): Promise<OrphanCounts> => {
    const op = '[getOrphanCounts]';
    console.log(`${op} Starting`);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('get_orphan_counts');
    if (error) {
      console.error(`${op} RPC failed`, { error });
      throw new Error(`Failed to load orphan counts: ${error.message}`);
    }
    const r = (data as any)?.[0] ?? {
      pending_invoice_count: 0,
      pending_invoice_total: 0,
      pending_payment_count: 0,
      pending_payment_total: 0,
      excluded_count: 0,
      excluded_total: 0,
      deferred_count: 0,
    };
    return {
      pendingInvoiceCount: Number(r.pending_invoice_count),
      pendingInvoiceTotal: String(r.pending_invoice_total ?? '0'),
      pendingPaymentCount: Number(r.pending_payment_count),
      pendingPaymentTotal: String(r.pending_payment_total ?? '0'),
      excludedCount: Number(r.excluded_count),
      excludedTotal: String(r.excluded_total ?? '0'),
      deferredCount: Number(r.deferred_count),
    };
  },
  ['orphan-counts'],
  { revalidate: 60, tags: ['orphan-counts'] },
);

// ── Audit log ──

export async function getAttributionAudit(opts?: {
  decision?: string;
  madeBy?: string;
  page?: number;
}): Promise<{ rows: any[]; total: number }> {
  const op = '[getAttributionAudit]';
  console.log(`${op} Starting`, opts);
  const supabase = await createClient();
  const page = opts?.page ?? 1;
  const perPage = 50;
  let q = supabase
    .from('zoho_attribution_audit')
    .select(
      'id, entity_type, entity_id, from_project_id, to_project_id, decision, made_by, made_at, notes, employees!made_by(full_name)',
      { count: 'estimated' },
    )
    .order('made_at', { ascending: false })
    .range((page - 1) * perPage, page * perPage - 1);
  if (opts?.decision) q = q.eq('decision', opts.decision);
  if (opts?.madeBy) q = q.eq('made_by', opts.madeBy);
  const { data, count, error } = await q;
  if (error) {
    console.error(`${op} query failed`, { error });
    throw new Error(`Audit query failed: ${error.message}`);
  }
  return { rows: data ?? [], total: count ?? 0 };
}

// ── Deferred / excluded tabs ──

export async function getOrphansByStatus(status: 'deferred' | 'excluded') {
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
