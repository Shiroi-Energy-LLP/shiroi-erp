/**
 * Phase 3: AI Extraction Pipeline — Word docs, PDFs, PPTX
 *
 * Downloads documents from Supabase Storage, extracts text,
 * sends to Claude Sonnet for structured extraction, validates with Zod,
 * and merges into database (fill-gaps-only).
 *
 * Cost estimate: ~3,600 docs × ~1K tokens avg = ~3.6M tokens ≈ $40-60
 *
 * Usage:
 *   npx tsx scripts/ai-extract-pipeline.ts --dry-run              # preview
 *   npx tsx scripts/ai-extract-pipeline.ts --type=docx             # only Word docs
 *   npx tsx scripts/ai-extract-pipeline.ts --type=pdf              # only PDFs
 *   npx tsx scripts/ai-extract-pipeline.ts --type=pptx             # only PPTX
 *   npx tsx scripts/ai-extract-pipeline.ts --bucket=project-files  # only project-files
 *   npx tsx scripts/ai-extract-pipeline.ts --limit=50              # first 50 files
 *   npx tsx scripts/ai-extract-pipeline.ts                         # all files, live
 */

import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import mammoth from 'mammoth';
import * as pdfParse from 'pdf-parse';
import { ProposalDocSchema, VendorDocSchema, type ProposalDoc, type VendorDoc } from './ai-extract-schemas';
import { PROPOSAL_EXTRACTION_PROMPT, VENDOR_EXTRACTION_PROMPT } from './ai-extract-prompts';
import { isDryRun, logMigrationStart, logMigrationEnd } from './migration-utils';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  dotenv.config({ path: 'C:/Users/vivek/Projects/shiroi-erp/.env.local' });
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
);

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

const MODEL = 'claude-sonnet-4-20250514';
const MAX_TEXT_CHARS = 15000; // Truncate very long docs to control cost

// ─── CLI args ───

function getArg(name: string): string | undefined {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.split('=')[1] : undefined;
}

// ─── Text extraction ───

async function extractTextFromDocx(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return result.value.trim();
}

async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  const result = await (pdfParse as any).default(buffer);
  return (result.text || '').trim();
}

async function extractTextFromPptx(buffer: Buffer): Promise<string> {
  // PPTX is a ZIP containing XML slides. Use a simple approach:
  // Extract text from slide XML files using regex on the raw XML
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(buffer);

  const texts: string[] = [];
  const slideFiles = Object.keys(zip.files)
    .filter((f) => f.startsWith('ppt/slides/slide') && f.endsWith('.xml'))
    .sort();

  for (const slideFile of slideFiles) {
    const xml = await zip.files[slideFile].async('text');
    // Extract text between <a:t> tags
    const matches = xml.match(/<a:t>([^<]*)<\/a:t>/g);
    if (matches) {
      const slideText = matches
        .map((m) => m.replace(/<a:t>|<\/a:t>/g, ''))
        .join(' ');
      texts.push(slideText);
    }
  }

  return texts.join('\n\n').trim();
}

// ─── AI extraction ───

async function extractWithClaude(
  text: string,
  prompt: string,
  fileName: string
): Promise<{ parsed: Record<string, any> | null; tokensUsed: number; error?: string }> {
  const truncated = text.length > MAX_TEXT_CHARS
    ? text.substring(0, MAX_TEXT_CHARS) + '\n\n[TRUNCATED]'
    : text;

  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2000,
      messages: [
        {
          role: 'user',
          content: prompt + truncated,
        },
      ],
    });

    const content = response.content[0];
    if (content.type !== 'text') {
      return { parsed: null, tokensUsed: response.usage.input_tokens + response.usage.output_tokens, error: 'Non-text response' };
    }

    // Extract JSON from response (may be wrapped in markdown code blocks)
    let jsonStr = content.text.trim();
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    const parsed = JSON.parse(jsonStr);
    const tokensUsed = response.usage.input_tokens + response.usage.output_tokens;

    return { parsed, tokensUsed };
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.includes('rate_limit') || msg.includes('429')) {
      // Wait and retry once
      console.log(`  Rate limited on ${fileName}, waiting 30s...`);
      await new Promise((r) => setTimeout(r, 30000));
      return extractWithClaude(text, prompt, fileName + '_retry');
    }
    return { parsed: null, tokensUsed: 0, error: msg.substring(0, 200) };
  }
}

