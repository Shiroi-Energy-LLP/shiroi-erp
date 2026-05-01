/**
 * Inspect what's actually in the 303 unmatched Zoho invoices.
 * Output: customer name + total invoiced amount, sorted desc.
 */
import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { Database } from '@repo/types/database';

dotenv.config({ path: '.env.local' });
const ZOHO_DIR = path.resolve(__dirname, '../docs/Zoho data');

const admin = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

interface ZohoInvoiceXlsRow {
  'Invoice ID': string | null;
  'Invoice Number': string | null;
  'Customer Name': string | null;
  'Total': string | number | null;
}

function loadSheet<T extends Record<string, unknown>>(file: string): T[] {
  const wb = XLSX.readFile(path.join(ZOHO_DIR, file), { cellDates: true });
  return XLSX.utils.sheet_to_json<T>(wb.Sheets[wb.SheetNames[0]], { defval: null });
}

async function run() {
  const invoiceRows = loadSheet<ZohoInvoiceXlsRow>('Invoice.xls');
  const custByZohoId = new Map<string, string>();
  for (const r of invoiceRows) {
    const id = r['Invoice ID'] ? String(r['Invoice ID']) : null;
    const c = r['Customer Name'] ? String(r['Customer Name']) : null;
    if (id && c && !custByZohoId.has(id)) custByZohoId.set(id, c);
  }

  const { data: erpProjects } = await admin.from('projects').select('customer_name');
  const erpCustomers = new Set(
    (erpProjects ?? []).map(p => p.customer_name?.toLowerCase().trim() ?? '').filter(Boolean),
  );

  const { data: unattribInvoices } = await admin
    .from('invoices')
    .select('zoho_invoice_id, total_amount')
    .eq('source', 'zoho_import')
    .is('project_id', null);

  // Group by customer name
  const byCustomer = new Map<string, { count: number; total: number; matchesErp: boolean }>();
  for (const inv of unattribInvoices ?? []) {
    const cust = inv.zoho_invoice_id ? custByZohoId.get(inv.zoho_invoice_id) : undefined;
    if (!cust) continue;
    const key = cust;
    if (!byCustomer.has(key)) {
      byCustomer.set(key, { count: 0, total: 0, matchesErp: erpCustomers.has(cust.toLowerCase().trim()) });
    }
    const entry = byCustomer.get(key)!;
    entry.count++;
    entry.total += Number(inv.total_amount ?? 0);
  }

  const sorted = Array.from(byCustomer.entries())
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.total - a.total);

  console.log('Top 40 unattributed Zoho customer names by total invoice value:');
  console.log('─'.repeat(100));
  for (const row of sorted.slice(0, 40)) {
    const marker = row.matchesErp ? '✓ in ERP' : '  not in ERP';
    console.log(`  ${(row.total/1e7).toFixed(2).padStart(8)} Cr · ${String(row.count).padStart(3)} inv · ${marker} · ${row.name.slice(0, 60)}`);
  }
  console.log('─'.repeat(100));
  const erpCount = sorted.filter(r => r.matchesErp).length;
  const nonErpCount = sorted.length - erpCount;
  const erpAmt = sorted.filter(r => r.matchesErp).reduce((s,r)=>s+r.total,0);
  const nonErpAmt = sorted.filter(r => !r.matchesErp).reduce((s,r)=>s+r.total,0);
  console.log(`Total: ${sorted.length} customers, ₹${(sorted.reduce((s,r)=>s+r.total,0)/1e7).toFixed(2)} Cr`);
  console.log(`  Customer is in ERP projects: ${erpCount} (₹${(erpAmt/1e7).toFixed(2)} Cr)`);
  console.log(`  Customer NOT in ERP projects: ${nonErpCount} (₹${(nonErpAmt/1e7).toFixed(2)} Cr)`);
}

run().catch(e => { console.error(e); process.exit(1); });
