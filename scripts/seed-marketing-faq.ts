/**
 * scripts/seed-marketing-faq.ts
 *
 * Idempotent seed for 50 marketing-flavoured Q&A pairs in the Shiroi RAG
 * knowledge base (rag_chunks). These power the /ask AI assistant — every
 * Q&A becomes a retrievable chunk so when a marketing user types
 * "How do I bypass the margin gate?" the RAG retriever surfaces it and
 * Haiku answers from the cited chunk.
 *
 * Schema reference:
 *   • supabase/migrations/138_wave1_rag_and_supporting_tables.sql
 *     - rag_chunks (source_type CHECK enum, UNIQUE on (source_path, chunk_index))
 *     - rag_search RPC (cosine over jina-embeddings-v3, 1024 dims)
 *
 * Idempotency strategy:
 *   • Each Q&A has a stable slug → source_path = 'docs/training/marketing-faq.md#<slug>'
 *   • upsert on (source_path, chunk_index=0)
 *   • content_hash is sha256 over the rendered "Q: ... A: ..." string
 *   • If hash matches existing, we skip embedding (saves Jina cost on re-runs)
 *
 * source_type:
 *   The rag_chunks.source_type CHECK enum does NOT have a generic 'faq' value.
 *   We use 'module_doc' since these FAQs are conceptually module documentation
 *   distilled into Q&A form — RLS allows authenticated read of module_doc, which
 *   is what we want.
 *
 * Usage:
 *   pnpm tsx scripts/seed-marketing-faq.ts
 *
 * Required env vars (loaded from .env.local at repo root):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SECRET_KEY
 *   JINA_API_KEY  (required — embedding has no fallback in this script)
 */

import * as crypto from 'crypto';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../packages/types/database';

// Load .env.local from repo root
const repoRoot = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(repoRoot, '.env.local') });

// ── Constants ─────────────────────────────────────────────────────────────────

const SOURCE_TYPE = 'module_doc' as const;
const SOURCE_PATH_PREFIX = 'docs/training/marketing-faq.md';
const EMBEDDING_MODEL = 'jina-embeddings-v3';
const EMBEDDING_DIM = 1024;
const JINA_BATCH_SIZE = 96;
const UPSERT_BATCH_SIZE = 50;

// ── Client ────────────────────────────────────────────────────────────────────

function buildClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error(
      '[seed-marketing-faq] Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local',
    );
  }
  return createClient<Database>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

type SupabaseAdmin = ReturnType<typeof buildClient>;
type RagChunkInsert = Database['public']['Tables']['rag_chunks']['Insert'];

// ── Helpers ───────────────────────────────────────────────────────────────────

function sha256(s: string): string {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function jinaEmbed(texts: string[]): Promise<number[][]> {
  const op = '[jinaEmbed]';
  const apiKey = process.env.JINA_API_KEY;
  if (!apiKey) {
    throw new Error(`${op} JINA_API_KEY is not set in .env.local`);
  }
  const response = await fetch('https://api.jina.ai/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      task: 'retrieval.passage',
      input: texts,
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '(unreadable)');
    throw new Error(`${op} Jina ${response.status}: ${body.slice(0, 300)}`);
  }
  const json = (await response.json()) as {
    data: Array<{ index: number; embedding: number[] }>;
  };
  const sorted = [...json.data].sort((a, b) => a.index - b.index);
  for (const e of sorted) {
    if (e.embedding.length !== EMBEDDING_DIM) {
      throw new Error(
        `${op} Embedding dim mismatch at index ${e.index}: got ${e.embedding.length}, expected ${EMBEDDING_DIM}`,
      );
    }
  }
  return sorted.map((e) => e.embedding);
}

async function embedBatched(texts: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += JINA_BATCH_SIZE) {
    const slice = texts.slice(i, i + JINA_BATCH_SIZE);
    if (i > 0) await sleep(200);
    const vectors = await jinaEmbed(slice);
    out.push(...vectors);
  }
  return out;
}

// ── Q&A pairs (50 total) ──────────────────────────────────────────────────────

interface FaqEntry {
  slug: string; // stable slug → source_path suffix
  topic:
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
  question: string;
  answer: string;
}

