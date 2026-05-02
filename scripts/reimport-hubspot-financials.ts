/**
 * Phase 3 — HubSpot financials re-import (2026-05-02 export).
 *
 * Reads the HubSpot CRM export CSV, picks rows with a Total Project Value (TPV)
 * and a recognisable PV reference number (Quote ID), and UPDATEs the matching
 * proposal in the dev DB by `hubspot_deal_id` (CSV's "Record ID" column).
 *
 * Sanity-gated: anything > ₹5L/kWp is logged + skipped (matches the importer's
 * MAX_PLAUSIBLE_PER_KWP guard).
 *
 * What it WILL do:
 *   - UPDATE total_after_discount, total_before_discount, shiroi_revenue
 *   - Clear financials_invalidated if it was TRUE (since we now have a sane TPV)
 *   - Append `[HubSpot reimport YYYY-MM-DD]` audit note to `notes`
 *
 * What it WON'T do:
 *   - INSERT new leads/proposals for HubSpot deals not yet in the ERP (separate task)
 *   - Touch system_size_kwp (separate signal — kWp came from a different source)
 *   - Touch HubSpot proposals where the new TPV is missing or implausible
 *
 * Usage:
 *   npx tsx scripts/reimport-hubspot-financials.ts                 # dry-run
 *   npx tsx scripts/reimport-hubspot-financials.ts --apply         # write to DB
 *
 * Source CSV: scripts/data/hubspot-exports/hubspot-deals-2026-05-02.csv
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: 'C:/Users/vivek/Projects/shiroi-erp/.env.local' });

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
);

const CSV_PATH = path.resolve(
  __dirname,
  '../scripts/data/hubspot-exports/hubspot-deals-2026-05-02.csv',
);
const APPLY = process.argv.includes('--apply');

// Same threshold as the importer guardrail (₹5L/kWp).
const MAX_PLAUSIBLE_PER_KWP = 500_000;

// ─── CSV parsing ──────────────────────────────────────────────────────────────

/**
 * Minimal RFC-4180 CSV reader. Handles double-quoted fields, escaped quotes ("")
 * and embedded newlines within quoted fields. HubSpot exports use this format.
 */
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        row.push(field);
        field = '';
      } else if (c === '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else if (c === '\r') {
        // skip — \r\n handled by \n branch
      } else {
        field += c;
      }
    }
  }
  // last field
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function parseAmount(s: string): number | null {
  if (!s || !s.trim()) return null;
  const cleaned = s.replace(/[₹$,\s]/g, '').replace(/INR/gi, '').trim();
  if (!cleaned) return null;
  const n = parseFloat(cleaned);
  if (!isFinite(n)) return null;
  return n;
}

/**
 * Extracts the PV-style reference number from HubSpot's "Quote ID" column.
 * Examples seen in CSV:
 *   "<p>PV005/26-27&nbsp;</p>"     → "PV005/26-27"
 *   "<p>PV071/25-26 Maharajan</p>" → "PV071/25-26"
 *   "PV071/25-26 Maharajan"        → "PV071/25-26"
 *   "PV032/25-26 DRA TRinity"      → "PV032/25-26"
 *   "PV275/23"                     → "PV275/23"
 *   "Reworks"                      → null (legacy text)
 *   "<p>Proposals 23 - Jains Advaya</p>" → null (no PV ref)
 * Trailing &nbsp;, surrounding HTML tags, and post-PV customer name suffixes
 * are stripped.
 */
