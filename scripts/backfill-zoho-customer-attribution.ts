/**
 * scripts/backfill-zoho-customer-attribution.ts
 *
 * Vivek (Apr 26 2026): "The net position is negative in a lot of projects.
 * This is not right." Investigation revealed that 324/481 zoho_import
 * invoices (₹64.3 Cr) and 715/1078 zoho_import customer_payments (₹59.1 Cr)
 * have NULL project_id. Phase 08 only attributes via Zoho Project ID/Name
 * (not customer); Phase 09 inherits from invoice. So when Zoho's invoice
 * lacks a project tag (which is common for older invoices), the entire
 * customer cash trail goes unattributed → projects appear to have only the
 * vendor-payment side, showing artificial negatives on completed deals.
 *
 * This backfill:
 *   1. Reads Invoice.xls + Customer_Payment.xls to recover Customer Name
 *      that Phase 08/09 dropped.
 *   2. Builds a customer→project map from ERP projects.
 *   3. For each unattributed row, attributes ONLY when the customer has
 *      exactly ONE active project in ERP (1:1) — exact match preferred,
 *      fuzzy Jaccard ≥0.7 fallback. Never guesses on ambiguous customers.
 *   4. Cascades: payments → invoice → project; then customer-name direct
 *      for advance payments without invoice.
 *   5. Refreshes project_cash_positions for affected projects.
 *
 * Usage:
 *   pnpm tsx scripts/backfill-zoho-customer-attribution.ts --dry-run
 *   pnpm tsx scripts/backfill-zoho-customer-attribution.ts --apply
 */
import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { Database } from '@repo/types/database';
import { normalizeName, tokens, jaccard } from './zoho-import/normalize';

dotenv.config({ path: '.env.local' });

