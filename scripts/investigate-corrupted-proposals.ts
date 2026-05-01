/**
 * Investigation-only script. Reads corrupted proposals + BOM data.
 * Does NOT mutate anything.
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: 'C:/Users/vivek/Projects/shiroi-erp/.env.local' });

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
);

async function main() {
  console.log('=== 1. Named corrupted proposals ===');
  const named = ['PV147/25-26', 'PV121/24', 'PV306/24-25', 'SE/PV/069/22-23', 'PV320/25'];
  const { data: namedProps } = await supabase
    .from('proposals')
    .select(
      'id, proposal_number, system_size_kwp, total_after_discount, total_before_discount, subtotal_supply, subtotal_works, gst_supply_amount, gst_works_amount, status, created_at, notes, hubspot_deal_id, lead_id'
    )
    .in('proposal_number', named);

  for (const p of namedProps ?? []) {
    console.log(`\n${p.proposal_number} | ${p.system_size_kwp} kWp | ${p.status}`);
    console.log(`  total_after_discount=${p.total_after_discount} total_before_discount=${p.total_before_discount}`);
    console.log(`  subtotal_supply=${p.subtotal_supply} subtotal_works=${p.subtotal_works}`);
    console.log(`  gst_supply=${p.gst_supply_amount} gst_works=${p.gst_works_amount}`);
    console.log(`  created_at=${p.created_at} hubspot_deal_id=${p.hubspot_deal_id ?? 'null'}`);
    console.log(`  notes=${(p.notes ?? '').slice(0, 200)}`);

    const { data: bom } = await supabase
      .from('proposal_bom_lines')
      .select('line_number, item_category, item_description, quantity, unit_price, total_price, gst_rate, gst_type')
      .eq('proposal_id', p.id)
      .order('line_number');
    console.log(`  BOM lines: ${bom?.length ?? 0}`);
    let bomTotal = 0;
    for (const l of bom ?? []) {
      bomTotal += Number(l.total_price);
    }
    console.log(`  BOM sum total_price = ${bomTotal.toLocaleString('en-IN')}`);
    if (bom && bom.length > 0) {
      console.log(`  First 3 BOM lines:`);
      for (const l of bom.slice(0, 3)) {
        console.log(`    [${l.line_number}] ${l.item_category}: ${l.item_description.slice(0, 60)} | qty=${l.quantity} unit_price=${l.unit_price} total_price=${l.total_price}`);
      }
    }

    const { data: lead } = await supabase
      .from('leads')
      .select('customer_name, segment, source, estimated_size_kwp, hubspot_deal_id, created_at')
      .eq('id', p.lead_id)
      .single();
    if (lead) console.log(`  Lead: ${lead.customer_name} | seg=${lead.segment} | src=${lead.source} | est_size=${lead.estimated_size_kwp} | hub=${lead.hubspot_deal_id ?? 'null'}`);
  }

  console.log('\n=== 2. Top 30 by total_after_discount (descending) ===');
  const { data: topProps } = await supabase
    .from('proposals')
    .select('id, proposal_number, system_size_kwp, total_after_discount, total_before_discount, status, created_at, hubspot_deal_id, notes')
    .gt('total_after_discount', 100000000) // > 10 Cr
    .order('total_after_discount', { ascending: false })
    .limit(30);

  for (const p of topProps ?? []) {
    const cr = (Number(p.total_after_discount) / 1e7).toFixed(2);
    const expected = (Number(p.system_size_kwp) * 60000).toLocaleString('en-IN');
    const isHub = !!p.hubspot_deal_id || (p.notes ?? '').includes('HubSpot');
    console.log(`  ${p.proposal_number} | ${p.system_size_kwp}kWp | ₹${cr}Cr | exp~₹${expected} | ${p.status} | hubspot=${isHub} | created=${(p.created_at ?? '').slice(0, 10)}`);
  }

  console.log('\n=== 3. Distribution: total_after_discount thresholds ===');
  const buckets = [
    { name: '> 1 Cr', min: 1e7 },
    { name: '> 10 Cr', min: 1e8 },
    { name: '> 100 Cr', min: 1e9 },
    { name: '> 1000 Cr', min: 1e10 },
    { name: '> 10000 Cr', min: 1e11 },
  ];
  for (const b of buckets) {
    const { count } = await supabase
      .from('proposals')
      .select('*', { count: 'estimated', head: true })
      .gt('total_after_discount', b.min);
    console.log(`  ${b.name}: ${count}`);
  }

  console.log('\n=== 4. Hubspot migration breakdown (hubspot_deal_id IS NOT NULL) ===');
  const { count: hubAll } = await supabase
    .from('proposals')
    .select('*', { count: 'estimated', head: true })
    .not('hubspot_deal_id', 'is', null);
  const { count: hubBad } = await supabase
    .from('proposals')
    .select('*', { count: 'estimated', head: true })
    .not('hubspot_deal_id', 'is', null)
    .gt('total_after_discount', 1e8);
  console.log(`  Total HubSpot-migrated proposals: ${hubAll}`);
  console.log(`  HubSpot proposals with total > 10 Cr: ${hubBad}`);

  console.log('\n=== 5. NON-Hubspot proposals with corruption ===');
  const { data: nonHub } = await supabase
    .from('proposals')
    .select('proposal_number, system_size_kwp, total_after_discount, status, created_at, notes')
    .is('hubspot_deal_id', null)
    .gt('total_after_discount', 1e8)
    .order('total_after_discount', { ascending: false })
    .limit(20);
  for (const p of nonHub ?? []) {
    const notesPrefix = (p.notes ?? '').slice(0, 80);
    console.log(`  ${p.proposal_number} | ${p.system_size_kwp}kWp | ₹${(Number(p.total_after_discount) / 1e7).toFixed(2)}Cr | ${(p.created_at ?? '').slice(0,10)} | ${notesPrefix}`);
  }

  console.log('\n=== 6. Proposals with BOM lines: total vs BOM sum ===');
  // Sample 10 corrupted + 10 sane to compare
  const { data: sample } = await supabase
    .from('proposals')
    .select('id, proposal_number, system_size_kwp, total_after_discount')
    .gt('total_after_discount', 1e8)
    .order('total_after_discount', { ascending: false })
    .limit(15);
  for (const p of sample ?? []) {
    const { data: bom } = await supabase
      .from('proposal_bom_lines')
      .select('total_price')
      .eq('proposal_id', p.id);
    const bomSum = (bom ?? []).reduce((s, l) => s + Number(l.total_price), 0);
    const stored = Number(p.total_after_discount);
    const ratio = bomSum > 0 ? (stored / bomSum).toFixed(2) : 'no BOM';
    console.log(`  ${p.proposal_number} | ${p.system_size_kwp}kWp | stored=${stored.toLocaleString('en-IN')} | BOM=${bomSum.toLocaleString('en-IN')} (${(bom ?? []).length} lines) | ratio=${ratio}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