// ─── Fill-gaps merge ───

async function mergeProposalData(proposalId: string, leadId: string, extracted: ProposalDoc): Promise<string[]> {
  const op = '[merge-proposal]';
  const updates: string[] = [];

  // Update lead fields (address, email, phone)
  if (extracted.customer_address || extracted.customer_email || extracted.customer_phone) {
    const { data: lead } = await supabase.from('leads').select('*').eq('id', leadId).single();
    if (lead) {
      const leadUpdates: Record<string, any> = {};
      if (extracted.customer_email && !lead.email) {
        leadUpdates.email = extracted.customer_email;
        updates.push('lead.email');
      }
      if (extracted.customer_phone && !lead.phone) {
        leadUpdates.phone = extracted.customer_phone;
        updates.push('lead.phone');
      }
      if (extracted.customer_address) {
        if (!lead.address_line1 && extracted.customer_address.line1) {
          leadUpdates.address_line1 = extracted.customer_address.line1;
          updates.push('lead.address');
        }
        if (!lead.city && extracted.customer_address.city) leadUpdates.city = extracted.customer_address.city;
        if (!lead.state && extracted.customer_address.state) leadUpdates.state = extracted.customer_address.state;
        if (!lead.pincode && extracted.customer_address.pincode) leadUpdates.pincode = extracted.customer_address.pincode;
      }
      if (Object.keys(leadUpdates).length > 0) {
        leadUpdates.updated_at = new Date().toISOString();
        await supabase.from('leads').update(leadUpdates).eq('id', leadId);
      }
    }
  }

  // Update proposal fields
  const { data: proposal } = await supabase.from('proposals').select('*').eq('id', proposalId).single();
  if (proposal) {
    const propUpdates: Record<string, any> = {};
    if (extracted.system_size_kwp && (!proposal.system_size_kwp || proposal.system_size_kwp === 0)) {
      propUpdates.system_size_kwp = extracted.system_size_kwp;
      updates.push('proposal.system_size_kwp');
    }
    if (extracted.total_cost && (!proposal.total_after_discount || proposal.total_after_discount === 0)) {
      propUpdates.total_after_discount = extracted.total_cost;
      propUpdates.total_before_discount = extracted.total_cost;
      updates.push('proposal.total_cost');
    }
    if (extracted.gst_amount && (!proposal.gst_supply_amount || proposal.gst_supply_amount === 0)) {
      propUpdates.gst_supply_amount = extracted.gst_amount;
      updates.push('proposal.gst_amount');
    }
    // Note: annual_generation_kwh extracted but proposals table doesn't have this column
    // This data is stored in extracted_data JSONB in processing_jobs for future use
    if (Object.keys(propUpdates).length > 0) {
      propUpdates.updated_at = new Date().toISOString();
      await supabase.from('proposals').update(propUpdates).eq('id', proposalId);
    }
  }

  // Update lead system size if missing
  if (extracted.system_size_kwp) {
    const { data: lead } = await supabase.from('leads').select('system_size_kwp').eq('id', leadId).single();
    if (lead && (!lead.system_size_kwp || lead.system_size_kwp === 0)) {
      await supabase.from('leads').update({
        system_size_kwp: extracted.system_size_kwp,
        updated_at: new Date().toISOString(),
      }).eq('id', leadId);
      updates.push('lead.system_size');
    }
  }

  return updates;
}

