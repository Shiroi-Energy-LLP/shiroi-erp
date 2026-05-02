import * as dotenv from 'dotenv';
dotenv.config({ path: 'C:/Users/vivek/Projects/shiroi-erp/.env.local' });

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
);

async function dumpBom(propNum: string) {
  const { data: prop } = await supabase
    .from('proposals')
    .select('id, system_size_kwp, total_after_discount, lead_id')
    .eq('proposal_number', propNum)
    .single();
  if (!prop) { console.log(`No proposal ${propNum}`); return; }

  const { data: lines } = await supabase
    .from('proposal_bom_lines')
    .select('line_number, item_category, item_description, quantity, unit, unit_price, total_price, gst_rate')
    .eq('proposal_id', prop.id)
    .order('line_number');

  console.log(`\n=== ${propNum} | size=${prop.system_size_kwp} kWp | total=₹${(Number(prop.total_after_discount) / 1e7).toFixed(2)} Cr ===`);
  console.log(`BOM lines: ${lines?.length ?? 0}`);

  // Group by description+unit_price to see duplicates
  const grouped = new Map<string, { count: number; qty: number; unit_price: number; total_price: number; description: string; unit: string; line_numbers: number[] }>();
  for (const l of lines ?? []) {
    const key = `${l.item_description}|${l.unit_price}|${l.unit}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.count++;
      existing.qty += Number(l.quantity);
      existing.total_price += Number(l.total_price);
      existing.line_numbers.push(l.line_number);
    } else {
      grouped.set(key, {
        count: 1,
        qty: Number(l.quantity),
        unit_price: Number(l.unit_price),
        total_price: Number(l.total_price),
        description: l.item_description.slice(0, 80),
        unit: l.unit,
        line_numbers: [l.line_number],
      });
    }
  }
  console.log(`Unique (description, unit_price): ${grouped.size}`);
  console.log(`Top 10 grouped lines (by total contribution):`);
  const sortedG = [...grouped.values()].sort((a, b) => b.total_price - a.total_price).slice(0, 10);
  for (const g of sortedG) {
    console.log(`  x${g.count} | ${g.description} | qty=${g.qty.toLocaleString('en-IN')} ${g.unit} | unit=₹${g.unit_price} | total=₹${g.total_price.toLocaleString('en-IN')} | lines=[${g.line_numbers.slice(0, 5).join(',')}${g.line_numbers.length > 5 ? '...' : ''}]`);
  }

  // Check storage files attached to lead
  const { data: files } = await supabase.storage.from('proposal-files').list(prop.lead_id, { limit: 100 });
  console.log(`Files in lead folder (${prop.lead_id}):`);
  for (const f of files ?? []) {
    console.log(`  - ${f.name}`);
  }
}

async function checkPriceBook() {
  console.log('\n=== Price book check ===');
  // Look for proposals that have unusually high BOM line counts (price book got attached)
  const { data: counts } = await supabase.rpc('proposal_bom_counts').catch(() => ({ data: null }));
  if (!counts) {
    // Manual: query top 20 by line count
    const { data: allBom } = await supabase
      .from('proposal_bom_lines')
      .select('proposal_id')
      .limit(100000);
    const counts2 = new Map<string, number>();
    for (const r of allBom ?? []) {
      counts2.set(r.proposal_id, (counts2.get(r.proposal_id) ?? 0) + 1);
    }
    const sorted = [...counts2.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
    for (const [pid, n] of sorted) {
      const { data: p } = await supabase
        .from('proposals')
        .select('proposal_number, system_size_kwp, total_after_discount')
        .eq('id', pid)
        .single();
      console.log(`  ${p?.proposal_number} | size=${p?.system_size_kwp}kWp | total=₹${(Number(p?.total_after_discount ?? 0) / 1e5).toFixed(0)}L | bom_lines=${n}`);
    }
  }
}

async function checkRecentPriceBookImports() {
  console.log('\n=== check for price-book import scripts ===');
  // Look at when BOM lines were created
  const { data: bomTimes } = await supabase
    .from('proposal_bom_lines')
    .select('created_at')
    .order('created_at', { ascending: false })
    .limit(5);
  console.log('Latest BOM line created_at:');
  for (const r of bomTimes ?? []) console.log(`  ${r.created_at}`);

  const { data: bomEarly } = await supabase
    .from('proposal_bom_lines')
    .select('created_at')
    .order('created_at', { ascending: true })
    .limit(5);
  console.log('Earliest BOM line created_at:');
  for (const r of bomEarly ?? []) console.log(`  ${r.created_at}`);
}

async function main() {
  await dumpBom('PV306/24-25');
  await dumpBom('PV147/25-26');
  await dumpBom('SE/PV/069/22-23');
  await checkPriceBook();
  await checkRecentPriceBookImports();

  // Sample a sane proposal for comparison
  console.log('\n=== Sane sample (median total) ===');
  const { data: sane } = await supabase
    .from('proposals')
    .select('id, proposal_number, system_size_kwp, total_after_discount')
    .gt('total_after_discount', 200000)
    .lt('total_after_discount', 1000000)
    .limit(3);
  for (const s of sane ?? []) {
    await dumpBom(s.proposal_number);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
