/**
 * scripts/seed-marketing-training.ts
 *
 * Idempotent seed for the Marketing & Sales Workflow micro-learning module
 * used by Premkumar (marketing_manager) and the sales_engineer role.
 *
 * Writes one `learning_modules` row per target role (marketing_manager,
 * sales_engineer) sharing an identical quiz of 20 multiple-choice questions.
 * Both rows are matched by `title` for idempotency: a second run updates
 * body_md + quiz_questions in place without creating duplicates.
 *
 * Schema reference: supabase/migrations/128_analytics_microlearning_onboarding.sql
 *   • category CHECK: safety | technical | customer_communication | compliance | general
 *   • onboarding_track CHECK: sales | install | om | admin | all
 *   • target_role TEXT (free-form)
 *   • quiz_questions JSONB — shape mirrors mig 128 seed:
 *       [{question, options: string[], correct_index, explanation?, category?}]
 *
 * Usage:
 *   pnpm tsx scripts/seed-marketing-training.ts
 *
 * Required env vars (loaded from .env.local at repo root):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SECRET_KEY
 */

import * as path from 'path';
import * as dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../packages/types/database';

// Load .env.local from repo root
const repoRoot = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(repoRoot, '.env.local') });

// ── Client ────────────────────────────────────────────────────────────────────

function buildClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error(
      '[seed-marketing-training] Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local',
    );
  }
  return createClient<Database>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

type SupabaseAdmin = ReturnType<typeof buildClient>;
type LearningModuleInsert = Database['public']['Tables']['learning_modules']['Insert'];

// ── Quiz question shape (matches mig 128 seed format) ─────────────────────────

interface QuizQuestion {
  question: string;
  options: string[];
  correct_index: number;
  explanation: string;
  category:
    | 'lead_creation'
    | 'status_followup'
    | 'closure_band'
    | 'quoting'
    | 'won_gate'
    | 'referrer'
    | 'patterns_territories'
    | 'payments'
    | 'proposal_send'
    | 'pipeline_kpis';
}

// ── 20 questions ──────────────────────────────────────────────────────────────

