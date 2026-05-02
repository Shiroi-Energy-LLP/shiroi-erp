// scripts/backfill-zoho-invoice-line-items.ts
/**
 * Reads docs/Zoho data/Invoice.xls, extracts line items, and inserts them into
 * zoho_invoice_line_items keyed by invoice.zoho_invoice_id.
 *
 * Mismatch handling: for each Zoho invoice, sum line-item amounts and compare
 * to invoices.total_amount. If absolute deviation > 5% AND > ₹10,000, skip
 * that invoice's line items entirely and log a warning. Smaller deviations
 * (rounding) are accepted.
 *
 * Usage:
 *   pnpm tsx scripts/backfill-zoho-invoice-line-items.ts --dry-run
 *   pnpm tsx scripts/backfill-zoho-invoice-line-items.ts --apply
 */
import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { Database } from '@repo/types/database';

dotenv.config({ path: '.env.local' });

const ZOHO_DIR = path.resolve(__dirname, '../docs/Zoho data');
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SECRET_KEY!;
const admin = createClient<Database>(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

interface XlsLineRow {
  'Invoice ID': string | null;
  'Item Name': string | null;
  'Item Desc': string | null;
  'Quantity': string | number | null;
  'Item Price': string | number | null;
  'Item Total': string | number | null;
}

function toNumber(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

function toStr(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

async function run() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const dryRun = !apply;
  console.log(`Mode: ${apply ? 'APPLY' : 'DRY RUN'}`);

  // Load the XLS — same file Phase 08 used.
  const wb = XLSX.readFile(path.join(ZOHO_DIR, 'Invoice.xls'), { cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<XlsLineRow>(sheet, { defval: null });
  console.log(`  ${rows.length} XLS rows`);

  // Group by Zoho invoice id.
  const grouped = new Map<string, XlsLineRow[]>();
  for (const r of rows) {
    const id = toStr(r['Invoice ID']);
    if (!id) continue;
    if (!grouped.has(id)) grouped.set(id, []);
    grouped.get(id)!.push(r);
  }
  console.log(`  ${grouped.size} unique invoices in XLS`);

  // Lookup ERP invoices by zoho_invoice_id.
  // Compare line-item sums to subtotal_supply (pre-GST), not total_amount —
  // XLS Item Total is pre-GST, ERP total_amount is GST-inclusive, so a direct
  // total comparison falsely flags every GST-bearing invoice as a mismatch.
  const { data: invoices, error: invErr } = await admin
    .from('invoices')
    .select('id, zoho_invoice_id, subtotal_supply, subtotal_works')
    .eq('source', 'zoho_import');
  if (invErr) throw invErr;

  const invoiceByZohoId = new Map<string, { id: string; subtotal: number }>();
  for (const inv of invoices ?? []) {
    if (inv.zoho_invoice_id) {
      invoiceByZohoId.set(inv.zoho_invoice_id, {
        id: inv.id,
        subtotal: Number(inv.subtotal_supply ?? 0) + Number(inv.subtotal_works ?? 0),
      });
    }
  }
  console.log(`  ${invoiceByZohoId.size} ERP invoices with zoho_invoice_id`);

  // Build insert rows with mismatch check.
  const inserts: Array<{
    invoice_id: string;
    zoho_invoice_id: string;
    line_number: number;
    item_name: string | null;
    item_description: string | null;
    quantity: number;
    rate: number;
    amount: number;
  }> = [];
  let mismatchSkipped = 0;
  let invoicesProcessed = 0;
  let invoicesNoErpMatch = 0;

  for (const [zohoId, lines] of grouped) {
    const erp = invoiceByZohoId.get(zohoId);
    if (!erp) {
      invoicesNoErpMatch++;
      continue;
    }
    const sumLines = lines.reduce((s, r) => s + toNumber(r['Item Total']), 0);
    const erpSubtotal = erp.subtotal;
    const absDev = Math.abs(sumLines - erpSubtotal);
    const pctDev = erpSubtotal === 0 ? 0 : absDev / erpSubtotal;
    if (absDev > 10000 && pctDev > 0.05) {
      console.warn(
        `  SKIP mismatch: ${zohoId} — XLS lines sum ₹${sumLines.toFixed(2)} ` +
        `vs ERP subtotal ₹${erpSubtotal.toFixed(2)} (Δ ₹${absDev.toFixed(2)}, ${(pctDev * 100).toFixed(1)}%)`,
      );
      mismatchSkipped++;
      continue;
    }
    invoicesProcessed++;
    lines.forEach((r, idx) => {
      inserts.push({
        invoice_id: erp.id,
        zoho_invoice_id: zohoId,
        line_number: idx + 1,
        item_name: toStr(r['Item Name']),
        item_description: toStr(r['Item Desc']),
        quantity: toNumber(r['Quantity']),
        rate: toNumber(r['Item Price']),
        amount: toNumber(r['Item Total']),
      });
    });
  }

  console.log('');
  console.log(`Invoices to backfill: ${invoicesProcessed}`);
  console.log(`Invoices skipped (mismatch >5% AND >₹10K): ${mismatchSkipped}`);
  console.log(`Invoices no ERP match: ${invoicesNoErpMatch}`);
  console.log(`Total line item rows: ${inserts.length}`);

  if (dryRun) {
    console.log('[DRY RUN] No writes.');
    return;
  }

  console.log('Inserting...');
  const CHUNK = 200;
  for (let i = 0; i < inserts.length; i += CHUNK) {
    const chunk = inserts.slice(i, i + CHUNK);
    const { error } = await admin.from('zoho_invoice_line_items').insert(chunk);
    if (error) throw error;
    process.stdout.write(`  ${Math.min(i + CHUNK, inserts.length)}/${inserts.length}\r`);
  }
  console.log('\nDone.');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