const FAQ: FaqEntry[] = [
  // ── Lead creation ──────────────────────────────────────────────────────────
  {
    slug: 'add-new-lead',
    topic: 'lead_creation',
    question: 'How do I add a new lead?',
    answer:
      'Go to /sales and click "Create Lead" (or open /sales/new directly). Required fields are Customer Name, Phone, City, Segment (residential / commercial / industrial) and Source. Click Create Lead — the form normalises the phone to 10 digits and routes you to the lead detail page.',
  },
  {
    slug: 'where-google-maps-link',
    topic: 'lead_creation',
    question: 'Where do I paste the Google Maps link?',
    answer:
      'On /sales/new there is an optional "Google Maps Link" field below the address. Paste a https://maps.google.com or https://maps.app.goo.gl URL. The link is also inherited onto the project when the lead is marked Won.',
  },
  {
    slug: 'estimated-kwp-meaning',
    topic: 'lead_creation',
    question: 'What does the Estimated Size (kWp) field do?',
    answer:
      'It drives the Quick Quote generator — the inverter is picked within 0.8x to 1.5x of the system size, and per-Wp priced panels are multiplied by kWp x 1000 for total watts. The number is also used by the pipeline KPI cards (Closing This Week / Month show total kWp).',
  },
  {
    slug: 'duplicate-phone',
    topic: 'lead_creation',
    question: 'I get "A lead with this phone number already exists" — what now?',
    answer:
      'The phone column has a partial unique index that excludes only lost and disqualified leads. Search /sales for the phone first; if the existing lead is still active, update it instead of creating a new one. If it was lost or disqualified you can re-engage by creating the new lead.',
  },

  // ── Status & follow-up ────────────────────────────────────────────────────
  {
    slug: 'status-change-side-effects',
    topic: 'status_followup',
    question: 'What happens when I change a lead status?',
    answer:
      'Three things: (1) the change is logged in lead_status_history, (2) a follow-up task for Prem is upserted via upsertLeadFollowupTask (updates the existing open lead_followup task or creates a new one), and (3) for status=won the proposal-gate trigger runs and, if it passes, the won cascade fires (mark_proposal_accepted → create_project_from_accepted_proposal).',
  },
  {
    slug: 'prem-open-followups',
    topic: 'status_followup',
    question: "How do I see Prem's open follow-ups?",
    answer:
      'Open /my-tasks for the assigned-to-you list, or /sales/[id]/tasks scoped to a single lead. getMyTasks filters is_completed=false and orders by due_date ascending (oldest first), capped at 100 rows.',
  },
  {
    slug: 'see-negotiation-leads',
    topic: 'status_followup',
    question: 'How do I see which leads are in negotiation?',
    answer:
      'On /sales, click the "Negotiation" pill in the stage-nav. You can also filter by URL: /sales?status=negotiation, or combine: /sales?status=negotiation,closure_soon for both.',
  },
  {
    slug: 'next-followup-date',
    topic: 'status_followup',
    question: 'How do I set the next follow-up date?',
    answer:
      'Click into the "Next Follow-up" field on the lead detail page (or inline on /sales). The save is auto-handled; it also updates or creates the open lead_followup task for that date.',
  },
  {
    slug: 'view-activity-timeline',
    topic: 'status_followup',
    question: 'Where do I log a call or meeting with the customer?',
    answer:
      'On the lead detail page, open the Activities tab and click "Add Activity". Pick the type (call, email, meeting, note, whatsapp), add notes, and save. The entry shows up in the activity_associations timeline and is fed into RAG nightly.',
  },

  // ── Closure band ─────────────────────────────────────────────────────────
  {
    slug: 'amber-warning-meaning',
    topic: 'closure_band',
    question: 'What does the amber closure-date warning mean?',
    answer:
      'Amber band means the gross margin is between 8% and 10%. Clicking Attempt Won creates a row in lead_closure_approvals and notifies the founder; the lead flips to Won only after he approves it from the dashboard ClosureApprovalsPanel.',
  },
  {
    slug: 'no-bom-cost',
    topic: 'closure_band',
    question: 'Why does the closure badge show a ⓘ next to the green band?',
    answer:
      'That ⓘ means dataQuality=no_bom_cost — the lead has a base price > 0 but no BOM cost is captured (common for AI-extracted historical proposals). The band is forced to green so Won is not blocked, but margin was not actually computed. Verify with the team before closing.',
  },
  {
    slug: 'red-band-blocked',
    topic: 'closure_band',
    question: 'My lead shows a red band and Won is blocked — what do I do?',
    answer:
      'Red band = margin <8%. Either negotiate the customer price up (edit base_quote_price on the Quote tab), reduce BOM cost, or mark the lead Lost. Founder + marketing_manager can also use "Mark Won (skip margin)" if BOM data is not tracked.',
  },

  // ── Quoting ──────────────────────────────────────────────────────────────
  {
    slug: 'quick-vs-detailed',
    topic: 'quoting',
    question: "What's a Quick Quote vs Detailed Quote?",
    answer:
      'Quick Quote is the 8-page budgetary PDF auto-generated from price_book defaults — fast indicative pricing for early conversations, marked "Budgetary Estimate — subject to site survey". Detailed Proposal is the 7-page Class A document with line-by-line BOM, generated after design_confirmed and required for the won cascade on new business.',
  },
  {
    slug: 'generate-quick-quote',
    topic: 'quoting',
    question: 'How do I generate a Quick Quote?',
    answer:
      'On the lead detail page open the Quote tab (or click the "Quick Quote" button). Confirm system type and kWp, then Generate. The PDF lands under /sales/[id]/files and the lead status flips to quick_quote_sent.',
  },
  {
    slug: 'generate-detailed-proposal',
    topic: 'quoting',
    question: 'How do I generate a Detailed Proposal?',
    answer:
      'On the lead Quote tab, click "Create Detailed Proposal". Add BOM lines via BomPicker (these must have price_book_id; legacy free-text lines are flagged amber), set payment milestones, then click "Finalize" — finalizeDetailedProposal validates every line has a price_book_id and produces the PDF.',
  },
  {
    slug: 'edit-bom',
    topic: 'quoting',
    question: 'How do I edit the BOM on a proposal?',
    answer:
      'Open the lead Quote tab. Use BomPicker to add a price_book item, the inline quantity editor on each row, and the trash icon to remove a line. updateBomLineQuantity and removeBomLine are server actions — changes take effect immediately.',
  },
  {
    slug: 'escalate-quick-to-detailed',
    topic: 'quoting',
    question: 'Can I convert a Quick Quote into a Detailed Proposal?',
    answer:
      'Yes — escalateQuickToDetailed (in quote-actions.ts) creates a new detailed proposal seeded from the Quick Quote pricing. The button is on the Quote tab when a Quick Quote already exists.',
  },
  {
    slug: 'pricebook-source',
    topic: 'quoting',
    question: 'Where do Quick Quote prices come from?',
    answer:
      'From the price_book table. budgetary-quote.ts reasons in logical categories (panel, inverter, structure, dc_cable, ac_cable, earthing, installation_labour, net_meter, civil_work) and looks them up via a PRICE_BOOK_CATEGORY map that bridges to the DB categories (solar_panels, mms, dc_accessories, etc.). Rows with base_price <= 0 are always skipped.',
  },

  // ── Won-gate / margin skip ────────────────────────────────────────────────
  {
    slug: 'bypass-margin-gate',
    topic: 'won_gate',
    question: 'How do I bypass the margin gate on a won lead?',
    answer:
      'On the lead detail page in the closure_soon stage, founder + marketing_manager see a secondary "Mark Won (skip margin)" button next to "Attempt Won". It skips the BOM-margin check entirely. The proposal-gate rule still applies. The bypass is audited via leads.margin_skipped_at + margin_skipped_by.',
  },
  {
    slug: 'enable-proposal-gate-bypass',
    topic: 'won_gate',
    question: 'How do I enable proposal_gate_bypassed on a specific lead?',
    answer:
      'On the lead detail page, when the lead has no proposal you see a "Proposal Gate Bypassed" toggle (visible to founder + marketing_manager only). Flip it ON to allow Won without a proposal. The action is in proposal-gate-bypass-toggle.tsx.',
  },
  {
    slug: 'org-wide-proposal-gate',
    topic: 'won_gate',
    question: 'How do I turn off the proposal-gate org-wide?',
    answer:
      'Go to /settings → System and toggle "Proposal Gate" OFF. While OFF, a site-wide amber banner appears on the dashboard + /sales + lead detail pages. This is the historical-cleanup mode — remember to switch it back ON for normal business.',
  },

  // ── Referrer attribution ──────────────────────────────────────────────────
  {
    slug: 'add-channel-partner',
    topic: 'referrer',
    question: 'How do I add a new channel partner?',
    answer:
      'Go to /partners and click "Add Partner". Fill in name, type (consultant / architect / MEP / referral), contact details, and default_commission_pct (defaults to 1%). Bank account fields are sensitive and masked in the UI.',
  },
  {
    slug: 'see-referral-payouts',
    topic: 'referrer',
    question: 'Where do I see referral payouts?',
    answer:
      'On /referrals. The page has a KPI strip (pending count, this-month commission, lifetime paid) and a 3-tab table: Pending / Approved / Paid. Each row has Approve, Reject, and Mark Paid actions.',
  },
  {
    slug: 'partner-detail',
    topic: 'referrer',
    question: 'How do I see all leads attributed to one partner?',
    answer:
      'Open /referrals/partners/[id] (or click the partner name on /partners). The page shows YTD totals, lifetime referrals, full payout history, and the bank account (masked behind a click-to-reveal SensitiveField).',
  },
  {
    slug: 'internal-vs-external',
    topic: 'referrer',
    question: "What's the difference between an internal and external referrer?",
    answer:
      'Internal referrers (channel_partners.is_internal = true — seeded with "Vivek Sridhar (Founder)" and "Management Referral") do NOT generate a referral_payouts row when the lead wins. External partners do — the fn_auto_create_referral_payout trigger writes a pending row at the default commission percentage.',
  },
  {
    slug: 'how-payout-calculated',
    topic: 'referrer',
    question: 'How is the referral payout amount calculated?',
    answer:
      'partner.default_commission_pct × proposal base price (defaults to 1%). The trigger fires when the lead status flips to "won" and channel_partner_id is set. After payment, increment_partner_commission RPC atomically bumps lifetime_commission and lifetime_referrals on the partner row.',
  },
  {
    slug: 'change-referrer-on-lead',
    topic: 'referrer',
    question: 'How do I change the referrer on an existing lead?',
    answer:
      'On the lead detail page → Details tab, click the Referrer row to open the InlineReferrerPicker. Pick a different partner (or clear to no referrer). The change is saved on selection; consultant commission is recomputed and locked by the BEFORE UPDATE trigger.',
  },

  // ── Patterns / territories ────────────────────────────────────────────────
  {
    slug: 'view-win-loss-patterns',
    topic: 'patterns_territories',
    question: 'How do I view win/loss patterns?',
    answer:
      'Open /sales/patterns. Founder + marketing_manager only. The page shows the latest AI narrative, top loss reasons, pricing insight, and similar past won deals retrieved from RAG. Reports are generated every Sunday at 23:00 IST by the win-loss analyser cron.',
  },
  {
    slug: 'run-analysis-now',
    topic: 'patterns_territories',
    question: 'Can I trigger a win/loss analysis right now?',
    answer:
      'Only the founder sees the "Run analysis now" button on /sales/patterns. It calls the same win-loss-analyser used by the Sunday cron and stores the new row in lead_win_loss_patterns.',
  },
  {
    slug: 'view-territories',
    topic: 'patterns_territories',
    question: 'How do I view or edit sales territories?',
    answer:
      'Open /sales/territories. Founder + marketing_manager only. Each territory has a name, a list of cities (lowercase), an optional segment filter, and a default_assignee. New leads are auto-routed to the matching territory\'s rep by the F5 lead-router.',
  },
  {
    slug: 'add-territory',
    topic: 'patterns_territories',
    question: 'How do I add a new city to a territory?',
    answer:
      'On /sales/territories, edit the territory row and add the city to its cities array (use lowercase, e.g. "tiruvallur"). Save. The router uses exact lowercase match against the lead\'s city field on the next routing run.',
  },
  {
    slug: 'similar-won-examples',
    topic: 'patterns_territories',
    question: 'What are the "Similar Past Won Deals" cards on /sales/patterns?',
    answer:
      'They are pulled from the RAG knowledge base using semantic similarity against the current period\'s won leads. Each card shows the source path, a content excerpt, and the similarity percent. Useful for sales-pitch reference.',
  },

  // ── Payments ─────────────────────────────────────────────────────────────
  {
    slug: 'payment-tracker-overdue',
    topic: 'payments',
    question: 'Why is the payment tracker showing overdue?',
    answer:
      'A milestone with status sent_unpaid (invoice sent but no receipt) that has passed its due date is overdue. Open /payments/tracker?filter=order_30d or order_60d for aging buckets. Click into the project to see the milestone and trigger a follow-up.',
  },
  {
    slug: 'payment-tracker-filters',
    topic: 'payments',
    question: 'What filters are on /payments/tracker?',
    answer:
      'Tab filters: Outstanding (default), All, Awaiting Invoice, Sent Unpaid, ≥30 Days, ≥60 Days. There is also an "Expected This Week" badge link that filters to projects with a milestone due in the current week.',
  },
  {
    slug: 'payment-followups-list',
    topic: 'payments',
    question: 'Where do I see all my payment follow-up tasks?',
    answer:
      'Open /my-tasks and look for tasks of type payment_followup or payment_escalation. These are auto-created by the create_payment_followup_tasks and enqueue_payment_escalations triggers on proposal_payment_schedule rows (assigned to Prem).',
  },
  {
    slug: 'mark-followup-complete',
    topic: 'payments',
    question: 'How do I close out a payment follow-up?',
    answer:
      'On /payments/tracker, click the follow-up indicator next to the milestone and use "Mark Complete" in the FollowUpDialog. Or open the task on /my-tasks and tick it off there.',
  },
  {
    slug: 'expected-this-week-card',
    topic: 'payments',
    question: 'What does "Expected This Week" on the payment tracker count?',
    answer:
      'Projects with at least one milestone whose due date is in the current ISO week and status is awaiting_invoice or sent_unpaid. The KPI is sourced from getPaymentsExpectedThisWeek and the count is the number of distinct projects.',
  },

  // ── Proposal send ────────────────────────────────────────────────────────
  {
    slug: 'send-proposal-to-customer',
    topic: 'proposal_send',
    question: 'How do I send a proposal to the customer?',
    answer:
      'Open the proposal detail page (/proposals/[id] or /sales/[id]/proposal) and click "Send Proposal". Confirm the dialog — the email goes out from prem@shiroienergy.com to the customer email on file, with svivek.88@gmail.com on CC. The latest PDF is attached as a 30-day signed download link.',
  },
  {
    slug: 'send-button-greyed',
    topic: 'proposal_send',
    question: 'Why is the Send Proposal button greyed out?',
    answer:
      'There is no email address on the lead. Go to the lead Details tab and add an Email, then come back and the button will enable. Hovering the disabled button shows the tooltip "No email on file for this lead".',
  },
  {
    slug: 'send-from-which-account',
    topic: 'proposal_send',
    question: "Which Gmail account does the proposal send from?",
    answer:
      'prem@shiroienergy.com. svivek.88@gmail.com is CC\'d on every send for audit. There is currently no way to override these addresses from the UI.',
  },
  {
    slug: 'customer-portal-link',
    topic: 'proposal_send',
    question: 'How do I send the customer a shareable proposal link?',
    answer:
      'On the proposal detail page use "Create Share Link" (F7 portal). It generates a /p/<token> magic link valid for the days you choose; the customer-facing page shows the proposal summary and a PDF download. The customer can also click Accept which fires proposal.accepted_by_customer.',
  },
  {
    slug: 'whatsapp-number',
    topic: 'proposal_send',
    question: "Where do I see the customer's WhatsApp number?",
    answer:
      'On the lead detail page → Contact Info card, the Phone row is the same number used for WhatsApp. WhatsApp drips are sent to the normalized 10-digit phone via the customer_outreach_queue. There is no separate WhatsApp field.',
  },

  // ── Pipeline / KPIs ──────────────────────────────────────────────────────
  {
    slug: 'pipeline-value-calc',
    topic: 'pipeline_kpis',
    question: 'How is the Pipeline Value calculated?',
    answer:
      '"Weighted Pipeline" on /sales = sum of (lead.base_quote_price OR fallback estimate) × close_probability for every non-terminal lead. Numbers come from the get_pipeline_summary() RPC, cached for 300s. Never aggregated in JS (rule #12).',
  },
  {
    slug: 'closing-this-week-counts',
    topic: 'pipeline_kpis',
    question: 'What does the Closing This Week card count?',
    answer:
      'It counts active leads (not won/lost/disqualified) whose expected_close_date falls in the current ISO week. The card stacks three numbers: lead count + total kWp + total ₹ value. Click the card to filter /sales to those leads.',
  },
  {
    slug: 'expected-orders',
    topic: 'pipeline_kpis',
    question: 'What does the Expected Orders card on the dashboard show?',
    answer:
      'Leads in any of quick_quote_sent, detailed_proposal_sent, design_confirmed, negotiation, closure_soon whose expected_close_date is inside the window. Sourced from the get_expected_orders(window_days) RPC. mig 109 widened the status filter — before that it was just negotiation + closure_soon.',
  },
  {
    slug: 'bulk-update-status',
    topic: 'pipeline_kpis',
    question: 'Can I bulk-update lead statuses?',
    answer:
      'Yes. On /sales, tick the checkboxes on the rows you want, then use BulkActionBar → Change Status. bulkChangeLeadStatus reports the actual updated count via toast — if RLS blocked some rows you will see a partial-update count.',
  },
  {
    slug: 'multi-status-filter',
    topic: 'pipeline_kpis',
    question: 'How do I filter /sales by multiple statuses at once?',
    answer:
      'Click the "All Statuses (N)" pill to open FilterMultiSelect and tick the statuses you want — the URL becomes /sales?status=new,contacted,negotiation. getLeads accepts a LeadStatus[] so the filter is server-side.',
  },
  {
    slug: 'filter-by-kwp',
    topic: 'pipeline_kpis',
    question: 'How do I filter /sales by kWp range?',
    answer:
      'Use the FilterRange pill labelled "Size (kWp)". Set Min and Max — the URL becomes /sales?kwpMin=5&kwpMax=15. Backed by the idx_leads_estimated_size_kwp index.',
  },
  {
    slug: 'filter-by-close-date',
    topic: 'pipeline_kpis',
    question: 'How do I filter /sales by close-date range?',
    answer:
      'Use the FilterRange pill labelled "Closing". Pick a From and To date — the URL becomes /sales?closeFrom=2026-05-20&closeTo=2026-06-30.',
  },
  {
    slug: 'filter-by-referrer',
    topic: 'pipeline_kpis',
    question: 'How do I filter /sales by referrer?',
    answer:
      'Use the FilterMultiSelect pill labelled "Referrer". Pick a specific partner (/sales?referrer=<channel_partner_id>) or pick "All internal" to get every lead attributed to Vivek or Management Referral (/sales?referrer=internal_all).',
  },
];

