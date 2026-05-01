/**
 * AI re-extraction for the 17 Tier B candidates (non-HubSpot, ≥₹2L/kWp, below
 * Vivek's adaptive threshold).
 *
 * For each candidate:
 *   1. List files in the lead's storage folder.
 *   2. Pick the most plausible proposal doc (prefers customer-name + latest revision in .docx/.pdf).
 *   3. Extract text via mammoth (docx) or pdf-parse (pdf).
 *   4. Send to Claude Sonnet with the existing PROPOSAL_EXTRACTION_PROMPT.
 *   5. Validate output against ProposalDocSchema.
 *   6. Compare extracted total_cost / system_size_kwp to stored values.
 *   7. Classify: recoverable (sane extracted), still-suspicious (extracted also implausible), unknown (no doc/parse failed).
 *
 * Does NOT mutate the DB. Writes results to scripts/data/tier-b-reextraction-results.json.
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: 'C:/Users/vivek/Projects/shiroi-erp/.env.local' });

import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import mammoth from 'mammoth';
import * as pdfParse from 'pdf-parse';
import * as fs from 'fs';
import { ProposalDocSchema } from './ai-extract-schemas';
import { PROPOSAL_EXTRACTION_PROMPT } from './ai-extract-prompts';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
);

if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY.length < 10) {
  console.error('ANTHROPIC_API_KEY is empty in .env.local. Add it (line 12) before running.');
  process.exit(2);
}
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = 'claude-sonnet-4-20250514';
const MAX_TEXT_CHARS = 15000;

// Same Tier B threshold logic as verify-kwp-and-tier-b.ts
const TIER_A_CONFIDENT = 200_000;
const TIER_A_DOUBTFUL = 500_000;
const TIER_B_FLOOR = 200_000;

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
  return m ? parseInt(m[1]) : 0;
}

interface Candidate {
  id: string;
  proposal_number: string;
  system_size_kwp: number;
  total_after_discount: number;
  per_kwp: number;
  lead_id: string;
  customer_name: string;
}

interface ReExtractResult {
  proposal_number: string;
  proposal_id: string;
  customer_name: string;
  stored_size_kwp: number;
  stored_total: number;
  stored_per_kwp: number;
  file_picked: string | null;
  file_match_reason: string;
  extraction_status: 'extracted' | 'no-doc' | 'parse-error' | 'ai-error' | 'schema-fail';
  extracted_size_kwp: number | null;
  extracted_total: number | null;
  extracted_per_kwp: number | null;
  extracted_raw: any;
  classification: 'recoverable' | 'still-suspicious' | 'no-signal';
  recovery_action: string;
  tokens_used: number;
}

async function pickBestProposalDoc(leadId: string, customerName: string): Promise<{ name: string; ext: 'docx' | 'pdf'; reason: string } | null> {
  const { data: files } = await supabase.storage.from('proposal-files').list(leadId, { limit: 100 });
  if (!files || files.length === 0) return null;

  const customerTokens = tokenize(customerName);
  const candidates: Array<{ name: string; ext: 'docx' | 'pdf'; rev: number; nameMatch: boolean; isProposal: boolean }> = [];
  for (const f of files) {
    const lower = f.name.toLowerCase();
    let ext: 'docx' | 'pdf' | null = null;
    if (lower.endsWith('.docx')) ext = 'docx';
    else if (lower.endsWith('.pdf')) ext = 'pdf';
    else continue;

    const fileTokens = tokenize(f.name);
    const nameMatch = customerTokens.length === 0
      ? false
      : customerTokens.some(t => fileTokens.some(ft => ft.includes(t) || t.includes(ft)));
    const isProposal = /proposal|quote|quotation/i.test(f.name);

    candidates.push({
      name: f.name,
      ext,
      rev: getRevisionNumber(f.name),
      nameMatch,
      isProposal,
    });
  }
  if (candidates.length === 0) return null;

  // Score: nameMatch (best) > isProposal > rev > docx > pdf
  candidates.sort((a, b) => {
    if (a.nameMatch !== b.nameMatch) return a.nameMatch ? -1 : 1;
    if (a.isProposal !== b.isProposal) return a.isProposal ? -1 : 1;
    if (a.rev !== b.rev) return b.rev - a.rev;
    if (a.ext !== b.ext) return a.ext === 'docx' ? -1 : 1;
    return 0;
  });

  const best = candidates[0];
  const reason = [
    best.nameMatch ? 'matches customer name' : 'no customer-name match',
    best.isProposal ? 'is a proposal/quote doc' : 'not labelled as proposal',
    `rev=${best.rev}`,
    best.ext,
  ].join(' | ');
  return { name: best.name, ext: best.ext, reason };
}

async function extractText(buffer: Buffer, ext: 'docx' | 'pdf'): Promise<string> {
  if (ext === 'docx') {
    return (await mammoth.extractRawText({ buffer })).value.trim();
  }
  const result = await (pdfParse as any).default(buffer);
  return (result.text || '').trim();
}

async function callClaude(text: string, fileName: string): Promise<{ parsed: any; tokens: number; error?: string }> {
  const truncated = text.length > MAX_TEXT_CHARS ? text.substring(0, MAX_TEXT_CHARS) + '\n\n[TRUNCATED]' : text;
  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2000,
      messages: [{ role: 'user', content: PROPOSAL_EXTRACTION_PROMPT + truncated }],
    });
    const content = response.content[0];
    if (content.type !== 'text') return { parsed: null, tokens: response.usage.input_tokens + response.usage.output_tokens, error: 'non-text response' };
    let jsonStr = content.text.trim();
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) jsonStr = jsonMatch[1].trim();
    const parsed = JSON.parse(jsonStr);
    return { parsed, tokens: response.usage.input_tokens + response.usage.output_tokens };
  } catch (e) {
    return { parsed: null, tokens: 0, error: (e as Error).message.substring(0, 200) };
  }
}

async function loadCandidates(): Promise<Candidate[]> {
  const { data: all } = await supabase
    .from('proposals')
    .select('id, proposal_number, system_size_kwp, total_after_discount, lead_id, hubspot_deal_id')
    .gt('total_after_discount', 0);
  if (!all) return [];

  // Load ALL leads — bypasses the .in() large-list quirk that returned empty earlier.
  const leadMap = new Map<string, { customer_name: string; estimated_size_kwp: number | null }>();
  let offset = 0;
  while (true) {
    const { data: batch } = await supabase
      .from('leads')
      .select('id, customer_name, estimated_size_kwp')
      .range(offset, offset + 999);
    if (!batch || batch.length === 0) break;
    for (const l of batch) {
      leadMap.set(l.id, {
        customer_name: l.customer_name,
        estimated_size_kwp: l.estimated_size_kwp ? Number(l.estimated_size_kwp) : null,
      });
    }
    if (batch.length < 1000) break;
    offset += 1000;
  }
  console.log(`Loaded ${leadMap.size} leads`);

  const { data: projects } = await supabase
    .from('projects')
    .select('proposal_id, system_size_kwp')
    .in('proposal_id', all.map(p => p.id));
  const projMap = new Map((projects ?? []).map(p => [p.proposal_id, Number(p.system_size_kwp)]));

  const candidates: Candidate[] = [];
  for (const p of all) {
    if (p.hubspot_deal_id) continue;
    const size = Number(p.system_size_kwp);
    const total = Number(p.total_after_discount);
    if (size <= 0) continue;
    const perKwp = total / size;
    if (perKwp < TIER_B_FLOOR) continue;

    const lead = leadMap.get(p.lead_id);
    const leadSize = lead?.estimated_size_kwp ?? null;
    const projSize = projMap.get(p.id) ?? null;

    let kwpConfident = false;
    if (leadSize && leadSize > 0) {
      if (Math.abs(size - leadSize) / Math.max(size, leadSize) < 0.2) kwpConfident = true;
    }
    if (projSize && projSize > 0) {
      if (Math.abs(size - projSize) / Math.max(size, projSize) < 0.2) kwpConfident = true;
    }
    const threshold = kwpConfident ? TIER_A_CONFIDENT : TIER_A_DOUBTFUL;

    // Tier B = ≥ floor AND ≤ threshold, non-HubSpot
    if (perKwp <= threshold) {
      candidates.push({
        id: p.id,
        proposal_number: p.proposal_number,
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

async function main() {
  console.log('=== Tier B AI re-extraction ===');
  const candidates = await loadCandidates();
  console.log(`Loaded ${candidates.length} candidates\n`);

  const results: ReExtractResult[] = [];
  let totalTokens = 0;

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    console.log(`[${i + 1}/${candidates.length}] ${c.proposal_number} | ${c.customer_name.slice(0, 30)} | ${c.system_size_kwp}kWp | stored ₹${(c.total_after_discount / 1e5).toFixed(1)}L`);

    const result: ReExtractResult = {
      proposal_number: c.proposal_number,
      proposal_id: c.id,
      customer_name: c.customer_name,
      stored_size_kwp: c.system_size_kwp,
      stored_total: c.total_after_discount,
      stored_per_kwp: c.per_kwp,
      file_picked: null,
      file_match_reason: '',
      extraction_status: 'no-doc',
      extracted_size_kwp: null,
      extracted_total: null,
      extracted_per_kwp: null,
      extracted_raw: null,
      classification: 'no-signal',
      recovery_action: 'banner only',
      tokens_used: 0,
    };

    const docPick = await pickBestProposalDoc(c.lead_id, c.customer_name);
    if (!docPick) {
      console.log(`  → no doc found in lead folder`);
      results.push(result);
      continue;
    }
    result.file_picked = docPick.name;
    result.file_match_reason = docPick.reason;
    console.log(`  → file: ${docPick.name} (${docPick.reason})`);

    // Download
    const filePath = `${c.lead_id}/${docPick.name}`;
    const { data: fileData, error: dlErr } = await supabase.storage.from('proposal-files').download(filePath);
    if (dlErr || !fileData) {
      result.extraction_status = 'parse-error';
      result.recovery_action = `download failed: ${dlErr?.message ?? 'unknown'}`;
      console.log(`  → download error: ${dlErr?.message}`);
      results.push(result);
      continue;
    }

    let text = '';
    try {
      const buffer = Buffer.from(await fileData.arrayBuffer());
      text = await extractText(buffer, docPick.ext);
    } catch (e) {
      result.extraction_status = 'parse-error';
      result.recovery_action = `text extract failed: ${(e as Error).message.substring(0, 100)}`;
      console.log(`  → text extract failed`);
      results.push(result);
      continue;
    }

    if (text.length < 200) {
      result.extraction_status = 'parse-error';
      result.recovery_action = 'doc text too short';
      console.log(`  → text too short (${text.length} chars)`);
      results.push(result);
      continue;
    }

    // Claude extraction
    const ai = await callClaude(text, docPick.name);
    result.tokens_used = ai.tokens;
    totalTokens += ai.tokens;
    if (!ai.parsed) {
      result.extraction_status = 'ai-error';
      result.recovery_action = `Claude error: ${ai.error}`;
      console.log(`  → Claude error: ${ai.error}`);
      results.push(result);
      continue;
    }

    // Validate
    const validation = ProposalDocSchema.safeParse(ai.parsed);
    if (!validation.success) {
      // Schema fail still useful — keep raw output
      result.extraction_status = 'schema-fail';
      result.extracted_raw = ai.parsed;
      const tc = Number(ai.parsed.total_cost ?? 0);
      const sk = Number(ai.parsed.system_size_kwp ?? 0);
      if (tc > 0) result.extracted_total = tc;
      if (sk > 0) result.extracted_size_kwp = sk;
      if (tc > 0 && sk > 0) result.extracted_per_kwp = tc / sk;
      console.log(`  → schema fail; raw total_cost=${tc} size=${sk}`);
    } else {
      result.extraction_status = 'extracted';
      result.extracted_raw = validation.data;
      const tc = validation.data.total_cost ?? null;
      const sk = validation.data.system_size_kwp ?? null;
      result.extracted_total = tc;
      result.extracted_size_kwp = sk;
      if (tc && sk && sk > 0) result.extracted_per_kwp = tc / sk;
    }

    // Classify
    if (result.extracted_total && result.extracted_size_kwp && result.extracted_size_kwp > 0) {
      const ePerKwp = result.extracted_total / result.extracted_size_kwp;
      if (ePerKwp <= TIER_B_FLOOR) {
        result.classification = 'recoverable';
        result.recovery_action = `replace with extracted total ₹${result.extracted_total} for ${result.extracted_size_kwp}kWp (per-kWp ₹${Math.round(ePerKwp / 1000)}K)`;
      } else if (ePerKwp <= TIER_A_DOUBTFUL) {
        result.classification = 'still-suspicious';
        result.recovery_action = `extracted ₹${result.extracted_total} for ${result.extracted_size_kwp}kWp still ≥₹2L/kWp — banner only`;
      } else {
        result.classification = 'still-suspicious';
        result.recovery_action = `extracted ₹${result.extracted_total} also implausible — banner only`;
      }
      console.log(`  → extracted: ${result.extracted_size_kwp}kWp ₹${result.extracted_total} = ₹${Math.round(ePerKwp / 1000)}K/kWp [${result.classification}]`);
    } else {
      result.classification = 'no-signal';
      result.recovery_action = 'extracted incomplete (missing size or total) — banner only';
      console.log(`  → extracted incomplete: size=${result.extracted_size_kwp} total=${result.extracted_total}`);
    }

    results.push(result);
  }

  // Summary
  console.log('\n=== Summary ===');
  const byStatus: Record<string, number> = {};
  const byClass: Record<string, number> = {};
  for (const r of results) {
    byStatus[r.extraction_status] = (byStatus[r.extraction_status] ?? 0) + 1;
    byClass[r.classification] = (byClass[r.classification] ?? 0) + 1;
  }
  console.log('Extraction status:', byStatus);
  console.log('Classification:', byClass);
  console.log(`Total tokens used: ${totalTokens}`);
  console.log(`Approx cost: $${(totalTokens / 1_000_000 * 3).toFixed(2)} (Sonnet input/output mix)`);

  console.log('\n=== Recoverable list ===');
  for (const r of results.filter(x => x.classification === 'recoverable')) {
    console.log(`  ${r.proposal_number} | ${r.customer_name.slice(0, 30)} | stored ${r.stored_size_kwp}kWp ₹${(r.stored_total / 1e5).toFixed(1)}L → extracted ${r.extracted_size_kwp}kWp ₹${(r.extracted_total! / 1e5).toFixed(1)}L`);
  }

  console.log('\n=== Still-suspicious / no-signal list ===');
  for (const r of results.filter(x => x.classification !== 'recoverable')) {
    console.log(`  ${r.proposal_number} | ${r.classification} | ${r.recovery_action}`);
  }

  fs.writeFileSync(
    'C:/Users/vivek/Projects/shiroi-erp/.claude/worktrees/friendly-montalcini-e601d1/scripts/data/tier-b-reextraction-results.json',
    JSON.stringify(results, null, 2),
  );
  console.log('\nResults saved to scripts/data/tier-b-reextraction-results.json');
}

main().catch(e => { console.error(e); process.exit(1); });