async function mergeVendorData(extracted: VendorDoc): Promise<string[]> {
  if (!extracted.vendor_name) return [];
  const updates: string[] = [];

  // Fuzzy match vendor by name
  const { data: vendors } = await supabase
    .from('vendors')
    .select('id, company_name, phone, email, gstin, pan_number, is_msme, address_line1')
    .ilike('company_name', `%${extracted.vendor_name.split(' ')[0]}%`)
    .limit(5);

  if (!vendors || vendors.length === 0) return [];

  // Find best match
  const target = extracted.vendor_name.toLowerCase();
  const match = vendors.find((v) => {
    const vName = (v.company_name || '').toLowerCase();
    return vName.includes(target) || target.includes(vName) ||
      vName.split(' ')[0] === target.split(' ')[0];
  }) ?? vendors[0];

  const vendorUpdates: Record<string, any> = {};
  if (extracted.vendor_gstin && !match.gstin) {
    vendorUpdates.gstin = extracted.vendor_gstin;
    updates.push('vendor.gstin');
  }
  if (extracted.vendor_pan && !match.pan_number) {
    vendorUpdates.pan_number = extracted.vendor_pan;
    updates.push('vendor.pan');
  }
  if (extracted.vendor_phone && !match.phone) {
    vendorUpdates.phone = extracted.vendor_phone;
    updates.push('vendor.phone');
  }
  if (extracted.vendor_email && !match.email) {
    vendorUpdates.email = extracted.vendor_email;
    updates.push('vendor.email');
  }
  if (extracted.is_msme !== undefined && !match.is_msme) {
    vendorUpdates.is_msme = extracted.is_msme;
    updates.push('vendor.is_msme');
  }
  if (extracted.vendor_address && !match.address_line1) {
    vendorUpdates.address_line1 = extracted.vendor_address;
    updates.push('vendor.address');
  }

  if (Object.keys(vendorUpdates).length > 0) {
    vendorUpdates.updated_at = new Date().toISOString();
    await supabase.from('vendors').update(vendorUpdates).eq('id', match.id);
  }

  return updates;
}

// ─── Concurrency limiter ───

async function processInBatches<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, idx: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  let idx = 0;

  async function next(): Promise<void> {
    const currentIdx = idx++;
    if (currentIdx >= items.length) return;
    results[currentIdx] = await fn(items[currentIdx], currentIdx);
    return next();
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => next());
  await Promise.all(workers);
  return results;
}

// ─── Main ───

