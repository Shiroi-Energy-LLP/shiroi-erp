/**
 * Tier B inline re-extraction — Steps 1–4 only.
 *
 * Steps 1-4: Load candidates from DB, pick best doc per lead, extract text,
 * write extracted text to scripts/data/tier-b-doc-texts/<proposal_number_safe>.txt
 * plus an index JSON at scripts/data/tier-b-doc-texts/_index.json.
 *
 * Steps 5-6 (analysis + classification) are done by the Claude subagent reading
 * the saved text files directly — no Anthropic API key needed.
 *
 * Run: npx tsx scripts/ai-reextract-tier-b-inline.ts
 *
 * Candidate criteria: non-HubSpot proposals where
 *   total_after_discount > 0
 *   AND total_after_discount / system_size_kwp >= 200_000 (₹2L/kWp)
 *   AND NOT above Tier A threshold (tier A rows already zeroed by mig 088)
 *   AND hubspot_deal_id IS NULL
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: 'C:/Users/vivek/Projects/shiroi-erp/.env.local' });

import { createClient } from '@supabase/supabase-js';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import * as fs from 'fs';
import * as path from 'path';

// ─── Config ─────────────────────────────────────────────────────────────────

const WORKTREE = 'C:/Users/vivek/Projects/shiroi-erp/.claude/worktrees/friendly-montalcini-e601d1';
const OUTPUT_DIR = path.join(WORKTREE, 'scripts/data/tier-b-doc-texts');
const INDEX_PATH = path.join(OUTPUT_DIR, '_index.json');
const MAX_TEXT_CHARS = 15_000;

const TIER_B_FLOOR = 200_000;           // ₹2L/kWp — min to be a candidate
const TIER_A_CONFIDENT = 200_000;       // ₹2L/kWp — Tier A threshold for confident-kWp
const TIER_A_DOUBTFUL = 500_000;        // ₹5L/kWp — Tier A threshold for doubtful-kWp
// Tier B = perKwp in [TIER_B_FLOOR, threshold] where threshold depends on kWp confidence

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
);

// ─── Types ───────────────────────────────────────────────────────────────────

interface Candidate {
  id: string;
  proposal_number: string;
  system_size_kwp: number;
  total_after_discount: number;
  per_kwp: number;
  lead_id: string;
  customer_name: string;
}

export interface IndexEntry {
  proposal_number: string;
  proposal_id: string;
  customer_name: string;
  stored_size_kwp: number;
  stored_total: number;
  stored_per_kwp: number;
  file_picked: string | null;
  file_match_reason: string;
  text_path: string | null;
  extraction_status: 'extracted' | 'no-doc' | 'parse-error';
  text_length: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function tokenize(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 3)
    .filter(t => !['mr', 'mrs', 'ms', 'dr', 'sri', 'smt', 'pvt', 'ltd', 'llp', 'the', 'and'].includes(t));
}

function getRevisionNumber(filename: string): number {
  const m = filename.match(/Rev_?(\d+)/i);
  return m ? parseInt(m[1], 10) : 0;
}

function proposalNumberSafe(pn: string): string {
  return pn.replace(/\//g, '_');
}

// ─── Step 1: Load candidates ─────────────────────────────────────────────────

async function loadCandidates(): Promise<Candidate[]> {
  const op = '[loadCandidates]';

  const { data: all, error: propErr } = await supabase
    .from('proposals')
    .select('id, proposal_number, system_size_kwp, total_after_discount, lead_id, hubspot_deal_id')
    .gt('total_after_discount', 0);

  if (propErr || !all) {
    console.error(op, 'Failed to load proposals:', propErr?.message);
    return [];
  }

  // Load all leads in pages to build a lookup map
  const leadMap = new Map<string, { customer_name: string; estimated_size_kwp: number | null }>();
  let offset = 0;
  while (true) {
    const { data: batch, error: leadErr } = await supabase
      .from('leads')
      .select('id, customer_name, estimated_size_kwp')
      .range(offset, offset + 999);
    if (leadErr) { console.error(op, 'Lead page error:', leadErr.message); break; }
    if (!batch || batch.length === 0) break;
    for (const l of batch) {
      leadMap.set(l.id, {
        customer_name: l.customer_name ?? '(unknown)',
        estimated_size_kwp: l.estimated_size_kwp != null ? Number(l.estimated_size_kwp) : null,
      });
    }
    if (batch.length < 1000) break;
    offset += 1000;
  }
  console.log(`${op} Loaded ${leadMap.size} leads`);

  // Projects for kWp confidence check
  const proposalIds = all.map(p => p.id);
  const { data: projects } = await supabase
    .from('projects')
    .select('proposal_id, system_size_kwp')
    .in('proposal_id', proposalIds.slice(0, 1000)); // supabase .in() limit
  const projMap = new Map((projects ?? []).map(p => [p.proposal_id, Number(p.system_size_kwp)]));

  const candidates: Candidate[] = [];

  for (const p of all) {
    // Exclude HubSpot-migrated
    if (p.hubspot_deal_id) continue;

    const size = Number(p.system_size_kwp);
    const total = Number(p.total_after_discount);
    if (size <= 0 || total <= 0) continue;

    const perKwp = total / size;

    // Must be at or above the ₹2L/kWp floor
    if (perKwp < TIER_B_FLOOR) continue;

    // Determine kWp confidence
    const lead = leadMap.get(p.lead_id);
    const leadSize = lead?.estimated_size_kwp ?? null;
    const projSize = projMap.get(p.id) ?? null;

    let kwpConfident = false;
    if (leadSize && leadSize > 0) {
      if (Math.abs(size - leadSize) / Math.max(size, leadSize) < 0.2) kwpConfident = true;
    }
    if (!kwpConfident && projSize && projSize > 0) {
      if (Math.abs(size - projSize) / Math.max(size, projSize) < 0.2) kwpConfident = true;
    }

    const threshold = kwpConfident ? TIER_A_CONFIDENT : TIER_A_DOUBTFUL;

    // Tier B = above floor but NOT above Tier A threshold
    // (Tier A rows are already zeroed by migration 088 so perKwp would be 0 — they
    //  self-exclude from the total_after_discount > 0 filter. But we keep this
    //  conditional for correctness in case 088 hasn't run yet.)
    if (perKwp <= threshold) {
      candidates.push({
        id: p.id,
        proposal_number: p.proposal_number ?? '(no number)',
        system_size_kwp: size,
        total_after_discount: total,
        per_kwp: perKwp,
        lead_id: p.lead_id,
        customer_name: lead?.customer_name ?? '(unknown)',
      });
    }
  }

  return candidates;
}

// ─── Step 2: Pick best doc ────────────────────────────────────────────────────

async function pickBestDoc(
  leadId: string,
  customerName: string,
): Promise<{ name: string; ext: 'docx' | 'pdf'; reason: string } | null> {
  const op = '[pickBestDoc]';

  const { data: files, error } = await supabase.storage
    .from('proposal-files')
    .list(leadId, { limit: 200 });

  if (error || !files || files.length === 0) {
    if (error) console.warn(op, `list error for ${leadId}:`, error.message);
    return null;
  }

  const customerTokens = tokenize(customerName);
  type Scored = { name: string; ext: 'docx' | 'pdf'; rev: number; nameMatch: boolean; isProposal: boolean };
  const scored: Scored[] = [];

  for (const f of files) {
    const lower = f.name.toLowerCase();
    let ext: 'docx' | 'pdf' | null = null;
    if (lower.endsWith('.docx')) ext = 'docx';
    else if (lower.endsWith('.pdf')) ext = 'pdf';
    else continue;

    const fileTokens = tokenize(f.name);
    const nameMatch =
      customerTokens.length === 0
        ? false
        : customerTokens.some(t => fileTokens.some(ft => ft.includes(t) || t.includes(ft)));
    const isProposal = /proposal|quote|quotation/i.test(f.name);

    scored.push({ name: f.name, ext, rev: getRevisionNumber(f.name), nameMatch, isProposal });
  }

  if (scored.length === 0) return null;

  // Sort: nameMatch > isProposal > highest rev > docx > pdf
  scored.sort((a, b) => {
    if (a.nameMatch !== b.nameMatch) return a.nameMatch ? -1 : 1;
    if (a.isProposal !== b.isProposal) return a.isProposal ? -1 : 1;
    if (a.rev !== b.rev) return b.rev - a.rev;
    if (a.ext !== b.ext) return a.ext === 'docx' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const best = scored[0];
  const reason = [
    best.nameMatch ? 'matches customer name' : 'no customer-name match',
    best.isProposal ? 'is a proposal/quote doc' : 'not labelled as proposal',
    `rev=${best.rev}`,
    best.ext,
  ].join(' | ');

  return { name: best.name, ext: best.ext, reason };
}

// ─── Step 3: Extract text ────────────────────────────────────────────────────

async function extractText(buffer: Buffer, ext: 'docx' | 'pdf'): Promise<string> {
  if (ext === 'docx') {
    const result = await mammoth.extractRawText({ buffer });
    return result.value.trim();
  }
  // pdf-parse v2: class-based API
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return (result.text ?? '').trim();
  } finally {
    await parser.destroy();
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const op = '[main]';
  console.log('=== Tier B inline text extraction (Steps 1–4) ===\n');

  // Ensure output directory exists
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Step 1: Load candidates
  console.log('Step 1: Loading candidates...');
  const candidates = await loadCandidates();
  console.log(`  → ${candidates.length} candidates loaded\n`);

  if (candidates.length < 10 || candidates.length > 25) {
    console.warn(`WARNING: candidate count ${candidates.length} is outside expected range [10, 25].`);
    if (candidates.length === 0) {
      console.error('Zero candidates — STOPPING. Check DB connection and migration state.');
      process.exit(1);
    }
  }

  const index: IndexEntry[] = [];

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const safe = proposalNumberSafe(c.proposal_number);
    const textFile = path.join(OUTPUT_DIR, `${safe}.txt`);

    console.log(
      `[${i + 1}/${candidates.length}] ${c.proposal_number} | ${c.customer_name.slice(0, 30)} | ` +
      `${c.system_size_kwp} kWp | stored ₹${(c.total_after_discount / 1e5).toFixed(2)}L | ` +
      `per-kWp ₹${Math.round(c.per_kwp / 1000)}K`,
    );

    const entry: IndexEntry = {
      proposal_number: c.proposal_number,
      proposal_id: c.id,
      customer_name: c.customer_name,
      stored_size_kwp: c.system_size_kwp,
      stored_total: c.total_after_discount,
      stored_per_kwp: c.per_kwp,
      file_picked: null,
      file_match_reason: '',
      text_path: null,
      extraction_status: 'no-doc',
      text_length: 0,
    };

    // Step 2: Pick best doc
    const docPick = await pickBestDoc(c.lead_id, c.customer_name);
    if (!docPick) {
      console.log(`  → no .docx/.pdf found in lead folder ${c.lead_id}`);
      index.push(entry);
      continue;
    }
    entry.file_picked = docPick.name;
    entry.file_match_reason = docPick.reason;
    console.log(`  → file: ${docPick.name} (${docPick.reason})`);

    // Download
    const filePath = `${c.lead_id}/${docPick.name}`;
    const { data: fileData, error: dlErr } = await supabase.storage
      .from('proposal-files')
      .download(filePath);
    if (dlErr || !fileData) {
      entry.extraction_status = 'parse-error';
      console.log(`  → download error: ${dlErr?.message ?? 'no data'}`);
      index.push(entry);
      continue;
    }

    // Step 3: Extract text
    let text = '';
    try {
      const buffer = Buffer.from(await fileData.arrayBuffer());
      text = await extractText(buffer, docPick.ext);
    } catch (e) {
      entry.extraction_status = 'parse-error';
      console.log(`  → text extract failed: ${(e as Error).message.slice(0, 100)}`);
      index.push(entry);
      continue;
    }

    if (text.length < 200) {
      entry.extraction_status = 'parse-error';
      console.log(`  → text too short (${text.length} chars) — likely empty/scanned doc`);
      index.push(entry);
      continue;
    }

    // Step 4: Write truncated text to disk
    const truncated = text.length > MAX_TEXT_CHARS
      ? text.substring(0, MAX_TEXT_CHARS) + '\n\n[TRUNCATED at 15000 chars]'
      : text;

    fs.writeFileSync(textFile, truncated, 'utf-8');
    entry.text_path = textFile;
    entry.extraction_status = 'extracted';
    entry.text_length = truncated.length;
    console.log(`  → extracted ${text.length} chars → saved (${truncated.length} chars)`);

    index.push(entry);
  }

  // Write the index
  fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2), 'utf-8');

  // Summary
  const byStatus: Record<string, number> = {};
  for (const e of index) byStatus[e.extraction_status] = (byStatus[e.extraction_status] ?? 0) + 1;

  console.log('\n=== Extraction summary ===');
  console.log(`Total candidates: ${candidates.length}`);
  console.log('By status:', byStatus);
  console.log(`\nIndex written to: ${INDEX_PATH}`);
  console.log('Text files in:', OUTPUT_DIR);
  console.log('\nNext: Claude subagent reads each .txt and produces tier-b-reextraction-results.json');
}

main().catch(e => {
  console.error('[main] Fatal error:', e);
  process.exit(1);
});