const QUIZ: QuizQuestion[] = [
  // 1 — Lead creation: required fields
  {
    question:
      'On /sales/new, which combination of fields is REQUIRED before the form can be submitted?',
    options: [
      'Customer Name + Phone + Email + Pincode',
      'Customer Name + Phone + City + Segment + Source',
      'Customer Name + System Type + Estimated kWp',
      'Customer Name + Phone + Map Link',
    ],
    correct_index: 1,
    explanation:
      'The form blocks submit unless Customer Name, Phone, City, Segment and Source are all filled. Email, kWp, map link and address lines are optional.',
    category: 'lead_creation',
  },
  // 2 — Lead creation: kWp drives what
  {
    question:
      'What does the Estimated Size (kWp) field on the new-lead form drive downstream?',
    options: [
      'Nothing — it is purely informational',
      'The Quick Quote generator picks the inverter capacity (0.8x–1.5x of kWp) and computes panel wattage',
      'It changes the customer\'s GST rate',
      'It locks the channel-partner commission',
    ],
    correct_index: 1,
    explanation:
      'budgetary-quote.ts uses preferInverterCapacity(sizeKwp) to pick an inverter within 0.8x–1.5x of the system size, and for per-Wp priced panels it multiplies kWp x 1000 for total watts.',
    category: 'lead_creation',
  },
  // 3 — Map link
  {
    question: 'Why is the Google Maps link field on a lead important?',
    options: [
      'It auto-fills the GSTIN',
      'The design and project teams need it to plan the site survey; the link is also inherited onto the project when the lead is won',
      'It triggers the WhatsApp drip campaign',
      'It is required for the proposal PDF',
    ],
    correct_index: 1,
    explanation:
      'map_link is propagated by the create_project_from_accepted_proposal trigger onto the new project (mig 094). The site location row on the lead Details tab also surfaces it as "View on map ↗".',
    category: 'lead_creation',
  },
  // 4 — Status transitions (Path A vs Path B)
  {
    question:
      'A residential customer asks for a fast budgetary number. Which stage path is correct?',
    options: [
      'new → contacted → quick_quote_sent → won (Path A)',
      'new → site_survey_done → design_in_progress → won',
      'new → negotiation → closure_soon → won',
      'new → detailed_proposal_sent → on_hold → won',
    ],
    correct_index: 0,
    explanation:
      'Path A (Quick Quote) is the fast budgetary lane: new → contacted → quick_quote_sent → won. Path B is the longer site-survey/design lane.',
    category: 'status_followup',
  },
  // 5 — Status change auto-creates task
  {
    question:
      'You change a lead from "Contacted" to "Survey Scheduled". What happens automatically?',
    options: [
      'Nothing — you must add a task by hand',
      'A follow-up task is created (or updated if one already exists) and assigned to Prem (marketing_manager)',
      'A WhatsApp message is sent immediately to the customer',
      'The proposal PDF is generated',
    ],
    correct_index: 1,
    explanation:
      'upsertLeadFollowupTask() runs after every status update and after every inline next-followup edit. It UPDATEs the open lead_followup task if one exists, else INSERTs.',
    category: 'status_followup',
  },
  // 6 — Closure-band colours
  {
    question:
      'What does an AMBER closure band mean on a Closure Soon lead?',
    options: [
      'Margin is below 8% — Won is blocked',
      'Margin is between 8% and 10% — clicking Attempt Won creates a pending lead_closure_approvals row and notifies the founder for approval',
      'Margin is above 10% — Prem can flip to Won alone',
      'No BOM data is captured',
    ],
    correct_index: 1,
    explanation:
      'green ≥10%, amber 8–10% (founder approval queue), red <8% (blocked). Founder approves amber bands from the dashboard ClosureApprovalsPanel.',
    category: 'closure_band',
  },
  // 7 — Closure band: no_bom_cost
  {
    question:
      'A lead has base price > 0 but the BOM cost is 0 (common for AI-imported historical proposals). What does the closure-band system do?',
    options: [
      'Blocks Won with a red band',
      'Returns green band with dataQuality=\'no_bom_cost\' and shows a ⓘ note "BOM cost not captured — margin not computed"',
      'Sends an email to the founder asking for the BOM',
      'Auto-deletes the lead',
    ],
    correct_index: 1,
    explanation:
      'closure-helpers.ts MarginSnapshot returns dataQuality=\'no_bom_cost\' when basePrice > 0 and bomCost = 0, and the band is forced to green so the Won transition isn\'t blocked. A ⓘ is rendered on the badge.',
    category: 'closure_band',
  },
  // 8 — Quick vs Detailed
  {
    question:
      'When should you generate a Quick Quote vs a Detailed Proposal?',
    options: [
      'Always Detailed — Quick Quote is deprecated',
      'Quick Quote is the budgetary 8-page PDF used to give a fast indicative number before a site survey. Detailed Proposal is the full 7-page Class A document used after design_confirmed.',
      'Quick Quote is for residential only, Detailed for commercial only',
      'They are the same thing under different names',
    ],
    correct_index: 1,
    explanation:
      'Quick Quote = Path A budgetary (8-page PDF, "Budgetary Estimate — subject to site survey" disclaimer). Detailed = Path B, finalized after design_confirmed and required for the won cascade in new business.',
    category: 'quoting',
  },
  // 9 — Quick Quote vs Detailed BOM differences (recent fix)
  {
    question:
      'Why did Quick Quotes briefly produce ₹0 for every lead before the May 20, 2026 fix?',
    options: [
      'The price_book table was empty',
      'budgetary-quote.ts used logical category names like "panel"/"inverter"/"structure" but price_book stores rows under different names (solar_panels, mms, etc.). A PRICE_BOOK_CATEGORY map now bridges the two.',
      'GST rates were missing',
      'The Anthropic API key expired',
    ],
    correct_index: 1,
    explanation:
      'The PRICE_BOOK_CATEGORY map at the top of budgetary-quote.ts now bridges logical→DB category names. If you add a new logical bucket, add its DB-category list to that map too.',
    category: 'quoting',
  },
  // 10 — Won-gate: bypass
  {
    question:
      'You imported a historical won deal but there is no proposal on the lead, so marking it Won is blocked. What do you do?',
    options: [
      'Delete the lead and re-create it',
      'Toggle proposal_gate_bypassed ON for that lead (visible on the no-proposal banner to founder + marketing_manager), or flip the org-wide /settings → System proposal_gate to OFF',
      'Manually edit the database',
      'Generate a Quick Quote first and accept it',
    ],
    correct_index: 1,
    explanation:
      'mig 109 added per-lead leads.proposal_gate_bypassed and mig 111 added the singleton system_settings.proposal_gate_enabled toggle for org-wide cleanup periods. Both are escape hatches; new business should still Quick Quote first.',
    category: 'won_gate',
  },
  // 11 — Margin skip
  {
    question:
      '"Mark Won (skip margin)" appears next to the Attempt Won button. Who sees it and what does it do?',
    options: [
      'Anyone can see it — it auto-approves the closure',
      'Founder + marketing_manager only. It bypasses the gross-margin closure-band check entirely; the proposal-gate rule still applies. Audited via leads.margin_skipped_at and margin_skipped_by.',
      'It deletes the lead',
      'It sends a refund to the customer',
    ],
    correct_index: 1,
    explanation:
      'AttemptWonButton.canSkipMargin is true for founder + marketing_manager. The action markWonSkipMargin still respects the proposal gate but skips the BOM-margin check.',
    category: 'won_gate',
  },
  // 12 — Referrer: external vs internal
  {
    question:
      'A lead came from a walk-in to the office but Vivek wants it tracked under his name for VIP follow-up. Which referrer do you pick?',
    options: [
      'Leave referrer blank',
      'Pick "Vivek Sridhar (Founder)" or "Management Referral" — both are seeded internal referrers (channel_partners.is_internal = true); they don\'t generate a referral payout',
      'Create a new channel partner called "Vivek"',
      'Pick the first partner on the list',
    ],
    correct_index: 1,
    explanation:
      'mig 109 seeded "Vivek Sridhar (Founder)" and "Management Referral" with is_internal=true. mig 134 fixed fn_auto_create_referral_payout so it correctly skips internal partners — no payout row is created.',
    category: 'referrer',
  },
  // 13 — Referrer: external payout %
  {
    question:
      'An external channel partner has default_commission_pct = 1.0. The lead converts at a base price of ₹10,00,000. What payout row is created when the lead flips to Won?',
    options: [
      '₹50,000 paid out immediately',
      'A pending referral_payouts row of ₹10,000 (1% of base price), created by the fn_auto_create_referral_payout trigger; visible on /referrals → Pending tab',
      'Nothing happens until the customer pays',
      '₹1,000 paid immediately',
    ],
    correct_index: 1,
    explanation:
      'mig 131 introduced referral_payouts with default 1% commission; fn_auto_create_referral_payout (repaired in mig 134) fires on status→won when channel_partner_id is set and the partner is NOT internal. Approve/Pay flow is on /referrals.',
    category: 'referrer',
  },
  // 14 — Win/loss patterns columns
  {
    question:
      'On /sales/patterns, what does the "Top Loss Reasons" section show?',
    options: [
      'A list of lost customer phone numbers',
      'AI-derived reason buckets with a count chip per reason (extracted by the Sunday 23:00 IST cron from last week\'s lost leads)',
      'The price the competitor quoted',
      'Vivek\'s personal notes',
    ],
    correct_index: 1,
    explanation:
      '/sales/patterns is the Wave 2-4 win/loss page (cron #68, runs Sunday 23:00 IST). It surfaces ai_narrative, ai_pricing_insight, top_loss_reasons (JSONB with reason+count), and similar_won_examples pulled from RAG.',
    category: 'patterns_territories',
  },
  // 15 — Territories page access
  {
    question:
      'Who can access /sales/territories and what does it do?',
    options: [
      'Anyone — it is the public lead form',
      'Founder + marketing_manager only. It defines city → default_assignee mappings (e.g. "Chennai South" → Prem) which drive AI lead routing for new leads.',
      'Sales engineers only — to assign themselves',
      'Read-only for everyone',
    ],
    correct_index: 1,
    explanation:
      '/sales/territories redirects non-founder/non-marketing_manager to /dashboard. Each territory has cities + optional segment + default_assignee_employee_id. F5 lead-router uses these for AI auto-assignment.',
    category: 'patterns_territories',
  },
  // 16 — Payment tracker filters
  {
    question:
      'On /payments/tracker, which built-in filter tabs are available above the table?',
    options: [
      'Only "All"',
      'Outstanding, All, Awaiting Invoice, Sent Unpaid, ≥30 Days, ≥60 Days — plus an "Expected This Week" badge link',
      'Won, Lost, Pending',
      'Tamil Nadu, Kerala, Karnataka',
    ],
    correct_index: 1,
    explanation:
      'FILTER_TABS in payments-tracker-table.tsx: outstanding | all | awaiting_invoice | sent_unpaid | order_30d | order_60d. The "Expected This Week" pill links to ?filter=this_week.',
    category: 'payments',
  },
  // 17 — Send proposal: from address + CC
  {
    question:
      'You click "Send Proposal" on a proposal detail. Which inbox does the email come from and who is CC\'d?',
    options: [
      'From svivek.88@gmail.com, BCC prem@shiroienergy.com',
      'From prem@shiroienergy.com, CC svivek.88@gmail.com — a 30-day signed PDF link is attached',
      'From accounts@shiroienergy.com, no CC',
      'It opens the user\'s default mail client',
    ],
    correct_index: 1,
    explanation:
      'send-proposal-button.tsx + proposal-send-actions.ts: email sends from prem@shiroienergy.com with svivek.88@gmail.com on CC (not BCC). The PDF goes as a 30-day signed download link. Status flips Draft → Sent.',
    category: 'proposal_send',
  },
  // 18 — Closing This Week card
  {
    question:
      'The "Closing This Week" KPI card on /sales shows three numbers stacked. What are they?',
    options: [
      'Calls made, emails sent, meetings booked',
      'Lead count + total kWp + total ₹ value of all leads whose expected_close_date falls in the current ISO week; clicking the card filters /sales to that range',
      'Won, Lost, On Hold counts',
      'Pipeline percentile rank',
    ],
    correct_index: 1,
    explanation:
      'PipelineSummary uses get_pipeline_close_window(start, end) RPC (mig 109) — never aggregates money in JS (rule #12). The card is a Link to /sales?closing=this_week.',
    category: 'pipeline_kpis',
  },
  // 19 — Closing This Month
  {
    question:
      '"Closing This Month" excludes which lead statuses from its count?',
    options: [
      'None — every lead is counted',
      'Won, Lost, Disqualified — only active leads with an expected_close_date in the current calendar month are counted',
      'Only New leads',
      'Only leads created this year',
    ],
    correct_index: 1,
    explanation:
      'PipelineSummary filters out won/lost/disqualified when computing both Active Leads and the Closing windows, so the card reflects what could realistically close.',
    category: 'pipeline_kpis',
  },
  // 20 — Bulk actions on /sales
  {
    question:
      'On /sales you select 5 leads with the row checkboxes. What appears at the bottom of the screen?',
    options: [
      'Nothing — bulk actions are not supported',
      'A BulkActionBar with Bulk Assign, Change Status, Delete (and Merge when exactly 2 are selected). Bulk Change Status reports a partial-update count via toast if RLS blocks any row.',
      'Just a delete button',
      'A "Send WhatsApp" button',
    ],
    correct_index: 1,
    explanation:
      'BulkActionBar renders when selectedIds.length > 0 in LeadsTableWrapper. Options come from STAGE_LABELS so they stay in sync with the single-source-of-truth dropdown.',
    category: 'pipeline_kpis',
  },
];