async function main() {
  const op = '[ai-extract]';
  const dry = isDryRun();
  const typeFilter = getArg('type'); // docx, pdf, pptx
  const bucketFilter = getArg('bucket');
  const limitArg = getArg('limit');
  const limit = limitArg ? parseInt(limitArg, 10) : Infinity;

  console.log(`${op} Mode: ${dry ? 'DRY RUN' : 'LIVE'}`);
  console.log(`${op} Type: ${typeFilter ?? 'all'}, Bucket: ${bucketFilter ?? 'all'}, Limit: ${limit === Infinity ? 'ALL' : limit}`);

  // ═══ Build mappings ═══
  const { data: proposals, error: propError } = await supabase
    .from('proposals')
    .select('id, lead_id, revision_number, total_after_discount, system_size_kwp, gst_supply_amount')
    .order('revision_number', { ascending: false });

  if (propError) {
    console.error(`${op} Failed to fetch proposals:`, propError.message);
  }
  console.log(`${op} Proposals fetched: ${proposals?.length ?? 0}`);

  const proposalByLeadId = new Map<string, Record<string, any>>();
  for (const p of proposals ?? []) {
    if (p.lead_id && !proposalByLeadId.has(p.lead_id)) {
      proposalByLeadId.set(p.lead_id, p);
    }
  }
  console.log(`${op} ${proposalByLeadId.size} leads with proposals`);

  // Check already-processed files
  const { data: processed } = await supabase
    .from('processing_jobs')
    .select('bucket_id, file_path, status')
    .in('status', ['completed', 'skipped']);

  const processedPaths = new Set((processed ?? []).map((p) => `${p.bucket_id}/${p.file_path}`));
  console.log(`${op} ${processedPaths.size} files already processed`);

  // ═══ Scan buckets for documents ═══
  const buckets = bucketFilter ? [bucketFilter] : ['proposal-files', 'project-files'];
  const extensions: Record<string, string[]> = {
    docx: ['.docx'],
    pdf: ['.pdf'],
    pptx: ['.pptx', '.ppt'],
  };
  const allowedExts = typeFilter
    ? (extensions[typeFilter] ?? [])
    : [...extensions.docx, ...extensions.pdf, ...extensions.pptx];

  let files: { bucket: string; path: string; ext: string; size: number; mime: string; leadId: string }[] = [];

  for (const bucket of buckets) {
    console.log(`\n${op} Scanning bucket: ${bucket}...`);

    const { data: folders } = await supabase.storage.from(bucket).list('', { limit: 2000 });
    if (!folders) continue;

    const uuidFolders = folders.filter((f) => !f.id);
    let found = 0;

    for (const folder of uuidFolders) {
      const { data: folderFiles } = await supabase.storage.from(bucket).list(folder.name, { limit: 500 });
      if (!folderFiles) continue;

      for (const f of folderFiles) {
        const ext = '.' + f.name.split('.').pop()?.toLowerCase();
        if (!allowedExts.includes(ext)) continue;

        const fullPath = `${folder.name}/${f.name}`;
        if (processedPaths.has(`${bucket}/${fullPath}`)) continue;

        const meta = f.metadata as Record<string, any> | null;
        files.push({
          bucket,
          path: fullPath,
          ext,
          size: meta?.size ?? 0,
          mime: meta?.mimetype ?? '',
          leadId: folder.name,
        });
        found++;
      }
    }
    console.log(`${op} ${found} new ${typeFilter ?? 'doc'} files in ${bucket}`);
  }

  // Apply limit
  if (files.length > limit) {
    files = files.slice(0, limit);
    console.log(`${op} Limited to first ${limit} files`);
  }

  // Summary by type
  const typeCounts = new Map<string, number>();
  for (const f of files) {
    typeCounts.set(f.ext, (typeCounts.get(f.ext) ?? 0) + 1);
  }
  console.log(`\n${op} Files to process:`);
  for (const [ext, count] of [...typeCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${ext.padEnd(8)} ${count}`);
  }

  logMigrationStart('ai-extract-pipeline', files.length);

  let stats = {
    processed: 0,
    extracted: 0,
    merged: 0,
    fieldsUpdated: 0,
    skippedNoText: 0,
    skippedNoProposal: 0,
    errors: 0,
    totalTokens: 0,
  };

  // ═══ Process files — concurrency 3 to be respectful of Claude API limits ═══
  const CONCURRENCY = 3;

  await processInBatches(files, CONCURRENCY, async (file, idx) => {
    stats.processed++;
    const fileName = file.path.split('/').pop() ?? '';
    const isProjectFiles = file.bucket === 'project-files';

    if (stats.processed % 25 === 0) {
      console.log(`${op} Progress: ${stats.processed}/${files.length} (extracted: ${stats.extracted}, tokens: ${stats.totalTokens})`);
    }

    // Download
    const { data: fileData, error: dlError } = await supabase.storage
      .from(file.bucket)
      .download(file.path);

    if (dlError || !fileData) {
      stats.errors++;
      return;
    }

    // Extract text
    let text = '';
    const buffer = Buffer.from(await fileData.arrayBuffer());

    try {
      if (file.ext === '.docx') {
        text = await extractTextFromDocx(buffer);
      } else if (file.ext === '.pdf') {
        text = await extractTextFromPdf(buffer);
      } else if (file.ext === '.pptx' || file.ext === '.ppt') {
        text = await extractTextFromPptx(buffer);
      }
    } catch (e) {
      stats.errors++;
      if (!dry) {
        await supabase.from('processing_jobs').upsert({
          bucket_id: file.bucket,
          file_path: file.path,
          file_size: file.size,
          mime_type: file.mime,
          detected_type: file.ext.replace('.', ''),
          status: 'failed',
          parse_method: `${file.ext.replace('.', '')}_text`,
          error_message: (e as Error).message.substring(0, 500),
        }, { onConflict: 'bucket_id,file_path' });
      }
      return;
    }

    if (text.length < 50) {
      stats.skippedNoText++;
      if (!dry) {
        await supabase.from('processing_jobs').upsert({
          bucket_id: file.bucket,
          file_path: file.path,
          file_size: file.size,
          mime_type: file.mime,
          detected_type: file.ext.replace('.', ''),
          status: 'skipped',
          parse_method: `${file.ext.replace('.', '')}_text`,
          error_message: `Text too short: ${text.length} chars`,
        }, { onConflict: 'bucket_id,file_path' });
      }
      return;
    }

    // Decide extraction type
    const isVendorDoc = isProjectFiles; // project-files bucket = POs, invoices
    const prompt = isVendorDoc ? VENDOR_EXTRACTION_PROMPT : PROPOSAL_EXTRACTION_PROMPT;
    const schema = isVendorDoc ? VendorDocSchema : ProposalDocSchema;

    if (dry) {
      console.log(`  ${fileName.substring(0, 50).padEnd(52)} | ${file.ext} | ${text.length} chars | ${isVendorDoc ? 'vendor' : 'proposal'}`);
      stats.extracted++;
      return;
    }

    // AI extraction
    const { parsed, tokensUsed, error: aiError } = await extractWithClaude(text, prompt, fileName);
    stats.totalTokens += tokensUsed;

    if (!parsed || aiError) {
      stats.errors++;
      await supabase.from('processing_jobs').upsert({
        bucket_id: file.bucket,
        file_path: file.path,
        file_size: file.size,
        mime_type: file.mime,
        detected_type: file.ext.replace('.', ''),
        status: 'failed',
        parse_method: 'ai_extraction',
        tokens_used: tokensUsed,
        error_message: aiError?.substring(0, 500) ?? 'No parsed data',
      }, { onConflict: 'bucket_id,file_path' });
      return;
    }

    // Validate with Zod (lenient — partial is OK)
    const validated = schema.partial().safeParse(parsed);
    if (!validated.success) {
      // Still use the raw parsed data, just log the validation issues
      console.log(`  ${op} Zod partial validation issues for ${fileName}: ${validated.error.issues.length} issues`);
    }

    const extractedData = validated.success ? validated.data : parsed;
    stats.extracted++;

    // Merge into DB
    let fieldsUpdated: string[] = [];
    if (isVendorDoc) {
      fieldsUpdated = await mergeVendorData(extractedData as VendorDoc);
    } else {
      const proposal = proposalByLeadId.get(file.leadId);
      if (!proposal) {
        stats.skippedNoProposal++;
      } else {
        fieldsUpdated = await mergeProposalData(proposal.id, file.leadId, extractedData as ProposalDoc);
      }
    }

    if (fieldsUpdated.length > 0) {
      stats.merged++;
      stats.fieldsUpdated += fieldsUpdated.length;
    }

    // Log processing job
    await supabase.from('processing_jobs').upsert({
      bucket_id: file.bucket,
      file_path: file.path,
      file_size: file.size,
      mime_type: file.mime,
      detected_type: file.ext.replace('.', ''),
      status: 'completed',
      parse_method: 'ai_extraction',
      entity_type: isVendorDoc ? 'vendor' : 'proposal',
      entity_id: isVendorDoc ? undefined : proposalByLeadId.get(file.leadId)?.id,
      extracted_data: extractedData,
      confidence_score: 0.85,
      tokens_used: tokensUsed,
      completed_at: new Date().toISOString(),
    }, { onConflict: 'bucket_id,file_path' });
  });

  // ═══ Final stats ═══
  console.log(`\n${op} Results:`);
  console.log(`  Processed:         ${stats.processed}`);
  console.log(`  Extracted:         ${stats.extracted}`);
  console.log(`  Merged to DB:      ${stats.merged}`);
  console.log(`  Fields updated:    ${stats.fieldsUpdated}`);
  console.log(`  Skip (no text):    ${stats.skippedNoText}`);
  console.log(`  Skip (no proposal):${stats.skippedNoProposal}`);
  console.log(`  Errors:            ${stats.errors}`);
  console.log(`  Total tokens:      ${stats.totalTokens}`);
  console.log(`  Est. cost:         $${((stats.totalTokens / 1_000_000) * 3).toFixed(2)}`); // ~$3/MTok for Sonnet

  logMigrationEnd('ai-extract-pipeline', {
    processed: stats.processed,
    inserted: stats.extracted,
    skipped: stats.skippedNoText + stats.skippedNoProposal,
    errors: stats.errors,
  });
}

main().catch((err) => {
  console.error('[ai-extract-pipeline] Fatal error:', err);
  process.exit(1);
});
