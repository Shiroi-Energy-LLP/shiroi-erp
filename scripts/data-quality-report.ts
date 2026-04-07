/**
 * Phase 7: Data Quality Report — Before/After Metrics
 *
 * Generates a comprehensive report of data quality across all entities.
 * Run this after all extraction phases to measure improvement.
 *
 * Usage:
 *   npx tsx scripts/data-quality-report.ts
 */

import { createClient } from '@supabase/supabase-js';
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

function pct(n: number, total: number): string {
  if (total === 0) return '0%';
  return `${Math.round((n / total) * 100)}%`;
}

function formatINR(amount: number): string {
  if (amount >= 10_000_000) return `₹${(amount / 10_000_000).toFixed(1)}Cr`;
  if (amount >= 100_000) return `₹${(amount / 100_000).toFixed(1)}L`;
  if (amount >= 1_000) return `₹${(amount / 1_000).toFixed(0)}K`;
  return `₹${amount}`;
}

async function main() {
  const op = '[data-quality]';

  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  SHIROI ERP — Data Quality Report`);
  console.log(`  Generated: ${new Date().toISOString()}`);
  console.log(`${'═'.repeat(70)}\n`);

  // ═══ LEADS ═══
  const { count: totalLeads } = await supabase.from('leads').select('*', { count: 'exact', head: true }).is('deleted_at', null);
  const { count: leadsWithEmail } = await supabase.from('leads').select('*', { count: 'exact', head: true }).is('deleted_at', null).neq('email', '').not('email', 'is', null);
  const { count: leadsWithPhone } = await supabase.from('leads').select('*', { count: 'exact', head: true }).is('deleted_at', null).not('phone', 'is', null);
  const { count: leadsWithOwner } = await supabase.from('leads').select('*', { count: 'exact', head: true }).is('deleted_at', null).not('assigned_to', 'is', null);
  const { count: leadsWithCloseDate } = await supabase.from('leads').select('*', { count: 'exact', head: true }).is('deleted_at', null).not('expected_close_date', 'is', null);
  const { count: leadsWithSize } = await supabase.from('leads').select('*', { count: 'exact', head: true }).is('deleted_at', null).not('system_size_kwp', 'is', null).gt('system_size_kwp', 0);
  const { count: leadsWithAddress } = await supabase.from('leads').select('*', { count: 'exact', head: true }).is('deleted_at', null).not('address_line1', 'is', null).neq('address_line1', '');

  console.log(`LEADS (${totalLeads} total, excluding deleted)`);
  console.log(`  Email:            ${leadsWithEmail} (${pct(leadsWithEmail!, totalLeads!)})`);
  console.log(`  Phone:            ${leadsWithPhone} (${pct(leadsWithPhone!, totalLeads!)})`);
  console.log(`  Owner:            ${leadsWithOwner} (${pct(leadsWithOwner!, totalLeads!)})`);
  console.log(`  Close date:       ${leadsWithCloseDate} (${pct(leadsWithCloseDate!, totalLeads!)})`);
  console.log(`  System size:      ${leadsWithSize} (${pct(leadsWithSize!, totalLeads!)})`);
  console.log(`  Address:          ${leadsWithAddress} (${pct(leadsWithAddress!, totalLeads!)})`);

  // ═══ CONTACTS ═══
  const { count: totalContacts } = await supabase.from('contacts').select('*', { count: 'exact', head: true });
  const { count: contactsWithEmail } = await supabase.from('contacts').select('*', { count: 'exact', head: true }).not('email', 'is', null).neq('email', '');
  const { count: contactsWithLastName } = await supabase.from('contacts').select('*', { count: 'exact', head: true }).not('last_name', 'is', null).neq('last_name', '');

  console.log(`\nCONTACTS (${totalContacts} total)`);
  console.log(`  Email:            ${contactsWithEmail} (${pct(contactsWithEmail!, totalContacts!)})`);
  console.log(`  Last name:        ${contactsWithLastName} (${pct(contactsWithLastName!, totalContacts!)})`);

  // ═══ PROPOSALS ═══
  const { count: totalProposals } = await supabase.from('proposals').select('*', { count: 'exact', head: true });
  const { count: proposalsWithTotal } = await supabase.from('proposals').select('*', { count: 'exact', head: true }).not('total_after_discount', 'is', null).gt('total_after_discount', 0);
  const { count: proposalsWithSize } = await supabase.from('proposals').select('*', { count: 'exact', head: true }).not('system_size_kwp', 'is', null).gt('system_size_kwp', 0);

  // BOM lines
  const { count: totalBomLines } = await supabase.from('proposal_bom_lines').select('*', { count: 'exact', head: true });
  const { data: proposalsWithBom } = await supabase.from('proposal_bom_lines').select('proposal_id').limit(10000);
  const uniqueProposalsWithBom = new Set((proposalsWithBom ?? []).map((b) => b.proposal_id)).size;

  // BOM value
  const { data: bomTotalData } = await supabase.rpc('sum_bom_total' as any);

  console.log(`\nPROPOSALS (${totalProposals} total)`);
  console.log(`  Has total cost:   ${proposalsWithTotal} (${pct(proposalsWithTotal!, totalProposals!)})`);
  console.log(`  Has system size:  ${proposalsWithSize} (${pct(proposalsWithSize!, totalProposals!)})`);
  console.log(`  Has BOM lines:    ${uniqueProposalsWithBom} (${pct(uniqueProposalsWithBom, totalProposals!)})`);
  console.log(`  Total BOM lines:  ${totalBomLines}`);

  // ═══ PROJECTS ═══
  const { count: totalProjects } = await supabase.from('projects').select('*', { count: 'exact', head: true });
  const { count: projectsWithContract } = await supabase.from('projects').select('*', { count: 'exact', head: true }).not('contracted_value', 'is', null).gt('contracted_value', 0);
  const { count: completedProjects } = await supabase.from('projects').select('*', { count: 'exact', head: true }).eq('status', 'completed');

  console.log(`\nPROJECTS (${totalProjects} total)`);
  console.log(`  Contract value:   ${projectsWithContract} (${pct(projectsWithContract!, totalProjects!)})`);
  console.log(`  Completed:        ${completedProjects}`);

  // ═══ VENDORS ═══
  const { count: totalVendors } = await supabase.from('vendors').select('*', { count: 'exact', head: true });
  const { count: vendorsWithGstin } = await supabase.from('vendors').select('*', { count: 'exact', head: true }).not('gstin', 'is', null).neq('gstin', '');
  const { count: vendorsWithPhone } = await supabase.from('vendors').select('*', { count: 'exact', head: true }).not('phone', 'is', null).neq('phone', '');
  const { count: vendorsWithEmail } = await supabase.from('vendors').select('*', { count: 'exact', head: true }).not('email', 'is', null).neq('email', '');
  const { count: vendorsMsme } = await supabase.from('vendors').select('*', { count: 'exact', head: true }).eq('is_msme', true);

  console.log(`\nVENDORS (${totalVendors} total)`);
  console.log(`  GSTIN:            ${vendorsWithGstin} (${pct(vendorsWithGstin!, totalVendors!)})`);
  console.log(`  Phone:            ${vendorsWithPhone} (${pct(vendorsWithPhone!, totalVendors!)})`);
  console.log(`  Email:            ${vendorsWithEmail} (${pct(vendorsWithEmail!, totalVendors!)})`);
  console.log(`  MSME flagged:     ${vendorsMsme}`);

  // ═══ PURCHASE ORDERS ═══
  const { count: totalPOs } = await supabase.from('purchase_orders').select('*', { count: 'exact', head: true });
  const { count: totalPOItems } = await supabase.from('purchase_order_items').select('*', { count: 'exact', head: true });

  console.log(`\nPURCHASE ORDERS (${totalPOs} POs, ${totalPOItems} line items)`);

  // ═══ SITE PHOTOS ═══
  const { count: totalPhotos } = await supabase.from('site_photos').select('*', { count: 'exact', head: true });
  const { count: photoTags } = await supabase.from('photo_tags').select('*', { count: 'exact', head: true });

  console.log(`\nSITE PHOTOS (${totalPhotos} registered)`);
  console.log(`  AI tagged:        ${photoTags}`);

  // ═══ PROCESSING JOBS ═══
  const { data: jobStats } = await supabase
    .from('processing_jobs')
    .select('status, parse_method');

  if (jobStats) {
    const statusCounts = new Map<string, number>();
    const methodCounts = new Map<string, number>();
    for (const j of jobStats) {
      statusCounts.set(j.status, (statusCounts.get(j.status) ?? 0) + 1);
      if (j.parse_method) methodCounts.set(j.parse_method, (methodCounts.get(j.parse_method) ?? 0) + 1);
    }

    console.log(`\nPROCESSING JOBS (${jobStats.length} total)`);
    for (const [status, count] of [...statusCounts.entries()].sort()) {
      console.log(`  ${status.padEnd(15)} ${count}`);
    }
    console.log(`  By method:`);
    for (const [method, count] of [...methodCounts.entries()].sort()) {
      console.log(`    ${method.padEnd(25)} ${count}`);
    }
  }

  // ═══ SITE EXPENSES ═══
  const { count: totalExpenses } = await supabase.from('project_site_expenses').select('*', { count: 'exact', head: true });
  const { count: expensesWithDesc } = await supabase.from('project_site_expenses').select('*', { count: 'exact', head: true }).not('description', 'is', null).neq('description', '');

  console.log(`\nSITE EXPENSES (${totalExpenses} total)`);
  console.log(`  Has description:  ${expensesWithDesc} (${pct(expensesWithDesc!, totalExpenses!)})`);

  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  Report complete`);
  console.log(`${'═'.repeat(70)}\n`);
}

main().catch((err) => {
  console.error('[data-quality] Fatal error:', err);
  process.exit(1);
});
