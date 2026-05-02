import * as dotenv from 'dotenv';
dotenv.config({ path: 'C:/Users/vivek/Projects/shiroi-erp/.env.local' });

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
);

// Sane per-kWp cost bands (rough — for filtering, not for recovery)
const RESIDENTIAL_PER_KWP_MAX = 200000;  // ₹2L/kWp residential ceiling
const COMMERCIAL_PER_KWP_MAX = 150000;   // ₹1.5L/kWp commercial ceiling

async function main() {
  console.log('=== Total proposals ===');
  const { count: total } = await supabase
    .from('proposals')
    .select('*', { count: 'estimated', head: true });
  console.log(`Total: ${total}`);

  // Pull all proposals with size + total
  const { data: all, error } = await supabase
    .from('proposals')
    .select('id, proposal_number, system_size_kwp, total_after_discount, total_before_discount, subtotal_supply, subtotal_works, status, hubspot_deal_id, lead_id, created_at, notes')
    .not('total_after_discount', 'is', null)
    .gt('total_after_discount', 0)
    .order('total_after_discount', { ascending: false });
  if (error) { console.error(error); return; }
  console.log(`Non-zero total: ${all?.length}`);

  // Classify
  let suspicious: typeof all = [];
  let normal: typeof all = [];
  for (const p of all ?? []) {
    const size = Number(p.system_size_kwp);
    const total = Number(p.total_after_discount);
    if (size <= 0) continue;
    const perKwp = total / size;
    // Use 200k/kWp as max for both — anything above is implausible
    if (perKwp > RESIDENTIAL_PER_KWP_MAX) {
      suspicious!.push(p);
    } else {
      normal!.push(p);
    }
  }

  console.log(`\nSuspicious (per-kWp > ₹2L/kWp): ${suspicious!.length}`);
  console.log(`Normal: ${normal!.length}`);

  // Bucket suspicious by severity
  const buckets = {
    'modest (₹2-5L/kWp, possibly real outlier)': 0,
    'high (₹5-50L/kWp, almost certainly wrong)': 0,
    'absurd (₹50L-1Cr/kWp, definitely wrong)': 0,
    'catastrophic (>₹1Cr/kWp, impossible)': 0,
  };
  for (const p of suspicious!) {
    const perKwp = Number(p.total_after_discount) / Number(p.system_size_kwp);
    if (perKwp < 500000) buckets['modest (₹2-5L/kWp, possibly real outlier)']++;
    else if (perKwp < 5000000) buckets['high (₹5-50L/kWp, almost certainly wrong)']++;
    else if (perKwp < 10000000) buckets['absurd (₹50L-1Cr/kWp, definitely wrong)']++;
    else buckets['catastrophic (>₹1Cr/kWp, impossible)']++;
  }
  console.log('\nSeverity buckets:');
  for (const [k, v] of Object.entries(buckets)) console.log(`  ${k}: ${v}`);

  // Check: do any have hubspot_deal_id?
  const hubCorrupted = suspicious!.filter(p => p.hubspot_deal_id);
  console.log(`\nHubSpot-migrated corrupted: ${hubCorrupted.length} of ${suspicious!.length}`);

  // Check: how many have BOM lines?
  console.log('\nFetching BOM line counts for suspicious proposals...');
  const ids = suspicious!.map(p => p.id);
  const { data: bom } = await supabase
    .from('proposal_bom_lines')
    .select('proposal_id')
    .in('proposal_id', ids.slice(0, 200));
  const bomByProp = new Map<string, number>();
  for (const r of bom ?? []) bomByProp.set(r.proposal_id, (bomByProp.get(r.proposal_id) ?? 0) + 1);
  const withBom = suspicious!.filter(p => bomByProp.has(p.id)).length;
  console.log(`Suspicious with BOM lines: ${withBom} of ${Math.min(200, suspicious!.length)}`);

  // Check: how many have storage docs (lead folder has files)?
  console.log('\n=== Catastrophic cases (top 50, > ₹1Cr/kWp) — recovery candidates ===');
  const cats = suspicious!
    .map(p => ({ ...p, perKwp: Number(p.total_after_discount) / Number(p.system_size_kwp) }))
    .filter(p => p.perKwp > 10000000)
    .sort((a, b) => b.perKwp - a.perKwp)
    .slice(0, 50);
  for (const p of cats) {
    console.log(`  ${p.proposal_number} | ${p.system_size_kwp}kWp | ₹${(Number(p.total_after_discount) / 1e7).toFixed(2)}Cr | per-kWp=₹${(p.perKwp / 1e7).toFixed(2)}Cr | hubspot=${!!p.hubspot_deal_id} | created=${p.created_at?.slice(0, 10)}`);
  }

  // Check: of the top 50 catastrophic, how many have files in storage?
  console.log('\n=== Storage check for top 20 catastrophic ===');
  for (const p of cats.slice(0, 20)) {
    const { data: files } = await supabase.storage.from('proposal-files').list(p.lead_id, { limit: 50 });
    const fileNames = (files ?? []).map(f => f.name).join(', ').slice(0, 200);
    console.log(`  ${p.proposal_number}: ${fileNames || '(no files)'}`);
  }

  // Check: number of proposals with lead.estimated_size_kwp matching this proposal
  console.log('\n=== Cross-check with lead.estimated_size_kwp ===');
  let leadSizeMatches = 0;
  let leadSizeMismatches = 0;
  for (const p of suspicious!.slice(0, 50)) {
    const { data: lead } = await supabase
      .from('leads')
      .select('estimated_size_kwp, customer_name')
      .eq('id', p.lead_id)
      .single();
    if (!lead) continue;
    const propSize = Number(p.system_size_kwp);
    const leadSize = Number(lead.estimated_size_kwp);
    if (Math.abs(propSize - leadSize) / Math.max(propSize, leadSize) < 0.2) leadSizeMatches++;
    else leadSizeMismatches++;
  }
  console.log(`Lead size matches proposal size (within 20%): ${leadSizeMatches}/50`);
  console.log(`Lead size mismatches: ${leadSizeMismatches}/50`);
}

main().catch(e => { console.error(e); process.exit(1); });
