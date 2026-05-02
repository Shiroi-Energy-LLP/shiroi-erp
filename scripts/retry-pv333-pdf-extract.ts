/**
 * One-off: re-extract PV333/24 (Mr. Lakshman) from its PDF using pdf-parse v2.
 * The original Tier B AI re-extraction pass on 2026-04-30 hit the v1 import
 * bug; with the v2 class-based API now in place, retry just this one.
 *
 * Does NOT mutate the DB on its own. Prints the extracted text + a candidate
 * (kWp, total) so we can decide.
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: 'C:/Users/vivek/Projects/shiroi-erp/.env.local' });

import { createClient } from '@supabase/supabase-js';
import { PDFParse } from 'pdf-parse';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
);

const PROPOSAL_ID = 'b658402c-1dae-43a6-a6bd-1c5a2cc60132'; // PV333/24

async function main() {
  // Look up proposal + lead
  const { data: prop } = await supabase
    .from('proposals')
    .select('id, proposal_number, lead_id, system_size_kwp, total_after_discount')
    .eq('id', PROPOSAL_ID)
    .single();
  if (!prop) { console.error('proposal not found'); process.exit(1); }
  console.log(`Proposal: ${prop.proposal_number} | size ${prop.system_size_kwp} kWp | total ₹${Number(prop.total_after_discount).toLocaleString('en-IN')}`);

  const { data: files } = await supabase.storage
    .from('proposal-files')
    .list(prop.lead_id, { limit: 100 });
  const pdf = files?.find(f => /Mr\._Lakshman.*quote\.pdf$/i.test(f.name));
  if (!pdf) {
    console.log('PDFs in folder:');
    for (const f of files ?? []) console.log(`  - ${f.name}`);
    console.error('PV333 PDF not found');
    process.exit(1);
  }

  const filePath = `${prop.lead_id}/${pdf.name}`;
  console.log(`Downloading: ${filePath}`);
  const { data: blob, error: dlErr } = await supabase.storage
    .from('proposal-files')
    .download(filePath);
  if (dlErr || !blob) { console.error(`download error: ${dlErr?.message}`); process.exit(1); }

  const buffer = Buffer.from(await blob.arrayBuffer());
  console.log(`Buffer size: ${buffer.length} bytes`);

  const parser = new PDFParse({ data: buffer });
  let text = '';
  try {
    const result = await parser.getText();
    text = (result.text ?? '').trim();
  } finally {
    await parser.destroy();
  }

  console.log(`Extracted text length: ${text.length}`);
  console.log('━━━━━━━━━━ FULL TEXT ━━━━━━━━━━');
  console.log(text);
  console.log('━━━━━━━━━━ END FULL TEXT ━━━━━━━━━━');
}

main().catch(e => { console.error(e); process.exit(1); });
