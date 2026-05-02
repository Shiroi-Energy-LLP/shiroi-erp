/**
 * Verification pass for the recovery plan.
 *
 * For each suspicious proposal:
 *   1. Classify kWp confidence (matches lead.estimated_size_kwp within 20%, has project record, has filename match).
 *   2. Apply Vivek's threshold rule: confident kWp → ₹2L/kWp, doubtful → ₹5L/kWp.
 *   3. Skip HubSpot-migrated (Tier D — re-import workflow).
 *   4. For the survivors (potential Tier B), gather automated verification signals:
 *      - project.contracted_value (if accepted)
 *      - sum of payments (truth signal)
 *      - sister proposal revisions with sane totals
 *      - storage has a customer-name + kWp-matching docx/pdf
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: 'C:/Users/vivek/Projects/shiroi-erp/.env.local' });

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
);

interface Suspect {
  id: string;
  proposal_number: string;
  system_size_kwp: number;
  total_after_discount: number;
  per_kwp: number;
  status: string;
  hubspot_deal_id: string | null;
  lead_id: string;
  created_at: string;
}

interface Verdict {
  prop: Suspect;
  lead_size: number | null;
  lead_name: string | null;
  kwp_confident: boolean;
  threshold: number;
  in_tier_a: boolean;
  // Tier B signals
  project_contracted_value: number | null;
  payments_sum: number | null;
  sister_sane_total: number | null;
  has_clean_doc: boolean;
}

const TIER_A_CONFIDENT = 200_000;   // ₹2L/kWp when kWp is confident
const TIER_A_DOUBTFUL = 500_000;    // ₹5L/kWp when kWp is doubtful
const TIER_B_FLOOR = 200_000;       // ₹2L/kWp lower bound for Tier B candidates

async function main() {
  console.log('=== Loading suspicious proposals ===');
  const { data: all } = await supabase
    .from('proposals')
    .select('id, proposal_number, system_size_kwp, total_after_discount, status, hubspot_deal_id, lead_id, created_at')
    .gt('total_after_discount', 0);

  const suspects: Suspect[] = [];
  for (const p of all ?? []) {
    const size = Number(p.system_size_kwp);
    const total = Number(p.total_after_discount);
    if (size <= 0) continue;
    const perKwp = total / size;
    if (perKwp >= TIER_B_FLOOR) {
      suspects.push({
        id: p.id,
        proposal_number: p.proposal_number,
        system_size_kwp: size,
        total_after_discount: total,
        per_kwp: perKwp,
        status: p.status,
        hubspot_deal_id: p.hubspot_deal_id,
        lead_id: p.lead_id,
        created_at: p.created_at ?? '',
      });
    }
  }
  console.log(`Suspicious (≥₹2L/kWp): ${suspects.length}`);

  // Bulk-load lead info
  const leadIds = [...new Set(suspects.map(s => s.lead_id))];
  const { data: leads } = await supabase
    .from('leads')
    .select('id, customer_name, estimated_size_kwp')
    .in('id', leadIds);
  const leadMap = new Map((leads ?? []).map(l => [l.id, l]));

  // Bulk-load projects (for accepted proposals)
  const propIds = suspects.map(s => s.id);
  const { data: projects } = await supabase
    .from('projects')
    .select('proposal_id, contracted_value, status, system_size_kwp')
    .in('proposal_id', propIds);
  const projectByProposal = new Map((projects ?? []).map(p => [p.proposal_id, p]));

  // Bulk-load payments
  const projectIds = (projects ?? []).map(p => (p as any).id).filter(Boolean);
  // Skip — projects table doesn't expose id in our select; query separately
  const paymentSums = new Map<string, number>();
  if (projects && projects.length > 0) {
    const { data: projWithIds } = await supabase
      .from('projects')
      .select('id, proposal_id')
      .in('proposal_id', propIds);
    const projIdToProp = new Map((projWithIds ?? []).map(p => [p.id, p.proposal_id]));
    if (projWithIds && projWithIds.length > 0) {
      const { data: payments } = await supabase
        .from('payments')
        .select('project_id, amount')
        .in('project_id', projWithIds.map(p => p.id));
      for (const pay of payments ?? []) {
        const propId = projIdToProp.get(pay.project_id);
        if (!propId) continue;
        paymentSums.set(propId, (paymentSums.get(propId) ?? 0) + Number(pay.amount));
      }
    }
  }

  // Bulk-load sister proposals (other revisions for same lead)
  const { data: sisters } = await supabase
    .from('proposals')
    .select('id, lead_id, system_size_kwp, total_after_discount, revision_number, status')
    .in('lead_id', leadIds);
  const sistersByLead = new Map<string, typeof sisters>();
  for (const s of sisters ?? []) {
    const list = sistersByLead.get(s.lead_id) ?? [];
    list.push(s);
    sistersByLead.set(s.lead_id, list);
  }

  // Storage scan — limit to top suspects, expensive
  // Build verdicts
  const verdicts: Verdict[] = [];
  for (const s of suspects) {
    const lead = leadMap.get(s.lead_id);
    const leadSize = lead?.estimated_size_kwp ? Number(lead.estimated_size_kwp) : null;

    // kWp confidence: lead size matches proposal size within 20%
    let kwpConfident = false;
    if (leadSize && leadSize > 0) {
      const diff = Math.abs(s.system_size_kwp - leadSize) / Math.max(s.system_size_kwp, leadSize);
      if (diff < 0.2) kwpConfident = true;
    }
    // Bonus: a project record exists with same kWp
    const project = projectByProposal.get(s.id);
    if (project && Number(project.system_size_kwp) > 0) {
      const projSize = Number(project.system_size_kwp);
      const diff = Math.abs(s.system_size_kwp - projSize) / Math.max(s.system_size_kwp, projSize);
      if (diff < 0.2) kwpConfident = true;
    }

    const threshold = kwpConfident ? TIER_A_CONFIDENT : TIER_A_DOUBTFUL;
    const inTierA = s.per_kwp > threshold && !s.hubspot_deal_id;

    // Tier B signals: payments, sister, project value
    const projectContracted = project ? Number(project.contracted_value ?? 0) : null;
    const paymentsSum = paymentSums.get(s.id) ?? null;
    // Sister sane = a different proposal for the same lead with per-kWp ≤ ₹2L
    const sisters = sistersByLead.get(s.lead_id) ?? [];
    let sisterSaneTotal: number | null = null;
    for (const sis of sisters!) {
      if (sis.id === s.id) continue;
      const sisSize = Number(sis.system_size_kwp);
      const sisTotal = Number(sis.total_after_discount);
      if (sisSize > 0 && sisTotal > 0 && sisTotal / sisSize < TIER_B_FLOOR) {
        if (sisterSaneTotal === null || sisTotal > sisterSaneTotal) sisterSaneTotal = sisTotal;
      }
    }

    verdicts.push({
      prop: s,
      lead_size: leadSize,
      lead_name: lead?.customer_name ?? null,
      kwp_confident: kwpConfident,
      threshold,
      in_tier_a: inTierA,
      project_contracted_value: projectContracted,
      payments_sum: paymentsSum,
      sister_sane_total: sisterSaneTotal,
      has_clean_doc: false, // filled below
    });
  }

  // Print Tier A scope under new rules
  const tierA = verdicts.filter(v => v.in_tier_a);
  const tierAConfident = tierA.filter(v => v.kwp_confident);
  const tierADoubtful = tierA.filter(v => !v.kwp_confident);
  console.log(`\n=== Tier A scope (excluding HubSpot) ===`);
  console.log(`Total Tier A: ${tierA.length}`);
  console.log(`  kWp-confident (₹2L/kWp threshold): ${tierAConfident.length}`);
  console.log(`  kWp-doubtful (₹5L/kWp threshold): ${tierADoubtful.length}`);

  // HubSpot subset (Tier D — re-import workflow)
  const hubspotCorrupted = verdicts.filter(v => v.prop.hubspot_deal_id);
  console.log(`\n=== Tier D — HubSpot-migrated suspects (re-import) ===`);
  console.log(`Total: ${hubspotCorrupted.length}`);

  // Tier B candidates: not in Tier A, not HubSpot, ≥₹2L/kWp
  const tierBCandidates = verdicts.filter(v => !v.in_tier_a && !v.prop.hubspot_deal_id);
  console.log(`\n=== Tier B candidates (≥₹2L/kWp, kept by threshold rule, non-HubSpot) ===`);
  console.log(`Total: ${tierBCandidates.length}`);

  // For Tier B candidates, count which have automated verification signals
  const withProject = tierBCandidates.filter(v => v.project_contracted_value !== null && v.project_contracted_value > 0);
  const withPayments = tierBCandidates.filter(v => v.payments_sum !== null && v.payments_sum > 0);
  const withSister = tierBCandidates.filter(v => v.sister_sane_total !== null);
  console.log(`  Have project.contracted_value: ${withProject.length}`);
  console.log(`  Have payments: ${withPayments.length}`);
  console.log(`  Have sane sister revision: ${withSister.length}`);
  const noSignal = tierBCandidates.filter(v =>
    !(v.project_contracted_value && v.project_contracted_value > 0) &&
    !(v.payments_sum && v.payments_sum > 0) &&
    !(v.sister_sane_total)
  );
  console.log(`  Have NO automated signal (true manual): ${noSignal.length}`);

  // Show Tier A doubtful list — these have shaky kWp, threshold is ₹5L/kWp.
  // Important for Vivek to skim to confirm the threshold is right.
  console.log(`\n=== Tier A doubtful list (kWp uncertain, total/kWp > ₹5L) ===`);
  for (const v of tierADoubtful.sort((a, b) => b.prop.per_kwp - a.prop.per_kwp).slice(0, 50)) {
    console.log(`  ${v.prop.proposal_number} | size=${v.prop.system_size_kwp}kWp | lead-size=${v.lead_size ?? 'null'}kWp | total=₹${(v.prop.total_after_discount / 1e7).toFixed(2)}Cr | per-kWp=₹${(v.prop.per_kwp / 1e5).toFixed(1)}L | ${v.lead_name?.slice(0, 30)}`);
  }

  // Show Tier A confident list (truncated)
  console.log(`\n=== Tier A confident list (kWp matched, total/kWp > ₹2L) — sample of 20 ===`);
  for (const v of tierAConfident.sort((a, b) => b.prop.per_kwp - a.prop.per_kwp).slice(0, 20)) {
    console.log(`  ${v.prop.proposal_number} | size=${v.prop.system_size_kwp}kWp | lead-size=${v.lead_size}kWp | total=₹${(v.prop.total_after_discount / 1e7).toFixed(2)}Cr | per-kWp=₹${(v.prop.per_kwp / 1e5).toFixed(1)}L | ${v.lead_name?.slice(0, 30)}`);
  }

  // Tier B with payments — these are recoverable
  console.log(`\n=== Tier B candidates with payment evidence (truth signal) ===`);
  for (const v of withPayments.sort((a, b) => b.prop.per_kwp - a.prop.per_kwp).slice(0, 30)) {
    console.log(`  ${v.prop.proposal_number} | size=${v.prop.system_size_kwp}kWp | stored=₹${(v.prop.total_after_discount / 1e7).toFixed(2)}Cr | payments=₹${(v.payments_sum! / 1e5).toFixed(1)}L | proj_value=${v.project_contracted_value ? '₹' + (v.project_contracted_value / 1e5).toFixed(1) + 'L' : '-'} | ${v.lead_name?.slice(0, 30)}`);
  }

  // Tier B with sister
  console.log(`\n=== Tier B candidates with sane sister revision ===`);
  for (const v of withSister.sort((a, b) => b.prop.per_kwp - a.prop.per_kwp).slice(0, 30)) {
    console.log(`  ${v.prop.proposal_number} | size=${v.prop.system_size_kwp}kWp | stored=₹${(v.prop.total_after_discount / 1e7).toFixed(2)}Cr | sister_sane=₹${(v.sister_sane_total! / 1e5).toFixed(1)}L | ${v.lead_name?.slice(0, 30)}`);
  }

  // Tier B no signal
  console.log(`\n=== Tier B candidates with NO automated signal — true manual ===`);
  for (const v of noSignal.sort((a, b) => b.prop.per_kwp - a.prop.per_kwp).slice(0, 30)) {
    console.log(`  ${v.prop.proposal_number} | size=${v.prop.system_size_kwp}kWp | total=₹${(v.prop.total_after_discount / 1e7).toFixed(2)}Cr | per-kWp=₹${(v.prop.per_kwp / 1e5).toFixed(1)}L | ${v.lead_name?.slice(0, 30)}`);
  }

  // Save full Tier A list to file for later review
  const fs = await import('fs');
  const tierARows = tierA.map(v => ({
    proposal_number: v.prop.proposal_number,
    proposal_id: v.prop.id,
    system_size_kwp: v.prop.system_size_kwp,
    lead_size: v.lead_size,
    total_after_discount: v.prop.total_after_discount,
    per_kwp: v.prop.per_kwp,
    kwp_confident: v.kwp_confident,
    threshold_used: v.threshold,
    customer_name: v.lead_name,
    status: v.prop.status,
    hubspot_deal_id: v.prop.hubspot_deal_id,
  }));
  fs.writeFileSync(
    'C:/Users/vivek/Projects/shiroi-erp/.claude/worktrees/friendly-montalcini-e601d1/scripts/data/tier-a-targets.json',
    JSON.stringify(tierARows, null, 2),
  );
  console.log(`\nWrote ${tierARows.length} Tier A targets to scripts/data/tier-a-targets.json`);
}

main().catch(e => { console.error(e); process.exit(1); });
