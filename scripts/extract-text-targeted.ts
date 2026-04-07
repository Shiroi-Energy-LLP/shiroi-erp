/**
 * Targeted text extraction: download docs for ALL leads that have files in storage.
 * Extracts text from Word docs (preferred) or PDFs (if no Word doc).
 * Uses only the LATEST revision, skips earlier ones.
 * Outputs JSON for Claude Code to analyze and fill.
 *
 * Usage:
 *   npx tsx scripts/extract-text-targeted.ts --offset=0 --batch=20
 */

import { createClient } from '@supabase/supabase-js';
import mammoth from 'mammoth';
import * as pdfParse from 'pdf-parse';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  dotenv.config({ path: 'C:/Users/vivek/Projects/shiroi-erp/.env.local' });
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
);

function getArg(name: string): string | undefined {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.split('=')[1] : undefined;
}

function getBaseName(filename: string): string {
  // Strip extension and revision suffix to get base name for dedup
  return filename
    .replace(/\.(docx|pdf|pptx?)$/i, '')
    .replace(/_?Rev_?\d+/i, '')
    .trim()
    .toLowerCase();
}

function getRevisionNumber(filename: string): number {
  const match = filename.match(/Rev_?(\d+)/i);
  return match ? parseInt(match[1]) : 0;
}