if (FAQ.length !== 50) {
  throw new Error(
    `[seed-marketing-faq] Expected 50 Q&A pairs, got ${FAQ.length}. Update FAQ before running.`,
  );
}

// Validate unique slugs
{
  const seen = new Set<string>();
  for (const f of FAQ) {
    if (seen.has(f.slug)) {
      throw new Error(`[seed-marketing-faq] Duplicate slug: ${f.slug}`);
    }
    seen.add(f.slug);
  }
}

// ── Content rendering ─────────────────────────────────────────────────────────

function renderContent(entry: FaqEntry): string {
  return `Q: ${entry.question}\nA: ${entry.answer}`;
}

function sourcePathFor(entry: FaqEntry): string {
  return `${SOURCE_PATH_PREFIX}#${entry.slug}`;
}

// ── Diff existing chunks ──────────────────────────────────────────────────────

async function loadExistingHashes(
  supabase: SupabaseAdmin,
): Promise<Map<string, string>> {
  // Pull every chunk for our source_path_prefix in one go (50 rows max — small)
  const { data, error } = await supabase
    .from('rag_chunks')
    .select('source_path, content_hash')
    .eq('source_type', SOURCE_TYPE)
    .like('source_path', `${SOURCE_PATH_PREFIX}#%`);

  if (error) {
    throw new Error(`Failed to load existing FAQ chunks: ${error.message}`);
  }
  const map = new Map<string, string>();
  for (const row of data ?? []) {
    map.set(row.source_path, row.content_hash);
  }
  return map;
}

