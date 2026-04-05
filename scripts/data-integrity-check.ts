/**
 * Data Integrity Check Script
 *
 * Phase 2C Step 43: Validates all FK relationships, detects orphans,
 * flags data quality issues across leads, proposals, projects, POs, vendors.
 *
 * Usage: npx tsx scripts/data-integrity-check.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SECRET_KEY!;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

interface Issue {
  category: string;
  severity: 'error' | 'warning' | 'info';
  table: string;
  id?: string;
  message: string;
}

const issues: Issue[] = [];

function addIssue(category: string, severity: Issue['severity'], table: string, message: string, id?: string) {
  issues.push({ category, severity, table, id, message });
}

// ── Orphan checks ──

async function checkOrphans() {
  console.log('\n🔗 Checking FK relationships / orphans...');

  // Proposals without valid leads
  const { data: orphanProposals } = await supabase.rpc('check_orphan_proposals').select('*');
  // Fallback: manual query
  const { data: proposals } = await supabase
    .from('proposals')
    .select('id, proposal_number, lead_id')
    .not('lead_id', 'is', null);

  if (proposals) {
    const leadIds = [...new Set(proposals.map((p: any) => p.lead_id))];
    const { data: existingLeads } = await supabase
      .from('leads')
      .select('id')
      .in('id', leadIds);
    const existingSet = new Set((existingLeads ?? []).map((l: any) => l.id));
    for (const p of proposals) {
      if (!existingSet.has(p.lead_id)) {
        addIssue('orphan', 'error', 'proposals', `Proposal ${p.proposal_number} references non-existent lead ${p.lead_id}`, p.id);
      }
    }
  }

  // Projects without valid proposals
  const { data: projects } = await supabase
    .from('projects')
    .select('id, project_number, proposal_id, lead_id')
    .not('proposal_id', 'is', null);

  if (projects) {
    const proposalIds = [...new Set(projects.map((p: any) => p.proposal_id).filter(Boolean))];
    if (proposalIds.length > 0) {
      const { data: existingProposals } = await supabase
        .from('proposals')
        .select('id')
        .in('id', proposalIds);
      const existingSet = new Set((existingProposals ?? []).map((p: any) => p.id));
      for (const proj of projects) {
        if (proj.proposal_id && !existingSet.has(proj.proposal_id)) {
          addIssue('orphan', 'error', 'projects', `Project ${proj.project_number} references non-existent proposal ${proj.proposal_id}`, proj.id);
        }
      }
    }

    // Projects without valid leads
    const leadIds = [...new Set(projects.map((p: any) => p.lead_id).filter(Boolean))];
    if (leadIds.length > 0) {
      const { data: existingLeads } = await supabase
        .from('leads')
        .select('id')
        .in('id', leadIds);
      const existingSet = new Set((existingLeads ?? []).map((l: any) => l.id));
      for (const proj of projects) {
        if (proj.lead_id && !existingSet.has(proj.lead_id)) {
          addIssue('orphan', 'error', 'projects', `Project ${proj.project_number} references non-existent lead ${proj.lead_id}`, proj.id);
        }
      }
    }
  }

  // POs without valid projects or vendors
  const { data: pos } = await supabase
    .from('purchase_orders')
    .select('id, po_number, project_id, vendor_id');

  if (pos) {
    const projectIds = [...new Set(pos.map((p: any) => p.project_id).filter(Boolean))];
    const vendorIds = [...new Set(pos.map((p: any) => p.vendor_id).filter(Boolean))];

    if (projectIds.length > 0) {
      const { data: existingProjects } = await supabase
        .from('projects')
        .select('id')
        .in('id', projectIds);
      const existingSet = new Set((existingProjects ?? []).map((p: any) => p.id));
      for (const po of pos) {
        if (po.project_id && !existingSet.has(po.project_id)) {
          addIssue('orphan', 'error', 'purchase_orders', `PO ${po.po_number} references non-existent project ${po.project_id}`, po.id);
        }
      }
    }

    if (vendorIds.length > 0) {
      const { data: existingVendors } = await supabase
        .from('vendors')
        .select('id')
        .in('id', vendorIds);
      const existingSet = new Set((existingVendors ?? []).map((v: any) => v.id));
      for (const po of pos) {
        if (po.vendor_id && !existingSet.has(po.vendor_id)) {
          addIssue('orphan', 'error', 'purchase_orders', `PO ${po.po_number} references non-existent vendor ${po.vendor_id}`, po.id);
        }
      }
    }
  }
}

// ── Data quality: phone numbers ──

async function checkPhoneNumbers() {
  console.log('📞 Checking phone number quality...');

  const PLACEHOLDER_PHONES = ['0000000000', '9999999999', '1111111111', '0', '', '+91'];

  // Leads
  const { data: leads } = await supabase
    .from('leads')
    .select('id, customer_name, phone')
    .is('deleted_at', null);

  if (leads) {
    for (const lead of leads) {
      const phone = (lead.phone ?? '').trim();
      if (!phone) {
        addIssue('data_quality', 'warning', 'leads', `Lead "${lead.customer_name}" has no phone number`, lead.id);
      } else if (PLACEHOLDER_PHONES.includes(phone.replace(/\D/g, ''))) {
        addIssue('data_quality', 'warning', 'leads', `Lead "${lead.customer_name}" has placeholder phone: ${phone}`, lead.id);
      } else {
        const digits = phone.replace(/\D/g, '');
        if (digits.length < 10) {
          addIssue('data_quality', 'warning', 'leads', `Lead "${lead.customer_name}" has short phone: ${phone} (${digits.length} digits)`, lead.id);
        }
      }
    }
  }

  // Vendors
  const { data: vendors } = await supabase
    .from('vendors')
    .select('id, company_name, phone');

  if (vendors) {
    for (const v of vendors) {
      const phone = (v.phone ?? '').trim();
      if (!phone) continue; // Phone is optional for vendors
      if (PLACEHOLDER_PHONES.includes(phone.replace(/\D/g, ''))) {
        addIssue('data_quality', 'warning', 'vendors', `Vendor "${v.company_name}" has placeholder phone: ${phone}`, v.id);
      }
    }
  }
}

// ── Data quality: names ──

async function checkNames() {
  console.log('👤 Checking name quality...');

  const { data: leads } = await supabase
    .from('leads')
    .select('id, customer_name')
    .is('deleted_at', null);

  if (leads) {
    for (const lead of leads) {
      const name = (lead.customer_name ?? '').trim();
      if (!name || name === '—' || name === '-' || name === 'N/A' || name === 'NA') {
        addIssue('data_quality', 'error', 'leads', `Lead has invalid name: "${lead.customer_name}"`, lead.id);
      } else if (name.length < 3) {
        addIssue('data_quality', 'warning', 'leads', `Lead has suspiciously short name: "${name}"`, lead.id);
      }
    }
  }

  const { data: vendors } = await supabase
    .from('vendors')
    .select('id, company_name');

  if (vendors) {
    for (const v of vendors) {
      const name = (v.company_name ?? '').trim();
      if (!name || name === '—' || name === '-') {
        addIssue('data_quality', 'error', 'vendors', `Vendor has invalid name: "${v.company_name}"`, v.id);
      }
    }
  }
}

// ── Uniqueness checks ──

async function checkUniqueness() {
  console.log('🔑 Checking uniqueness constraints...');

  // Duplicate proposal numbers
  const { data: proposalDups } = await supabase
    .from('proposals')
    .select('proposal_number');

  if (proposalDups) {
    const counts: Record<string, number> = {};
    for (const p of proposalDups) {
      counts[p.proposal_number] = (counts[p.proposal_number] || 0) + 1;
    }
    for (const [num, count] of Object.entries(counts)) {
      if (count > 1) {
        // This is expected for revisions — same proposal_number, different revision_number
        // Only flag if it seems unintentional
        addIssue('uniqueness', 'info', 'proposals', `Proposal number "${num}" appears ${count} times (may be revisions)`, undefined);
      }
    }
  }

  // Duplicate PO numbers
  const { data: poDups } = await supabase
    .from('purchase_orders')
    .select('po_number');

  if (poDups) {
    const counts: Record<string, number> = {};
    for (const p of poDups) {
      counts[p.po_number] = (counts[p.po_number] || 0) + 1;
    }
    for (const [num, count] of Object.entries(counts)) {
      if (count > 1) {
        addIssue('uniqueness', 'error', 'purchase_orders', `PO number "${num}" is duplicated ${count} times`, undefined);
      }
    }
  }
}

// ── Financial integrity ──

async function checkFinancials() {
  console.log('💰 Checking financial integrity...');

  // Negative amounts
  const { data: proposals } = await supabase
    .from('proposals')
    .select('id, proposal_number, total_after_discount, system_size_kwp');

  if (proposals) {
    for (const p of proposals) {
      if (p.total_after_discount != null && p.total_after_discount < 0) {
        addIssue('financial', 'error', 'proposals', `Proposal ${p.proposal_number} has negative total: ${p.total_after_discount}`, p.id);
      }
      if (p.system_size_kwp != null && p.system_size_kwp <= 0) {
        addIssue('financial', 'warning', 'proposals', `Proposal ${p.proposal_number} has zero/negative system size: ${p.system_size_kwp}`, p.id);
      }
    }
  }

  // Projects with zero contracted value
  const { data: projects } = await supabase
    .from('projects')
    .select('id, project_number, contracted_value, system_size_kwp');

  if (projects) {
    for (const proj of projects) {
      if (proj.contracted_value != null && proj.contracted_value < 0) {
        addIssue('financial', 'error', 'projects', `Project ${proj.project_number} has negative contracted value: ${proj.contracted_value}`, proj.id);
      }
      if (proj.contracted_value === 0 || proj.contracted_value == null) {
        addIssue('financial', 'warning', 'projects', `Project ${proj.project_number} has zero/null contracted value`, proj.id);
      }
    }
  }

  // MSME vendor payment compliance
  const { data: msmeVendors } = await supabase
    .from('vendors')
    .select('id, company_name, is_msme, payment_terms_days')
    .eq('is_msme', true);

  if (msmeVendors) {
    for (const v of msmeVendors) {
      if (v.payment_terms_days && v.payment_terms_days > 45) {
        addIssue('compliance', 'warning', 'vendors', `MSME vendor "${v.company_name}" has payment terms > 45 days (${v.payment_terms_days})`, v.id);
      }
    }
  }
}

// ── Status consistency ──

async function checkStatusConsistency() {
  console.log('🔄 Checking status consistency...');

  // Leads marked "won" but no corresponding project
  const { data: wonLeads } = await supabase
    .from('leads')
    .select('id, customer_name')
    .eq('status', 'won')
    .is('deleted_at', null);

  if (wonLeads) {
    const leadIds = wonLeads.map((l: any) => l.id);
    if (leadIds.length > 0) {
      const { data: projectsForLeads } = await supabase
        .from('projects')
        .select('lead_id')
        .in('lead_id', leadIds);
      const projectLeadIds = new Set((projectsForLeads ?? []).map((p: any) => p.lead_id));
      for (const lead of wonLeads) {
        if (!projectLeadIds.has(lead.id)) {
          addIssue('consistency', 'warning', 'leads', `Lead "${lead.customer_name}" is "won" but has no project`, lead.id);
        }
      }
    }
  }

  // Deleted leads with active proposals
  const { data: deletedLeads } = await supabase
    .from('leads')
    .select('id, customer_name')
    .not('deleted_at', 'is', null);

  if (deletedLeads && deletedLeads.length > 0) {
    const deletedIds = deletedLeads.map((l: any) => l.id);
    const { data: activeProposals } = await supabase
      .from('proposals')
      .select('id, proposal_number, lead_id')
      .in('lead_id', deletedIds)
      .in('status', ['draft', 'sent']);

    if (activeProposals) {
      for (const p of activeProposals) {
        const lead = deletedLeads.find((l: any) => l.id === p.lead_id);
        addIssue('consistency', 'warning', 'proposals', `Active proposal ${p.proposal_number} belongs to soft-deleted lead "${lead?.customer_name}"`, p.id);
      }
    }
  }
}

// ── Summary counts ──

async function getCounts() {
  console.log('📊 Fetching entity counts...');

  const tables = ['leads', 'proposals', 'projects', 'purchase_orders', 'vendors', 'employees', 'contacts', 'companies'];
  const counts: Record<string, number> = {};

  for (const table of tables) {
    const { count } = await supabase.from(table).select('*', { count: 'exact', head: true });
    counts[table] = count ?? 0;
  }

  // Active leads (not soft-deleted)
  const { count: activeLeads } = await supabase
    .from('leads')
    .select('*', { count: 'exact', head: true })
    .is('deleted_at', null);

  counts['leads_active'] = activeLeads ?? 0;

  return counts;
}

// ── Main ──

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log(' Shiroi ERP — Data Integrity Check');
  console.log('═══════════════════════════════════════════════');
  console.log(`Target: ${supabaseUrl}`);
  console.log(`Date: ${new Date().toISOString()}`);
  console.log('');

  const counts = await getCounts();
  console.log('\n📊 Entity Counts:');
  for (const [table, count] of Object.entries(counts)) {
    console.log(`   ${table.padEnd(20)} ${count.toLocaleString('en-IN')}`);
  }

  await checkOrphans();
  await checkPhoneNumbers();
  await checkNames();
  await checkUniqueness();
  await checkFinancials();
  await checkStatusConsistency();

  // ── Report ──
  console.log('\n═══════════════════════════════════════════════');
  console.log(' RESULTS');
  console.log('═══════════════════════════════════════════════');

  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  const infos = issues.filter((i) => i.severity === 'info');

  console.log(`\n❌ Errors: ${errors.length}`);
  console.log(`⚠️  Warnings: ${warnings.length}`);
  console.log(`ℹ️  Info: ${infos.length}`);
  console.log(`   Total issues: ${issues.length}`);

  if (errors.length > 0) {
    console.log('\n── ERRORS ──');
    for (const e of errors) {
      console.log(`  ❌ [${e.category}] ${e.table}: ${e.message}${e.id ? ` (id: ${e.id})` : ''}`);
    }
  }

  if (warnings.length > 0) {
    console.log('\n── WARNINGS ──');
    const grouped: Record<string, Issue[]> = {};
    for (const w of warnings) {
      const key = `${w.category}/${w.table}`;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(w);
    }
    for (const [key, items] of Object.entries(grouped)) {
      if (items.length > 10) {
        console.log(`  ⚠️  [${key}] ${items.length} issues (showing first 5):`);
        for (const w of items.slice(0, 5)) {
          console.log(`     ${w.message}`);
        }
        console.log(`     ... and ${items.length - 5} more`);
      } else {
        for (const w of items) {
          console.log(`  ⚠️  [${w.category}] ${w.table}: ${w.message}`);
        }
      }
    }
  }

  if (infos.length > 0) {
    console.log('\n── INFO ──');
    for (const i of infos) {
      console.log(`  ℹ️  [${i.category}] ${i.table}: ${i.message}`);
    }
  }

  console.log('\n═══════════════════════════════════════════════');
  console.log(` Data integrity check complete.`);
  console.log(`═══════════════════════════════════════════════`);

  // Exit with error code if critical issues found
  if (errors.length > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});