async function main() {
  const offset = parseInt(getArg('offset') ?? '0', 10);
  const batch = parseInt(getArg('batch') ?? '20', 10);

  // Get ALL leads (not just ones with gaps — user wants full tabulation)
  const { data: allLeads } = await supabase
    .from('leads')
    .select('id, customer_name, phone, email, address_line1, city, state, pincode, estimated_size_kwp, electricity_bill_number, source, status')
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  const leadById = new Map<string, Record<string, any>>();
  for (const l of allLeads ?? []) {
    leadById.set(l.id, l);
  }

  // Get proposals for context
  const { data: allProposals } = await supabase
    .from('proposals')
    .select('id, lead_id, revision_number, total_after_discount, system_size_kwp, proposal_date')
    .not('lead_id', 'is', null)
    .order('revision_number', { ascending: false });

  const proposalByLeadId = new Map<string, Record<string, any>>();
  for (const p of allProposals ?? []) {
    if (p.lead_id && !proposalByLeadId.has(p.lead_id)) {
      proposalByLeadId.set(p.lead_id, p);
    }
  }

  // Check already processed
  const { data: processed } = await supabase
    .from('processing_jobs')
    .select('file_path')
    .eq('parse_method', 'ai_extraction')
    .in('status', ['completed']);

  const processedPaths = new Set((processed ?? []).map(p => p.file_path));

  // Scan ALL lead folders in proposal-files bucket
  const { data: folders } = await supabase.storage
    .from('proposal-files')
    .list('', { limit: 2000 });

  if (!folders) {
    console.error('[targeted] No folders found in proposal-files bucket');
    return;
  }

  const leadFolders = folders
    .filter(f => !f.id) // Folders have id=null
    .map(f => f.name)
    .filter(name => leadById.has(name)); // Only folders that match a lead

  console.error(`[targeted] ${leadFolders.length} lead folders in storage`);
  console.error(`[targeted] ${allLeads?.length ?? 0} total active leads`);

  // Apply offset + batch to lead folders
  const targetLeadArray = leadFolders.slice(offset, offset + batch);
  console.error(`[targeted] Processing leads ${offset} to ${offset + batch} (${targetLeadArray.length} leads)`);

  const results: any[] = [];

  for (let i = 0; i < targetLeadArray.length; i++) {
    const leadId = targetLeadArray[i];
    const lead = leadById.get(leadId);
    const proposal = proposalByLeadId.get(leadId);

    // List all files for this lead
    const { data: files } = await supabase.storage
      .from('proposal-files')
      .list(leadId, { limit: 100 });

    if (!files || files.length === 0) continue;

    // Separate docx and pdf files
    const docxFiles = files.filter(f => f.name.toLowerCase().endsWith('.docx'));
    const pdfFiles = files.filter(f => f.name.toLowerCase().endsWith('.pdf'));

    // Build a set of Word doc base names (for dedup — skip PDF if Word exists with same name)
    const docxBaseNames = new Set(docxFiles.map(f => getBaseName(f.name)));

    // Filter PDFs: skip if a Word doc with the same base name exists
    const uniquePdfs = pdfFiles.filter(f => !docxBaseNames.has(getBaseName(f.name)));

    // Combine: prefer Word docs, add unique PDFs
    let candidates = [
      ...docxFiles.map(f => ({ ...f, ext: 'docx' as const })),
      ...uniquePdfs.map(f => ({ ...f, ext: 'pdf' as const })),
    ];

    // Group by base name, pick latest revision only
    const byBaseName = new Map<string, typeof candidates[0]>();
    for (const f of candidates) {
      const base = getBaseName(f.name);
      const rev = getRevisionNumber(f.name);
      const existing = byBaseName.get(base);
      if (!existing || getRevisionNumber(existing.name) < rev) {
        byBaseName.set(base, f);
      }
    }

    // Take the single best file (latest revision of any)
    const finalCandidates = [...byBaseName.values()]
      .filter(f => !processedPaths.has(`${leadId}/${f.name}`))
      .sort((a, b) => getRevisionNumber(b.name) - getRevisionNumber(a.name));

    if (finalCandidates.length === 0) continue;

    // Download only the best candidate (latest revision)
    const targetFile = finalCandidates[0];
    const filePath = `${leadId}/${targetFile.name}`;
    console.error(`[targeted] ${i + 1}/${targetLeadArray.length}: ${targetFile.name} [${targetFile.ext}] (lead: ${lead?.customer_name ?? leadId.substring(0, 8)})`);

    const { data: fileData, error: dlError } = await supabase.storage
      .from('proposal-files')
      .download(filePath);

    if (dlError || !fileData) {
      results.push({ leadId, fileName: targetFile.name, error: 'download_failed' });
      continue;
    }

    let text = '';
    try {
      const buffer = Buffer.from(await fileData.arrayBuffer());
      if (targetFile.ext === 'docx') {
        const result = await mammoth.extractRawText({ buffer });
        text = result.value.trim();
      } else if (targetFile.ext === 'pdf') {
        const result = await (pdfParse as any).default(buffer);
        text = (result.text || '').trim();
      }
    } catch (e) {
      results.push({ leadId, fileName: targetFile.name, error: 'parse_failed', errorMsg: (e as Error).message.substring(0, 200) });
      continue;
    }

    if (text.length < 100) {
      results.push({ leadId, fileName: targetFile.name, error: 'text_too_short', textLength: text.length });
      continue;
    }

    results.push({
      leadId,
      fileName: targetFile.name,
      filePath,
      fileType: targetFile.ext,
      proposalId: proposal?.id,
      proposalDate: proposal?.proposal_date,
      leadName: lead?.customer_name,
      leadStatus: lead?.status,
      existingEmail: lead?.email,
      existingAddress: lead?.address_line1,
      existingCity: lead?.city,
      existingState: lead?.state,
      existingPincode: lead?.pincode,
      existingSize: lead?.estimated_size_kwp || proposal?.system_size_kwp,
      existingTotal: proposal?.total_after_discount,
      existingBillNumber: lead?.electricity_bill_number,
      existingPhone: lead?.phone,
      textLength: text.length,
      text: text.substring(0, 12000),
    });
  }

  const output = {
    files: results,
    summary: {
      total: targetLeadArray.length,
      extracted: results.filter(r => r.text).length,
      errors: results.filter(r => r.error).length,
      offset,
      batch,
      totalLeadFolders: leadFolders.length,
    },
  };

  const outPath = path.resolve(__dirname, 'data/extracted-text-batch.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.error(`[targeted] Written ${results.length} results to ${outPath}`);
}

main().catch(err => {
  console.error('[targeted] Fatal:', err);
  process.exit(1);
});