async function upsertChunks(
  supabase: SupabaseAdmin,
  rows: RagChunkInsert[],
): Promise<void> {
  for (let i = 0; i < rows.length; i += UPSERT_BATCH_SIZE) {
    const slice = rows.slice(i, i + UPSERT_BATCH_SIZE);
    const { error } = await supabase
      .from('rag_chunks')
      .upsert(slice, { onConflict: 'source_path,chunk_index' });
    if (error) {
      throw new Error(`Upsert failed: ${error.message}`);
    }
    if (i + UPSERT_BATCH_SIZE < rows.length) await sleep(50);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const op = '[seed-marketing-faq]';
  const t0 = Date.now();
  console.log(`\n${op} Starting (${FAQ.length} Q&A pairs)\n`);

  if (!process.env.JINA_API_KEY) {
    console.log(
      `${op} JINA_API_KEY is not set in .env.local.\n` +
        '   Set it before running this script — embeddings have no fallback here.\n' +
        '   1. Sign up at https://jina.ai for a free key.\n' +
        '   2. Add JINA_API_KEY=your_key to .env.local at the repo root.\n' +
        '   3. Re-run: pnpm tsx scripts/seed-marketing-faq.ts\n',
    );
    process.exit(0);
  }

  const supabase = buildClient();

  // 1. Load existing hashes for diff
  const existingHashes = await loadExistingHashes(supabase);
  console.log(`  Existing FAQ chunks: ${existingHashes.size}`);

  // 2. Compute hash + sourcePath per entry, decide what to embed
  const toEmbed: Array<{
    entry: FaqEntry;
    sourcePath: string;
    content: string;
    hash: string;
  }> = [];
  let skipped = 0;

  for (const entry of FAQ) {
    const sourcePath = sourcePathFor(entry);
    const content = renderContent(entry);
    const hash = sha256(content);

    if (existingHashes.get(sourcePath) === hash) {
      skipped++;
      continue;
    }
    toEmbed.push({ entry, sourcePath, content, hash });
  }

  console.log(`  Need to embed: ${toEmbed.length}, unchanged: ${skipped}`);

  if (toEmbed.length === 0) {
    console.log(`\n${op} All FAQ chunks up to date (${((Date.now() - t0) / 1000).toFixed(1)}s)\n`);
    return;
  }

  // 3. Embed in batches via Jina
  const texts = toEmbed.map((e) => e.content);
  console.log(`  Calling Jina (${EMBEDDING_MODEL}, batch=${JINA_BATCH_SIZE})…`);
  const vectors = await embedBatched(texts);

  // 4. Build rag_chunks rows
  const now = new Date().toISOString();
  const rows: RagChunkInsert[] = toEmbed.map((item, idx) => ({
    source_type: SOURCE_TYPE,
    source_path: item.sourcePath,
    source_id: null,
    chunk_index: 0,
    content: item.content,
    heading_path: [item.entry.topic, item.entry.slug],
    metadata: {
      seeded_by: 'scripts/seed-marketing-faq.ts',
      topic: item.entry.topic,
      slug: item.entry.slug,
      audience: ['marketing_manager', 'sales_engineer'],
    },
    embedding: `[${vectors[idx].join(',')}]`,
    embedding_model: EMBEDDING_MODEL,
    embedding_dim: EMBEDDING_DIM,
    content_hash: item.hash,
    last_indexed_at: now,
  }));

  console.log(`  Upserting ${rows.length} rag_chunks rows…`);
  await upsertChunks(supabase, rows);

  console.log(
    `\n${op} Done in ${((Date.now() - t0) / 1000).toFixed(1)}s — upserted ${rows.length}, skipped ${skipped}\n`,
  );
}

main().catch((e) => {
  console.error('[seed-marketing-faq] Fatal error:', e instanceof Error ? e.message : e);
  process.exit(1);
});