// ── Module body (markdown) ────────────────────────────────────────────────────

const MODULE_BODY_MD = `# Marketing & Sales Workflow — Shiroi ERP

This module covers the entire marketing user journey: creating a lead, walking it
through the stages, generating quotes and proposals, handling the closure band,
tracking referrals, and reading the pipeline KPIs.

## What you will learn

1. **Create leads** correctly on \`/sales/new\` — required fields, why the map
   link matters, what the kWp estimate drives.
2. **Move leads through stages** — Path A (Quick Quote, fast lane) vs Path B
   (site survey → design → detailed proposal). Each status change auto-creates
   or updates a follow-up task for Prem.
3. **Closure band** — green ≥10% (Prem alone), amber 8–10% (founder approval),
   red <8% (blocked). Special case: \`no_bom_cost\` is green with an ⓘ note.
4. **Quick Quote vs Detailed Proposal** — Quick is the 8-page budgetary PDF;
   Detailed is the 7-page Class A document required after design_confirmed.
5. **Won-gate escape hatches** — per-lead \`proposal_gate_bypassed\` and org-wide
   \`system_settings.proposal_gate_enabled\` for historical-data cleanup.
   Founder + marketing_manager also have **Mark Won (skip margin)**.
6. **Referrer attribution** — external partners get an auto-created
   \`referral_payouts\` row at 1% (default); internal referrers (Vivek, Management
   Referral) skip payout creation.
7. **Win/Loss patterns** at \`/sales/patterns\` — AI narrative + top loss reasons +
   similar past won deals (generated every Sunday 23:00 IST).
8. **Sales territories** at \`/sales/territories\` (founder + marketing only) —
   city → default rep mapping that drives AI lead routing.
9. **Payment tracker** at \`/payments/tracker\` — Outstanding / All / Awaiting
   Invoice / Sent Unpaid / ≥30 Days / ≥60 Days filters plus an Expected This
   Week pill.
10. **Send Proposal** sends from \`prem@shiroienergy.com\` with
    \`svivek.88@gmail.com\` on CC. A 30-day signed PDF link is attached.

## Where to dig deeper

- Full module reference: \`docs/modules/sales.md\`
- Referral payouts: \`/referrals\` and \`/referrals/partners/[id]\`
- AI knowledge assistant for ad-hoc questions: \`/ask\`

You need ${'60'}% on the 20-question quiz to pass. Quiz questions cover lead
creation, status transitions, closure bands, quoting, the won-gate, referrer
attribution, patterns, territories, payments, proposal sending, and pipeline
KPIs.
`;