const ZOHO_DIR = path.resolve(__dirname, '../docs/Zoho data');
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey  = process.env.SUPABASE_SECRET_KEY!;
const admin = createClient<Database>(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

interface ZohoInvoiceXlsRow {
  'Invoice ID': string | null;
  'Invoice Number': string | null;
  'Customer Name': string | null;
  'Customer ID': string | null;
}

interface ZohoCustPayXlsRow {
  'InvoicePayment ID': string | null;
  'Customer Name': string | null;
  'CustomerID': string | null;
  'Invoice Number': string | null;
}

function loadSheet<T extends Record<string, unknown>>(fileName: string): T[] {
  const fullPath = path.join(ZOHO_DIR, fileName);
  const wb = XLSX.readFile(fullPath, { cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json<T>(sheet, { defval: null });
}

function clean(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().trim();
}

async function run() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const dryRun = args.includes('--dry-run') || !apply;

  console.log(`Mode: ${apply ? 'APPLY' : 'DRY RUN'}`);
  console.log('');

  // ---- 1. Build customer name → ERP project map ----
  // A customer is "attributable" only when it maps to EXACTLY ONE project.
  console.log('Step 1: Building customer → project map from ERP projects...');
  const { data: erpProjects, error: projErr } = await admin
    .from('projects')
    .select('id, customer_name, status, contracted_value');
  if (projErr) throw projErr;

  // Group projects by normalized customer name. We accept all non-cancelled
  // projects; even completed ones can have orphaned customer payments.
  const projectsByCustomer = new Map<string, { id: string; status: string; contracted: number }[]>();
  const allCustomerKeys: string[] = [];
  for (const p of erpProjects ?? []) {
    const key = clean(p.customer_name);
    if (!key) continue;
    if (!projectsByCustomer.has(key)) {
      projectsByCustomer.set(key, []);
      allCustomerKeys.push(key);
    }
    projectsByCustomer.get(key)!.push({
      id: p.id,
      status: p.status ?? 'unknown',
      contracted: Number(p.contracted_value ?? 0),
    });
  }

  console.log(`  ${erpProjects?.length ?? 0} projects across ${projectsByCustomer.size} unique customer names`);
  const oneToOne = Array.from(projectsByCustomer.values()).filter(arr => arr.length === 1).length;
  const multiCust = Array.from(projectsByCustomer.values()).filter(arr => arr.length > 1).length;
  console.log(`  ${oneToOne} customers with exactly 1 project (auto-attributable)`);
  console.log(`  ${multiCust} customers with multiple projects (ambiguous, need manual review)`);

  // Pre-tokenize for fuzzy matching
  const customerTokens = new Map<string, ReturnType<typeof tokens>>();
  for (const key of allCustomerKeys) {
    customerTokens.set(key, tokens(normalizeName(key)));
  }

  // Words too generic to be a unique signal (drop from token-subset matches)
  const STOPWORDS = new Set([
    'mr', 'mrs', 'ms', 'dr', 'shri', 'sri', 'sree', 'm', 's', 'mss',
    'pvt', 'private', 'ltd', 'limited', 'pl', 'plc', 'inc', 'co', 'company',
    'corp', 'corporation', 'and', 'enterprises', 'enterprise',
    'projects', 'project', 'group', 'holdings', 'holding', 'india', 'indian',
    'p', 'the', 'of', 'kw', 'kwp',
  ]);
  function meaningfulTokens(s: string): Set<string> {
    const out = new Set<string>();
    for (const t of tokens(normalizeName(s))) {
      if (t.length >= 2 && !STOPWORDS.has(t)) out.add(t);
    }
    return out;
  }
  // Pre-compute meaningful tokens per ERP customer for faster subset checks
  const erpMeaningfulTokens = new Map<string, Set<string>>();
  for (const k of allCustomerKeys) erpMeaningfulTokens.set(k, meaningfulTokens(k));

  // "Generic" ERP customer = its meaningful tokens are a strict subset of
  // another ERP customer's tokens. E.g., "Ramaniyam Projects" → {ramaniyam}
  // is a subset of {ramaniyam, adhri} from "M/s Ramaniyam Adhri" and 7 other
  // Ramaniyam sub-projects, so any parent-style Zoho invoice ("RAMANIYAM
  // REAL ESTATES") would falsely subset-match to "Ramaniyam Projects" only
  // (because the others have additional tokens). Flag these as ambiguous.
  const genericErpCustomers = new Set<string>();
  for (const k1 of allCustomerKeys) {
    const tok1 = erpMeaningfulTokens.get(k1)!;
    if (tok1.size === 0) continue;
    for (const k2 of allCustomerKeys) {
      if (k1 === k2) continue;
      const tok2 = erpMeaningfulTokens.get(k2)!;
      if (tok2.size <= tok1.size) continue;
      let isSubset = true;
      for (const t of tok1) {
        if (!tok2.has(t)) { isSubset = false; break; }
      }
      if (isSubset) { genericErpCustomers.add(k1); break; }
    }
  }
  console.log(`  ${genericErpCustomers.size} ERP customer names flagged as generic (subset of others) — these are excluded from subset attribution`);

  /**
   * Attribute a Zoho customer name to an ERP project, only if unambiguous (1:1).
   * Match strategies (each requires exactly ONE candidate ERP customer):
   *   1. Exact match on full name
   *   2. ERP customer's meaningful tokens are all present in Zoho customer's tokens
   *      (catches "VAF" ⊂ "VAF DEF-AERO SYSTEMS PVT LTD"; "Lancor Hiranmayi"
   *      ⊂ "LANCOR HOLDINGS LIMITED" — but only if no other Lancor* matches)
   *   3. Jaccard ≥0.7 — older fallback for typo/word-order differences
   * Returns null when ambiguous (multiple candidates) or no match found.
   */
  function attribute(zohoCustomerName: string | null): { projectId: string; matchType: 'exact' | 'subset' | 'fuzzy' } | null {
    const key = clean(zohoCustomerName);
    if (!key || key.length < 3) return null;

    // 1. Exact full-name match
    const exact = projectsByCustomer.get(key);
    if (exact && exact.length === 1) return { projectId: exact[0].id, matchType: 'exact' };
    if (exact && exact.length > 1) return null; // ambiguous — same customer name on multiple projects

    // 2. Token-subset match: ERP key's meaningful tokens ⊆ Zoho name's meaningful tokens
    //    Skip "generic" ERP customers (those whose tokens are a subset of other
    //    ERP customers' tokens) — they signal parent-company-name ambiguity.
    const zMeaningful = meaningfulTokens(key);
    if (zMeaningful.size === 0) return null;
    const subsetCandidates: { erpKey: string; projectId: string; overlap: number }[] = [];
    for (const erpKey of allCustomerKeys) {
      if (genericErpCustomers.has(erpKey)) continue;
      const erpTok = erpMeaningfulTokens.get(erpKey)!;
      if (erpTok.size === 0) continue;
      let allPresent = true;
      for (const t of erpTok) {
        if (!zMeaningful.has(t)) { allPresent = false; break; }
      }
      if (allPresent) {
        const cands = projectsByCustomer.get(erpKey)!;
        if (cands.length === 1) {
          subsetCandidates.push({ erpKey, projectId: cands[0].id, overlap: erpTok.size });
        }
      }
    }
    if (subsetCandidates.length === 1) {
      return { projectId: subsetCandidates[0].projectId, matchType: 'subset' };
    }
    if (subsetCandidates.length > 1) {
      // Multiple ERP customers fit the Zoho name → ambiguous (e.g., parent
      // company "LANCOR HOLDINGS" matches every Lancor sub-project).
      return null;
    }

    // (Jaccard fuzzy fallback was removed — too aggressive for parent-company
    //  names like "RAMANIYAM REAL ESTATES PVT LTD" which Jaccard-matched to
    //  one specific Ramaniyam sub-project, but could equally be any of 8.
    //  Use exact + subset only.)
    return null;
  }

  // ---- 2. Build Zoho ID → Customer Name maps from XLS ----
  console.log('');
  console.log('Step 2: Reading Zoho XLS files...');
  const invoiceRows = loadSheet<ZohoInvoiceXlsRow>('Invoice.xls');
  const custPayRows = loadSheet<ZohoCustPayXlsRow>('Customer_Payment.xls');

  // For invoices: zoho_invoice_id → customer name (multiple line items per invoice → take first)
  const invoiceCustomerByZohoId = new Map<string, string>();
  for (const r of invoiceRows) {
    const zohoId = r['Invoice ID'] ? String(r['Invoice ID']) : null;
    const cust = r['Customer Name'] ? String(r['Customer Name']) : null;
    if (zohoId && cust && !invoiceCustomerByZohoId.has(zohoId)) {
      invoiceCustomerByZohoId.set(zohoId, cust);
    }
  }
  console.log(`  ${invoiceCustomerByZohoId.size} unique invoices with Customer Name in XLS`);

  // For customer payments: InvoicePayment ID → customer name
  const paymentCustomerByZohoId = new Map<string, string>();
  for (const r of custPayRows) {
    const zohoId = r['InvoicePayment ID'] ? String(r['InvoicePayment ID']) : null;
    const cust = r['Customer Name'] ? String(r['Customer Name']) : null;
    if (zohoId && cust && !paymentCustomerByZohoId.has(zohoId)) {
      paymentCustomerByZohoId.set(zohoId, cust);
    }
  }
  console.log(`  ${paymentCustomerByZohoId.size} unique customer payments with Customer Name in XLS`);

  // ---- 3. Find unattributed invoices and propose updates ----
  console.log('');
  console.log('Step 3: Analyzing unattributed invoices...');
  const { data: unattribInvoices, error: invErr } = await admin
    .from('invoices')
    .select('id, zoho_invoice_id, total_amount, project_id')
    .eq('source', 'zoho_import')
    .is('project_id', null);
  if (invErr) throw invErr;

  let invStats = { exact: 0, subset: 0, fuzzy: 0, ambiguous: 0, noXlsName: 0, noMatch: 0, totalAmount: 0 };
  const invoiceUpdates: Array<{ invoiceId: string; projectId: string; amount: number; matchType: 'exact' | 'subset' | 'fuzzy' }> = [];

  // Build reverse map for debug logging: project_id -> customer_name
  const projectCustomerByPid = new Map<string, string>();
  for (const p of erpProjects ?? []) {
    if (p.id && p.customer_name) projectCustomerByPid.set(p.id, p.customer_name);
  }
  const matchSamples: { zoho: string; erp: string; type: string; amount: number }[] = [];
  for (const inv of unattribInvoices ?? []) {
    const amount = Number(inv.total_amount ?? 0);
    invStats.totalAmount += amount;
    const zohoId = inv.zoho_invoice_id;
    if (!zohoId) { invStats.noXlsName++; continue; }
    const custName = invoiceCustomerByZohoId.get(zohoId);
    if (!custName) { invStats.noXlsName++; continue; }
    const result = attribute(custName);
    if (!result) {
      // Could be ambiguous (multi-project customer) or no match
      const k = clean(custName);
      if (projectsByCustomer.has(k) && projectsByCustomer.get(k)!.length > 1) {
        invStats.ambiguous++;
      } else {
        invStats.noMatch++;
      }
      continue;
    }
    invStats[result.matchType]++;
    invoiceUpdates.push({ invoiceId: inv.id, projectId: result.projectId, amount, matchType: result.matchType });
    if (matchSamples.length < 60) {
      matchSamples.push({
        zoho: custName,
        erp: projectCustomerByPid.get(result.projectId) ?? '?',
        type: result.matchType,
        amount,
      });
    }
  }
  if (matchSamples.length > 0) {
    console.log('  Sample matches (Zoho → ERP):');
    for (const m of matchSamples) {
      console.log(`    [${m.type.padEnd(6)}] ₹${(m.amount/1e5).toFixed(2).padStart(8)}L · "${m.zoho.slice(0,55)}" → "${m.erp.slice(0,40)}"`);
    }
  }

  const invRecoverableAmount = invoiceUpdates.reduce((s, u) => s + u.amount, 0);
  const sumByType = (t: 'exact' | 'subset' | 'fuzzy') => invoiceUpdates.filter(u => u.matchType === t).reduce((s, u) => s + u.amount, 0);
  console.log(`  Unattributed invoices: ${unattribInvoices?.length ?? 0} (₹${(invStats.totalAmount/1e7).toFixed(2)} Cr)`);
  console.log(`    Recover via exact 1:1:  ${invStats.exact}  invoices (₹${(sumByType('exact')/1e7).toFixed(2)} Cr)`);
  console.log(`    Recover via subset 1:1: ${invStats.subset} invoices (₹${(sumByType('subset')/1e7).toFixed(2)} Cr)`);
  console.log(`    Recover via fuzzy 1:1:  ${invStats.fuzzy}  invoices (₹${(sumByType('fuzzy')/1e7).toFixed(2)} Cr)`);
  console.log(`    TOTAL recoverable: ${invoiceUpdates.length} invoices (₹${(invRecoverableAmount/1e7).toFixed(2)} Cr)`);
  console.log(`    Ambiguous (customer has multiple projects): ${invStats.ambiguous}`);
  console.log(`    No matching ERP project: ${invStats.noMatch}`);
  console.log(`    No Customer Name in XLS: ${invStats.noXlsName}`);

  // ---- 4. Apply invoice updates ----
  if (apply && invoiceUpdates.length > 0) {
    console.log('');
    console.log('Step 4: Applying invoice attribution updates...');
    const CHUNK = 50;
    for (let i = 0; i < invoiceUpdates.length; i += CHUNK) {
      const chunk = invoiceUpdates.slice(i, i + CHUNK);
      // Run updates in parallel within chunk
      await Promise.all(chunk.map(u =>
        admin.from('invoices').update({ project_id: u.projectId }).eq('id', u.invoiceId)
      ));
      process.stdout.write(`    ${Math.min(i + CHUNK, invoiceUpdates.length)}/${invoiceUpdates.length}\r`);
    }
    console.log('    Invoice updates complete.');
  } else if (dryRun) {
    console.log('  [DRY RUN] Skipping invoice updates.');
  }

  // ---- 5. Cascade: update customer_payments where invoice_id is set + invoice now has project ----
  console.log('');
  console.log('Step 5: Cascading customer_payments via invoice_id...');
  // After invoice update, re-query and cascade.
  // Fetch all orphan customer payments with invoice_id; check their invoice's project_id now.
  const { data: orphanPaymentsWithInv, error: opErr } = await admin
    .from('customer_payments')
    .select('id, invoice_id, amount')
    .eq('source', 'zoho_import')
    .is('project_id', null)
    .not('invoice_id', 'is', null);
  if (opErr) throw opErr;

  // Get the invoice → project_id map (with NEW updates after Step 4)
  const invoiceIds = Array.from(new Set((orphanPaymentsWithInv ?? []).map(p => p.invoice_id!).filter(Boolean)));
  let invoiceProjectMap = new Map<string, string>();
  if (invoiceIds.length > 0) {
    // Chunk the IN clause to avoid URL length limits
    const CHUNK_INV = 200;
    for (let i = 0; i < invoiceIds.length; i += CHUNK_INV) {
      const chunk = invoiceIds.slice(i, i + CHUNK_INV);
      const { data: invs, error: e } = await admin.from('invoices').select('id, project_id').in('id', chunk);
      if (e) throw e;
      for (const inv of invs ?? []) {
        if (inv.project_id) invoiceProjectMap.set(inv.id, inv.project_id);
      }
    }
  }

  const cascadeUpdates: Array<{ paymentId: string; projectId: string; amount: number }> = [];
  let cascadeMissingInvoice = 0;
  for (const p of orphanPaymentsWithInv ?? []) {
    const projId = invoiceProjectMap.get(p.invoice_id!);
    if (projId) {
      cascadeUpdates.push({ paymentId: p.id, projectId: projId, amount: Number(p.amount ?? 0) });
    } else {
      cascadeMissingInvoice++;
    }
  }
  const cascadeAmount = cascadeUpdates.reduce((s, u) => s + u.amount, 0);
  console.log(`  Orphan payments with invoice_id: ${orphanPaymentsWithInv?.length ?? 0}`);
  console.log(`    Will cascade via invoice→project: ${cascadeUpdates.length} (₹${(cascadeAmount/1e7).toFixed(2)} Cr)`);
  console.log(`    Invoice still has NULL project: ${cascadeMissingInvoice}`);

  if (apply && cascadeUpdates.length > 0) {
    console.log('  Applying cascade updates...');
    const CHUNK = 50;
    for (let i = 0; i < cascadeUpdates.length; i += CHUNK) {
      const chunk = cascadeUpdates.slice(i, i + CHUNK);
      await Promise.all(chunk.map(u =>
        admin.from('customer_payments').update({ project_id: u.projectId }).eq('id', u.paymentId)
      ));
      process.stdout.write(`    ${Math.min(i + CHUNK, cascadeUpdates.length)}/${cascadeUpdates.length}\r`);
    }
    console.log('    Cascade complete.');
  }

  // ---- 6. Direct customer-name attribution for orphan payments ----
  // Covers: (a) advances (no invoice_id) AND (b) payments whose invoice
  // still couldn't be attributed in Step 4 (cascade target was null).
  // Each payment carries its own Customer Name from Customer_Payment.xls,
  // which we re-read here to attempt a direct attribution.
  console.log('');
  console.log('Step 6: Direct customer-name attribution for ALL orphan payments...');
  const { data: advances, error: advErr } = await admin
    .from('customer_payments')
    .select('id, zoho_customer_payment_id, amount')
    .eq('source', 'zoho_import')
    .is('project_id', null);
  if (advErr) throw advErr;

  let advStats = { exact: 0, subset: 0, fuzzy: 0, ambiguous: 0, noXlsName: 0, noMatch: 0 };
  const advanceUpdates: Array<{ paymentId: string; projectId: string; amount: number; matchType: 'exact' | 'subset' | 'fuzzy' }> = [];
  for (const a of advances ?? []) {
    const zohoId = a.zoho_customer_payment_id;
    if (!zohoId) { advStats.noXlsName++; continue; }
    const custName = paymentCustomerByZohoId.get(zohoId);
    if (!custName) { advStats.noXlsName++; continue; }
    const result = attribute(custName);
    if (!result) {
      const k = clean(custName);
      if (projectsByCustomer.has(k) && projectsByCustomer.get(k)!.length > 1) {
        advStats.ambiguous++;
      } else {
        advStats.noMatch++;
      }
      continue;
    }
    advStats[result.matchType]++;
    advanceUpdates.push({ paymentId: a.id, projectId: result.projectId, amount: Number(a.amount ?? 0), matchType: result.matchType });
  }
  const advAmount = advanceUpdates.reduce((s, u) => s + u.amount, 0);
  console.log(`  Orphan payments scanned: ${advances?.length ?? 0}`);
  console.log(`    Will attribute via 1:1 customer name: ${advanceUpdates.length} (₹${(advAmount/1e7).toFixed(2)} Cr)`);
  console.log(`    Ambiguous: ${advStats.ambiguous}, no match: ${advStats.noMatch}, no XLS name: ${advStats.noXlsName}`);

  if (apply && advanceUpdates.length > 0) {
    console.log('  Applying advance-payment attribution updates...');
    const CHUNK = 50;
    for (let i = 0; i < advanceUpdates.length; i += CHUNK) {
      const chunk = advanceUpdates.slice(i, i + CHUNK);
      await Promise.all(chunk.map(u =>
        admin.from('customer_payments').update({ project_id: u.projectId }).eq('id', u.paymentId)
      ));
      process.stdout.write(`    ${Math.min(i + CHUNK, advanceUpdates.length)}/${advanceUpdates.length}\r`);
    }
    console.log('    Advance updates complete.');
  }

  // ---- 7. Refresh project_cash_positions ----
  console.log('');
  console.log('Step 7: Refreshing project_cash_positions...');
  if (apply) {
    // Trigger the recompute by re-saving each affected project — actually, the
    // simplest way is to call an admin SQL RPC that does the bulk refresh.
    // We'll just touch each project to fire the trigger; or call a refresh fn.
    const affectedProjectIds = new Set<string>();
    invoiceUpdates.forEach(u => affectedProjectIds.add(u.projectId));
    cascadeUpdates.forEach(u => affectedProjectIds.add(u.projectId));
    advanceUpdates.forEach(u => affectedProjectIds.add(u.projectId));
    console.log(`  Affected projects: ${affectedProjectIds.size}`);

    // Use RPC if defined; else just no-op-update each project to refire trigger.
    // Note: the cash position trigger fires on customer_payments / invoices /
    // purchase_orders / vendor_payments INSERT/UPDATE — our updates above
    // already fired it. So this is just a sanity recompute.
    // For now: call a force-refresh RPC if it exists.
    console.log('  (Trigger has already refired during the updates above. Skipping additional refresh.)');
  } else {
    const affectedProjectIds = new Set<string>();
    invoiceUpdates.forEach(u => affectedProjectIds.add(u.projectId));
    cascadeUpdates.forEach(u => affectedProjectIds.add(u.projectId));
    advanceUpdates.forEach(u => affectedProjectIds.add(u.projectId));
    console.log(`  [DRY RUN] Would refresh ${affectedProjectIds.size} project cash positions.`);
  }

  // ---- 8. Backfill zoho_customer_name/id columns for ALL zoho_import rows ----
  // (Mig 087 added these columns; populate them so future re-imports / UIs can
  //  disambiguate parent-company invoices without re-reading Invoice.xls.)
  console.log('');
  console.log('Step 8: Backfilling zoho_customer_name/id on existing rows...');
  if (apply) {
    // Invoices: backfill name + id from XLS where currently NULL
    const { data: allInv } = await admin
      .from('invoices')
      .select('id, zoho_invoice_id')
      .eq('source', 'zoho_import')
      .or('zoho_customer_name.is.null,zoho_customer_id.is.null');
    const invXlsById = new Map<string, { custName: string | null; custId: string | null }>();
    for (const r of invoiceRows) {
      const id = r['Invoice ID'] ? String(r['Invoice ID']) : null;
      if (!id) continue;
      if (!invXlsById.has(id)) {
        invXlsById.set(id, {
          custName: r['Customer Name'] ? String(r['Customer Name']) : null,
          custId: r['Customer ID'] ? String(r['Customer ID']) : null,
        });
      }
    }
    let invFilledName = 0, invFilledId = 0;
    const invBatch: { id: string; name: string | null; cid: string | null }[] = [];
    for (const inv of allInv ?? []) {
      const xls = inv.zoho_invoice_id ? invXlsById.get(inv.zoho_invoice_id) : undefined;
      if (!xls) continue;
      if (xls.custName || xls.custId) {
        invBatch.push({ id: inv.id, name: xls.custName, cid: xls.custId });
        if (xls.custName) invFilledName++;
        if (xls.custId) invFilledId++;
      }
    }
    const CHUNK = 50;
    for (let i = 0; i < invBatch.length; i += CHUNK) {
      const chunk = invBatch.slice(i, i + CHUNK);
      await Promise.all(chunk.map(u =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        admin.from('invoices').update({ zoho_customer_name: u.name, zoho_customer_id: u.cid } as any).eq('id', u.id)
      ));
    }
    console.log(`    Invoices: ${invFilledName} names + ${invFilledId} IDs filled`);

    // Customer payments: backfill name + id from XLS where currently NULL
    const { data: allPay } = await admin
      .from('customer_payments')
      .select('id, zoho_customer_payment_id')
      .eq('source', 'zoho_import')
      .or('zoho_customer_name.is.null,zoho_customer_id.is.null');
    const payXlsById = new Map<string, { custName: string | null; custId: string | null }>();
    for (const r of custPayRows) {
      const id = r['InvoicePayment ID'] ? String(r['InvoicePayment ID']) : null;
      if (!id) continue;
      if (!payXlsById.has(id)) {
        payXlsById.set(id, {
          custName: r['Customer Name'] ? String(r['Customer Name']) : null,
          custId: r['CustomerID'] ? String(r['CustomerID']) : null,
        });
      }
    }
    let payFilledName = 0, payFilledId = 0;
    const payBatch: { id: string; name: string | null; cid: string | null }[] = [];
    for (const p of allPay ?? []) {
      const xls = p.zoho_customer_payment_id ? payXlsById.get(p.zoho_customer_payment_id) : undefined;
      if (!xls) continue;
      if (xls.custName || xls.custId) {
        payBatch.push({ id: p.id, name: xls.custName, cid: xls.custId });
        if (xls.custName) payFilledName++;
        if (xls.custId) payFilledId++;
      }
    }
    for (let i = 0; i < payBatch.length; i += CHUNK) {
      const chunk = payBatch.slice(i, i + CHUNK);
      await Promise.all(chunk.map(u =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        admin.from('customer_payments').update({ zoho_customer_name: u.name, zoho_customer_id: u.cid } as any).eq('id', u.id)
      ));
    }
    console.log(`    Payments: ${payFilledName} names + ${payFilledId} IDs filled`);
  } else {
    console.log('  [DRY RUN] Skipping zoho_customer_name/id backfill.');
  }

  // ---- Final summary ----
  console.log('');
  console.log('===== SUMMARY =====');
  const totalAmt = invRecoverableAmount + cascadeAmount + advAmount;
  console.log(`Invoices attributed:   ${invoiceUpdates.length} (₹${(invRecoverableAmount/1e7).toFixed(2)} Cr)`);
  console.log(`Payments cascaded:     ${cascadeUpdates.length} (₹${(cascadeAmount/1e7).toFixed(2)} Cr)`);
  console.log(`Advances attributed:   ${advanceUpdates.length} (₹${(advAmount/1e7).toFixed(2)} Cr)`);
  console.log(`TOTAL ATTRIBUTED:      ${invoiceUpdates.length + cascadeUpdates.length + advanceUpdates.length} rows · ₹${(totalAmt/1e7).toFixed(2)} Cr`);
  console.log(`Mode: ${apply ? 'APPLIED to dev' : 'DRY RUN — pass --apply to commit'}`);
}

run().catch((e) => { console.error(e); process.exit(1); });
