/**
 * Extract text from Supabase Storage documents in batches.
 * Outputs JSON to stdout for Claude Code to analyze.
 *
 * Usage:
 *   npx tsx scripts/extract-text-batch.ts --type=docx --offset=0 --batch=10
 *   npx tsx scripts/extract-text-batch.ts --type=pdf --bucket=project-files --offset=0 --batch=10
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

async function main() {
  const typeFilter = getArg('type') ?? 'docx';
  const bucketFilter = getArg('bucket');
  const offset = parseInt(getArg('offset') ?? '0', 10);
  const batch = parseInt(getArg('batch') ?? '10', 10);

  const extensions: Record<string, string[]> = {
    docx: ['.docx'],
    pdf: ['.pdf'],
    pptx: ['.pptx', '.ppt'],
  };
  const allowedExts = extensions[typeFilter] ?? [`.${typeFilter}`];

  // Check already-processed files
  const { data: processed } = await supabase
    .from('processing_jobs')
    .select('bucket_id, file_path, status')
    .in('status', ['completed', 'skipped']);

  const processedPaths = new Set((processed ?? []).map((p) => `${p.bucket_id}/${p.file_path}`));

  // Get proposals mapping
  const { data: proposals } = await supabase
    .from('proposals')
    .select('id, lead_id, revision_number, total_after_discount, system_size_kwp, gst_supply_amount')
    .order('revision_number', { ascending: false });

  const proposalByLeadId = new Map<string, Record<string, any>>();
  for (const p of proposals ?? []) {
    if (p.lead_id && !proposalByLeadId.has(p.lead_id)) {
      proposalByLeadId.set(p.lead_id, p);
    }
  }

  // Get leads for context
  const { data: leads } = await supabase
    .from('leads')
    .select('id, customer_name, phone, email, address_line1, city, state, pincode, system_size_kwp')
    .is('deleted_at', null);

  const leadById = new Map<string, Record<string, any>>();
  for (const l of leads ?? []) {
    leadById.set(l.id, l);
  }

  // Scan buckets
  const buckets = bucketFilter ? [bucketFilter] : ['proposal-files', 'project-files'];
  let files: { bucket: string; path: string; ext: string; size: number; leadId: string }[] = [];

  for (const bucket of buckets) {
    const { data: folders } = await supabase.storage.from(bucket).list('', { limit: 2000 });
    if (!folders) continue;

    for (const folder of folders.filter((f) => !f.id)) {
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
          leadId: folder.name,
        });
      }
    }
  }

  console.error(`[extract-text] Total unprocessed ${typeFilter} files: ${files.length}`);
  console.error(`[extract-text] Processing offset=${offset}, batch=${batch}`);

  // Apply offset + batch
  files = files.slice(offset, offset + batch);

  if (files.length === 0) {
    console.error('[extract-text] No files to process');
    // Output empty JSON
    const outPath = path.resolve(__dirname, 'data/extracted-text-batch.json');
    fs.writeFileSync(outPath, JSON.stringify({ files: [], summary: { total: 0 } }, null, 2));
    console.error(`[extract-text] Written to ${outPath}`);
    return;
  }

  const results: any[] = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const fileName = file.path.split('/').pop() ?? '';
    const isProjectFiles = file.bucket === 'project-files';

    console.error(`[extract-text] ${i + 1}/${files.length}: ${fileName}`);

    // Download
    const { data: fileData, error: dlError } = await supabase.storage
      .from(file.bucket)
      .download(file.path);

    if (dlError || !fileData) {
      console.error(`  Download error: ${dlError?.message}`);
      results.push({ file: file.path, error: 'download_failed' });
      continue;
    }

    // Extract text
    let text = '';
    const buffer = Buffer.from(await fileData.arrayBuffer());

    try {
      if (file.ext === '.docx') {
        const result = await mammoth.extractRawText({ buffer });
        text = result.value.trim();
      } else if (file.ext === '.pdf') {
        const result = await (pdfParse as any).default(buffer);
        text = (result.text || '').trim();
      } else if (file.ext === '.pptx' || file.ext === '.ppt') {
        const JSZip = (await import('jszip')).default;
        const zip = await JSZip.loadAsync(buffer);
        const texts: string[] = [];
        const slideFiles = Object.keys(zip.files)
          .filter((f) => f.startsWith('ppt/slides/slide') && f.endsWith('.xml'))
          .sort();
        for (const slideFile of slideFiles) {
          const xml = await zip.files[slideFile].async('text');
          const matches = xml.match(/<a:t>([^<]*)<\/a:t>/g);
          if (matches) {
            texts.push(matches.map((m) => m.replace(/<a:t>|<\/a:t>/g, '')).join(' '));
          }
        }
        text = texts.join('\n\n').trim();
      }
    } catch (e) {
      console.error(`  Parse error: ${(e as Error).message}`);
      results.push({ file: file.path, bucket: file.bucket, error: 'parse_failed', errorMsg: (e as Error).message.substring(0, 200) });
      continue;
    }

    if (text.length < 50) {
      results.push({ file: file.path, bucket: file.bucket, error: 'text_too_short', textLength: text.length });
      continue;
    }

    // Get lead context
    const proposal = proposalByLeadId.get(file.leadId);
    const lead = leadById.get(file.leadId);

    results.push({
      file: file.path,
      fileName,
      bucket: file.bucket,
      leadId: file.leadId,
      ext: file.ext,
      size: file.size,
      textLength: text.length,
      text: text.substring(0, 12000), // Truncate for manageable size
      docType: isProjectFiles ? 'vendor' : 'proposal',
      proposalId: proposal?.id,
      leadName: lead?.customer_name,
      existingEmail: lead?.email,
      existingAddress: lead?.address_line1,
      existingSize: lead?.system_size_kwp || proposal?.system_size_kwp,
      existingTotal: proposal?.total_after_discount,
    });
  }

  const output = {
    files: results,
    summary: {
      total: files.length,
      extracted: results.filter((r) => r.text).length,
      errors: results.filter((r) => r.error).length,
      offset,
      batch,
    },
  };

  const outPath = path.resolve(__dirname, 'data/extracted-text-batch.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.error(`[extract-text] Written ${results.length} results to ${outPath}`);
}

main().catch((err) => {
  console.error('[extract-text] Fatal error:', err);
  process.exit(1);
});