// ── Module specs (one per target role) ────────────────────────────────────────

const MODULE_TITLE = 'Marketing & Sales Workflow — Shiroi ERP';

const MODULES: Array<Pick<LearningModuleInsert, 'title' | 'target_role'>> = [
  { title: MODULE_TITLE, target_role: 'marketing_manager' },
  { title: MODULE_TITLE, target_role: 'sales_engineer' },
];

// ── Upsert helper ─────────────────────────────────────────────────────────────

async function upsertModule(
  supabase: SupabaseAdmin,
  spec: Pick<LearningModuleInsert, 'title' | 'target_role'>,
): Promise<{ action: 'inserted' | 'updated'; id: string }> {
  // Find existing row by (title, target_role)
  const { data: existing, error: findErr } = await supabase
    .from('learning_modules')
    .select('id')
    .eq('title', spec.title)
    .eq('target_role', spec.target_role)
    .maybeSingle();

  if (findErr) {
    throw new Error(
      `Failed to query learning_modules for ${spec.target_role}: ${findErr.message}`,
    );
  }

  const payload: LearningModuleInsert = {
    title: spec.title,
    body_md: MODULE_BODY_MD,
    category: 'customer_communication',
    target_role: spec.target_role!,
    difficulty: 'beginner',
    onboarding_track: 'sales',
    sequence_order: 1,
    language: 'en',
    pass_score_pct: 60,
    active: true,
    quiz_questions: QUIZ as unknown as Database['public']['Tables']['learning_modules']['Insert']['quiz_questions'],
  };

  if (existing) {
    const { error: updErr } = await supabase
      .from('learning_modules')
      .update({
        body_md: payload.body_md,
        category: payload.category,
        difficulty: payload.difficulty,
        onboarding_track: payload.onboarding_track,
        sequence_order: payload.sequence_order,
        language: payload.language,
        pass_score_pct: payload.pass_score_pct,
        active: payload.active,
        quiz_questions: payload.quiz_questions,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id);
    if (updErr) {
      throw new Error(
        `Failed to update learning_module ${existing.id}: ${updErr.message}`,
      );
    }
    return { action: 'updated', id: existing.id };
  }

  const { data: inserted, error: insErr } = await supabase
    .from('learning_modules')
    .insert(payload)
    .select('id')
    .single();
  if (insErr || !inserted) {
    throw new Error(
      `Failed to insert learning_module for ${spec.target_role}: ${insErr?.message ?? 'no row returned'}`,
    );
  }
  return { action: 'inserted', id: inserted.id };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const op = '[seed-marketing-training]';
  console.log(`\n${op} Starting (quiz length: ${QUIZ.length})\n`);

  if (QUIZ.length !== 20) {
    throw new Error(`${op} Expected 20 quiz questions, got ${QUIZ.length}`);
  }

  const supabase = buildClient();

  for (const spec of MODULES) {
    const result = await upsertModule(supabase, spec);
    console.log(
      `  • ${result.action.padEnd(8)} ${spec.target_role.padEnd(20)} id=${result.id}`,
    );
  }

  console.log(`\n${op} Done. ${MODULES.length} module(s), ${QUIZ.length} questions each.\n`);
}

main().catch((e) => {
  console.error('[seed-marketing-training] Fatal error:', e instanceof Error ? e.message : e);
  process.exit(1);
});