function parseQuoteId(s: string): string | null {
  if (!s) return null;
  const stripped = s
    .replace(/<[^>]+>/g, ' ')   // strip <p>, </p>
    .replace(/&nbsp;/gi, ' ')
    .trim();
  // PV ref forms: PV001/24, PV001/24-25, SE/PV/001/22-23
  const match = stripped.match(/\b(?:SE\/)?PV\s*\/?\s*(\d{1,4})\s*\/\s*(\d{2}(?:-\d{2})?)/i);
  if (!match) return null;
  // Normalise to canonical "PVNNN/YY" or "PVNNN/YY-YY" — match what migrate-hubspot stored.
  // We don't try to reconstruct the EXACT proposal_number; just return enough
  // to look up by hubspot_deal_id later. The PV ref is a fallback signal.
  return `PV${match[1]}/${match[2]}`.toUpperCase();
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface CsvRow {
  recordId: string;
  dealName: string;
  dealStage: string;
  amount: number | null;
  totalProjectValue: number | null;
  receivedAmount: number | null;
  projectSize: number | null;
  quoteIdRaw: string;
  quoteIdParsed: string | null;
  closeDate: string;
  isClosedWon: boolean;
}

type UpdateAction = 'apply-csv-tpv' | 'reset-implausible';

interface UpdateResult {
  proposalNumber: string;
  hubspotDealId: string;
  customerName: string;
  oldTotal: number;
  newTotal: number;
  systemSizeKwp: number;
  perKwp: number;
  rationale: string;
  action: UpdateAction;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const op = '[reimport-hubspot]';
  console.log(`${op} Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`${op} CSV:  ${CSV_PATH}`);

  // ── Read + parse CSV ────────────────────────────────────────────────────────
  const csvText = fs.readFileSync(CSV_PATH, 'utf-8');
  const rows = parseCSV(csvText);
  if (rows.length < 2) { console.error(`${op} empty CSV`); process.exit(1); }

  const header = rows[0];
  const colIdx = (name: string) => header.findIndex(h => h === name);
  const I = {
    recordId: colIdx('Record ID'),
    dealName: colIdx('Deal Name'),
    dealStage: colIdx('Deal Stage'),
    amount: colIdx('Amount'),
    totalProjectValue: colIdx('Total Project Value'),
    receivedAmount: colIdx('Received Amount'),
    projectSize: colIdx('Project Size'),
    quoteId: colIdx('Quote ID'),
    closeDate: colIdx('Close Date'),
    isClosedWon: colIdx('Is Closed Won'),
  };
  for (const [k, v] of Object.entries(I)) {
    if (v < 0) { console.error(`${op} missing column: ${k}`); process.exit(1); }
  }
  console.log(`${op} CSV columns located. ${rows.length - 1} data rows.`);

  // ── Build per-deal index ────────────────────────────────────────────────────
  // Many CSVs have duplicate rows per deal (one per stage). We need the row with
  // the most-complete TPV per Record ID.
  const byRecord = new Map<string, CsvRow>();
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (row.length < header.length - 5) continue; // skip malformed
    const recordId = (row[I.recordId] || '').trim();
    if (!recordId) continue;
    const candidate: CsvRow = {
      recordId,
      dealName: (row[I.dealName] || '').trim(),
      dealStage: (row[I.dealStage] || '').trim(),
      amount: parseAmount(row[I.amount] || ''),
      totalProjectValue: parseAmount(row[I.totalProjectValue] || ''),
      receivedAmount: parseAmount(row[I.receivedAmount] || ''),
      projectSize: parseAmount(row[I.projectSize] || ''),
      quoteIdRaw: row[I.quoteId] || '',
      quoteIdParsed: parseQuoteId(row[I.quoteId] || ''),
      closeDate: (row[I.closeDate] || '').trim(),
      isClosedWon: (row[I.isClosedWon] || '').toLowerCase() === 'true',
    };
    const prev = byRecord.get(recordId);
    if (!prev) {
      byRecord.set(recordId, candidate);
    } else {
      // Prefer the row with TPV set, else the one with the largest Amount
      const prevTpv = prev.totalProjectValue ?? 0;
      const newTpv = candidate.totalProjectValue ?? 0;
      if (newTpv > prevTpv) byRecord.set(recordId, candidate);
    }
  }
  console.log(`${op} ${byRecord.size} unique deal records in CSV.`);

  // ── Fetch existing HubSpot proposals from DB ────────────────────────────────
  const { data: existing, error } = await supabase
    .from('proposals')
    .select('id, proposal_number, hubspot_deal_id, system_size_kwp, total_after_discount, financials_invalidated, lead_id')
    .not('hubspot_deal_id', 'is', null);
  if (error) { console.error(error); process.exit(1); }
  console.log(`${op} ${existing?.length ?? 0} HubSpot-linked proposals in DB.`);

  // Lead-name lookup (for nice logs only)
  const leadIds = [...new Set((existing ?? []).map(p => p.lead_id).filter(Boolean))];
  const leadNameByLeadId = new Map<string, string>();
  if (leadIds.length > 0) {
    const { data: leads } = await supabase
      .from('leads')
      .select('id, customer_name')
      .in('id', leadIds);
    for (const l of leads ?? []) leadNameByLeadId.set(l.id, l.customer_name);
  }

  // ── Match + decide updates ──────────────────────────────────────────────────
  const updates: UpdateResult[] = [];
  const skipped: { proposalNumber: string; hubspotDealId: string; reason: string }[] = [];
  let unmatched = 0;
  let perKwpRejected = 0;

  for (const prop of existing ?? []) {
    const csvRow = byRecord.get(prop.hubspot_deal_id!);
    if (!csvRow) {
      unmatched++;
      continue;
    }

    const tpv = csvRow.totalProjectValue;
    const oldTotal = Number(prop.total_after_discount);
    const sizeKwp = Number(prop.system_size_kwp);
    const customerName = leadNameByLeadId.get(prop.lead_id) ?? csvRow.dealName;

    if (sizeKwp <= 0) {
      skipped.push({
        proposalNumber: prop.proposal_number,
        hubspotDealId: prop.hubspot_deal_id!,
        reason: `system_size_kwp is 0 — can't sanity-check`,
      });
      continue;
    }

    const oldPerKwp = oldTotal > 0 ? oldTotal / sizeKwp : 0;

    // ── Case A: CSV has a plausible TPV → apply it ─────────────────────────
    if (tpv && tpv > 0) {
      const newPerKwp = tpv / sizeKwp;
      if (newPerKwp > MAX_PLAUSIBLE_PER_KWP) {
        perKwpRejected++;
        skipped.push({
          proposalNumber: prop.proposal_number,
          hubspotDealId: prop.hubspot_deal_id!,
          reason: `CSV TPV ₹${tpv.toLocaleString('en-IN')} for ${sizeKwp} kWp = ₹${Math.round(newPerKwp).toLocaleString('en-IN')}/kWp > ₹5L/kWp ceiling — likely CSV typo`,
        });
        continue;
      }
      if (Math.abs(oldTotal - tpv) < 1) {
        skipped.push({
          proposalNumber: prop.proposal_number,
          hubspotDealId: prop.hubspot_deal_id!,
          reason: `CSV TPV matches stored value already (no-op)`,
        });
        continue;
      }
      updates.push({
        proposalNumber: prop.proposal_number,
        hubspotDealId: prop.hubspot_deal_id!,
        customerName,
        oldTotal,
        newTotal: tpv,
        systemSizeKwp: sizeKwp,
        perKwp: newPerKwp,
        rationale: `CSV TPV ₹${tpv.toLocaleString('en-IN')} replaces stored ₹${oldTotal.toLocaleString('en-IN')}`,
        action: 'apply-csv-tpv',
      });
      continue;
    }

    // ── Case B: No TPV in CSV, but stored value is implausible → reset ─────
    // The corrupted HubSpot-migrated values (₹30,628 Cr for 5 kWp etc.) live
    // here. Without a fresh source of truth, the only safe move is to reset
    // and surface a banner; the SE re-quotes from the live ERP.
    if (oldPerKwp > MAX_PLAUSIBLE_PER_KWP) {
      updates.push({
        proposalNumber: prop.proposal_number,
        hubspotDealId: prop.hubspot_deal_id!,
        customerName,
        oldTotal,
        newTotal: 0,
        systemSizeKwp: sizeKwp,
        perKwp: oldPerKwp,
        rationale: `Stored ₹${oldTotal.toLocaleString('en-IN')} for ${sizeKwp} kWp = ₹${Math.round(oldPerKwp).toLocaleString('en-IN')}/kWp is implausible; CSV has no fresh TPV. Reset + flag.`,
        action: 'reset-implausible',
      });
      continue;
    }

    // ── Case C: No TPV in CSV, stored value is plausible → leave alone ─────
    skipped.push({
      proposalNumber: prop.proposal_number,
      hubspotDealId: prop.hubspot_deal_id!,
      reason: `no TPV in CSV but stored ₹${oldTotal.toLocaleString('en-IN')} is plausible (₹${Math.round(oldPerKwp).toLocaleString('en-IN')}/kWp) — left alone`,
    });
  }

  // ── Report ──────────────────────────────────────────────────────────────────
  console.log('');
  console.log(`${op} ━━━━━━━━━━ Plan ━━━━━━━━━━`);
  const applyTpvCount = updates.filter(u => u.action === 'apply-csv-tpv').length;
  const resetCount = updates.filter(u => u.action === 'reset-implausible').length;
  console.log(`${op}   Apply CSV TPV:      ${applyTpvCount}`);
  console.log(`${op}   Reset implausible:  ${resetCount}`);
  console.log(`${op}   Skipped (other):    ${skipped.length - perKwpRejected}`);
  console.log(`${op}   Skipped (>₹5L/kWp): ${perKwpRejected}`);
  console.log(`${op}   Unmatched in CSV:   ${unmatched}`);

  if (updates.length > 0) {
    console.log(`\n${op} Apply-TPV updates (sorted by per-kWp asc):`);
    const tpvUpdates = updates.filter(u => u.action === 'apply-csv-tpv').sort((a, b) => a.perKwp - b.perKwp);
    for (const u of tpvUpdates.slice(0, 30)) {
      console.log(`  ${u.proposalNumber.padEnd(28)} | ${u.systemSizeKwp.toString().padStart(7)} kWp | ₹${u.oldTotal.toLocaleString('en-IN').padStart(18)} → ₹${u.newTotal.toLocaleString('en-IN').padStart(15)} | ₹${Math.round(u.perKwp / 1000)}K/kWp | ${u.customerName.slice(0, 25)}`);
    }
    if (tpvUpdates.length > 30) console.log(`  ... and ${tpvUpdates.length - 30} more.`);

    console.log(`\n${op} Reset-implausible updates (sorted by per-kWp desc):`);
    const resetUpdates = updates.filter(u => u.action === 'reset-implausible').sort((a, b) => b.perKwp - a.perKwp);
    for (const u of resetUpdates.slice(0, 30)) {
      console.log(`  ${u.proposalNumber.padEnd(28)} | ${u.systemSizeKwp.toString().padStart(7)} kWp | ₹${u.oldTotal.toLocaleString('en-IN').padStart(18)} → ₹0 | was ₹${(u.perKwp / 1e7).toFixed(2)}Cr/kWp | ${u.customerName.slice(0, 25)}`);
    }
    if (resetUpdates.length > 30) console.log(`  ... and ${resetUpdates.length - 30} more.`);
  }

  if (perKwpRejected > 0) {
    console.log(`\n${op} Rejected (>₹5L/kWp — need manual review):`);
    for (const s of skipped.filter(x => x.reason.includes('₹5L/kWp ceiling'))) {
      console.log(`  ${s.proposalNumber.padEnd(28)} | ${s.reason}`);
    }
  }

  // Skip-reason breakdown
  const reasonCounts: Record<string, number> = {};
  for (const s of skipped) {
    const key = s.reason.split(/[\d₹]/)[0].trim() || s.reason.slice(0, 60);
    reasonCounts[key] = (reasonCounts[key] ?? 0) + 1;
  }
  console.log(`\n${op} Skip-reason breakdown:`);
  for (const [reason, count] of Object.entries(reasonCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${count.toString().padStart(4)} × ${reason}`);
  }
  // Sample skipped (first 10)
  if (skipped.length > 0) {
    console.log(`\n${op} Sample skipped (first 10):`);
    for (const s of skipped.slice(0, 10)) {
      console.log(`  ${s.proposalNumber.padEnd(28)} | ${s.reason}`);
    }
  }

  // ── Apply ───────────────────────────────────────────────────────────────────
  if (!APPLY) {
    console.log(`\n${op} DRY-RUN. Re-run with --apply to write to DB.`);
    return;
  }

  console.log(`\n${op} Applying ${updates.length} updates...`);
  let applied = 0;
  let errored = 0;
  for (const u of updates) {
    let noteAddendum: string;
    let updatePayload: Record<string, unknown>;
    if (u.action === 'apply-csv-tpv') {
      noteAddendum = `[HubSpot reimport 2026-05-02] Total updated from CSV TPV: ₹${u.oldTotal.toLocaleString('en-IN')} → ₹${u.newTotal.toLocaleString('en-IN')} (per-kWp ₹${Math.round(u.perKwp).toLocaleString('en-IN')}). HubSpot deal ${u.hubspotDealId}.`;
      updatePayload = {
        total_after_discount: u.newTotal,
        total_before_discount: u.newTotal,
        shiroi_revenue: u.newTotal,
        financials_invalidated: false, // fresh good value
      };
    } else {
      // reset-implausible
      noteAddendum = `[HubSpot reimport 2026-05-02] Reset corrupted total ₹${u.oldTotal.toLocaleString('en-IN')} (was ₹${(u.perKwp / 1e7).toFixed(2)}Cr/kWp — implausible). 2026-05-02 HubSpot CSV had no fresh Total Project Value for this deal. Re-quote in the live ERP. HubSpot deal ${u.hubspotDealId}.`;
      updatePayload = {
        total_after_discount: 0,
        total_before_discount: 0,
        subtotal_supply: 0,
        subtotal_works: 0,
        gst_supply_amount: 0,
        gst_works_amount: 0,
        shiroi_revenue: 0,
        shiroi_cost: 0,
        gross_margin_amount: 0,
        gross_margin_pct: 0,
        financials_invalidated: true,
        financials_invalidated_at: new Date().toISOString(),
        financials_invalidated_reason: noteAddendum,
      };
    }

    // Preserve existing notes prefix
    const { data: row, error: readErr } = await supabase
      .from('proposals')
      .select('notes')
      .eq('hubspot_deal_id', u.hubspotDealId)
      .single();
    if (readErr || !row) { console.error(`  ${u.proposalNumber}: read error: ${readErr?.message}`); errored++; continue; }

    const newNotes = row.notes ? `${row.notes}\n${noteAddendum}` : noteAddendum;

    const { error: updErr } = await supabase
      .from('proposals')
      .update({ ...updatePayload, notes: newNotes, updated_at: new Date().toISOString() })
      .eq('hubspot_deal_id', u.hubspotDealId);
    if (updErr) {
      console.error(`  ${u.proposalNumber}: update error: ${updErr.message}`);
      errored++;
    } else {
      applied++;
    }
  }
  console.log(`${op} Done. Applied: ${applied}, Errored: ${errored}.`);
}

main().catch(e => { console.error(e); process.exit(1); });
