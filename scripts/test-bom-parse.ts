import * as dotenv from 'dotenv';
dotenv.config({ path: 'C:/Users/vivek/Projects/shiroi-erp/.env.local' });

import { createClient } from '@supabase/supabase-js';
import { parseCostingSheet } from './excel-parser';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!);

async function testFile(leadId: string, label: string) {
  const { data: files } = await supabase.storage.from('proposal-files').list(leadId, { limit: 50 });
  const xlsx = (files ?? []).filter(f => f.name.toLowerCase().endsWith('.xlsx'));
  if (xlsx.length === 0) { console.log(`  ${label}: no xlsx files`); return; }

  for (const f of xlsx.slice(0, 2)) {
    const { data } = await supabase.storage.from('proposal-files').download(`${leadId}/${f.name}`);
    if (!data) continue;
    const buf = Buffer.from(await data.arrayBuffer());
    const result = await parseCostingSheet(buf);
    console.log(`  ${label} [${f.name}]: ${result.bom_lines.length} lines, size=${result.system_size_kwp}kWp`);
    if (result.bom_lines.length > 0) {
      for (const line of result.bom_lines.slice(0, 3)) {
        console.log(`    ${line.item_category}: ${line.item_description} | qty=${line.quantity} ${line.unit} | rate=${line.unit_price} | total=${line.total_price}`);
      }
    }
  }
}

async function main() {
  // Test specific cases
  await testFile('d2b29fe0-b8ca-4b8f-b2e3-e29366aacb42', 'Sagas');

  // Find a few more projects without BOM
  const { data: projects } = await supabase.from('projects').select('id, lead_id').not('proposal_id', 'is', null);
  const { data: bomP } = await supabase.from('proposal_bom_lines').select('proposal_id').limit(5000);
  const bomIds = new Set((bomP ?? []).map(b => b.proposal_id));

  const { data: allProposals } = await supabase.from('proposals').select('id, lead_id').not('lead_id', 'is', null);
  const propByLead = new Map((allProposals ?? []).map(p => [p.lead_id, p.id]));

  const noBom = (projects ?? []).filter(p => {
    const propId = propByLead.get(p.lead_id);
    return propId && !bomIds.has(propId);
  });

  console.log(`\nProjects without BOM: ${noBom.length}`);

  // Test 5 random ones
  const { data: leads } = await supabase.from('leads').select('id, customer_name').in('id', noBom.slice(0, 10).map(p => p.lead_id));
  for (const l of (leads ?? []).slice(0, 5)) {
    await testFile(l.id, l.customer_name);
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
