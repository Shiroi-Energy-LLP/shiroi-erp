/**
 * seed-site-engineer-training.ts
 *
 * Seeds ONE row into `learning_modules` for site engineers:
 * "Project Execution & Operations — Shiroi ERP".
 *
 * Target roles: project_manager (Manivel) + om_technician.
 * Twenty MCQ questions covering the daily-driver ERP surfaces:
 *   /hr/attendance, /hr/leave, /projects/[id] (Progress / Materials /
 *   Certificates tabs), /projects/[id] milestone photo gate,
 *   /om, /om/inverters (healthcheck + recent poll failures),
 *   handover-pack PDF (3 pages), DC certificate signing immutability,
 *   project completion weighted % (10 components, sums to 95 + handover@0).
 *
 * Schema reference: supabase/migrations/128_analytics_microlearning_onboarding.sql
 *   - learning_modules row constraints: difficulty IN ('beginner','intermediate','advanced'),
 *     category IN ('safety','technical','customer_communication','compliance','general'),
 *     onboarding_track IN ('sales','install','om','admin','all') NULL ok,
 *     pass_score_pct INTEGER default 60, target_role TEXT.
 *
 * Caveat on target_role:
 *   The `learning_modules.target_role` column is plain TEXT (no FK to the
 *   role enum), so we can pass any string. Since the row is meant for BOTH
 *   project_manager and om_technician, we use the comma-separated string
 *   "project_manager,om_technician" — the future learner-UI is expected to
 *   `string.split(',').includes(role)`. If you'd rather seed two separate
 *   rows (one per role), pass --split.
 *
 * Usage:
 *   npx tsx scripts/seed-site-engineer-training.ts
 *   npx tsx scripts/seed-site-engineer-training.ts --dry-run
 *   npx tsx scripts/seed-site-engineer-training.ts --split   # 2 rows, one per role
 *
 * Re-run safe: looks up by title; updates the existing row (or inserts).
 */

import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

import { createClient } from '@supabase/supabase-js';
import type { Database } from '../packages/types/database';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY in .env.local');
  process.exit(1);
}

const isDryRun = process.argv.includes('--dry-run');
const split = process.argv.includes('--split');

const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

type LearningModuleInsert = Database['public']['Tables']['learning_modules']['Insert'];

// ----------------------------------------------------------------------------
// Quiz content (20 MCQs)
// ----------------------------------------------------------------------------

interface QuizQuestion {
  question: string;
  options: [string, string, string, string];
  correct_index: 0 | 1 | 2 | 3;
  /** Optional one-line rationale, used by the learner UI's "Why?" tooltip. */
  explanation?: string;
}

const QUIZ_QUESTIONS: QuizQuestion[] = [
  // ---- Attendance (2) -----------------------------------------------------
  {
    question:
      'You arrive at site for a regular workday. Which statuses can you self-mark in /hr/attendance?',
    options: [
      'present, work_from_home, half_day',
      'present, on_leave, half_day',
      'present, absent, holiday',
      'Any of the six statuses',
    ],
    correct_index: 0,
    explanation:
      'Migration 136 locks attendance_insert WITH CHECK to present / work_from_home / half_day for self-mark. on_leave and absent need leave_requests or an HR correction.',
  },
  {
    question:
      'You forgot to log in for two days last week. Can you mark yourself as "absent" for those dates?',
    options: [
      'Yes, use /hr/attendance and pick "absent"',
      'No — only HR or founder can mark absent; you have to go through them',
      'Yes, but only if you add a note explaining why',
      'Yes, the system blocks it for today but allows backdated absent',
    ],
    correct_index: 1,
    explanation:
      'The RLS policy attendance_insert restricts self-mark to present / work_from_home / half_day. absent and on_leave bypass the leave workflow, so HR/founder is the only path.',
  },

  // ---- Leave (2) ----------------------------------------------------------
  {
    question:
      'You want to take a day of casual leave tomorrow. What is the correct flow?',
    options: [
      'Mark yourself "on_leave" in /hr/attendance directly',
      'Submit a leave_request via /hr/leave; wait for HR/founder approval; ledger updates on approval',
      'Tell your PM in WhatsApp — that\'s the approval',
      'Cancel today\'s attendance row and re-mark after approval',
    ],
    correct_index: 1,
    explanation:
      'leave_requests row goes pending → approveLeaveRequest calls fn_approve_leave_request RPC (mig 136) which atomically updates the request, inserts a leave_ledger debit, and refresh_leave_balance trigger refreshes leave_balances.',
  },
  {
    question:
      'After your casual leave is approved, what happens to your leave balance?',
    options: [
      'You have to ask HR to deduct it manually',
      'leave_ledger gets a "debit" entry and the refresh_leave_balance trigger updates leave_balances automatically',
      'leave_balances is recomputed from scratch every night by cron',
      'Nothing changes — leave_balances is only updated at year-end',
    ],
    correct_index: 1,
    explanation:
      'leave_ledger uses a double-entry model. Inserting the debit row fires the refresh_leave_balance trigger which propagates balance_after into leave_balances synchronously (mig 005b + mig 136).',
  },

  // ---- Project milestone status (2) --------------------------------------
  {
    question:
      'A project_milestones row uses which status enum?',
    options: [
      'pending, in_progress, completed, blocked, skipped',
      'todo, doing, done',
      'open, closed',
      'yet_to_start, in_progress, completed (same as projects)',
    ],
    correct_index: 0,
    explanation:
      'milestone_status enum from 004a_projects_core.sql line 45–51. Distinct from the 8-status project enum (order_received / yet_to_start / in_progress / completed / holding_shiroi / holding_client / waiting_net_metering / meter_client_scope).',
  },
  {
    question:
      'When you mark Commissioning as finalized in /projects/[id], which automation fires?',
    options: [
      'Nothing — Commissioning is purely a display field',
      'plant_monitoring_credentials get auto-upserted by fn_sync_plant_monitoring_from_commissioning and the first Free AMC contract (3 visits) is created',
      'The project status flips to completed automatically',
      'An invoice is generated for the customer',
    ],
    correct_index: 1,
    explanation:
      'om.md, "Key Business Rules": commissioning_reports UPDATE → fn_sync_plant_monitoring_from_commissioning triggers when status becomes submitted/finalized AND the 3 monitoring fields are populated. Free AMC = 3 auto visits per warranty period.',
  },

  // ---- Photo upload + GPS gate (3) ---------------------------------------
  {
    question:
      'You\'re uploading a "Panel Install Complete" photo from a site you\'re actually parked at. The app says "location too far". What did it check?',
    options: [
      'Whether your phone\'s clock matches Indian Standard Time',
      'haversine_distance_m(site_lat, site_lon, photo_lat, photo_lon) > 100 m',
      'Whether your IP address is in Chennai',
      'Whether you have a valid certification',
    ],
    correct_index: 1,
    explanation:
      'uploadMilestonePhoto runs haversine_distance_m RPC (mig 127). If distance > 100 m, location_verified = false; the photo still uploads but is flagged. LOCATION_GATE_METERS = 100 in milestone-photos-actions.ts.',
  },
  {
    question:
      'Which set of milestones can you record photos for? (milestone_photos.milestone CHECK constraint)',
    options: [
      'survey / boi_approved / dispatch / commissioning / handover',
      'panel_install_start / panel_install_complete / inverter_install / commissioning / post_commissioning',
      'kickoff / midpoint / endpoint',
      'Any free-text milestone — the field is open',
    ],
    correct_index: 1,
    explanation:
      'CHECK constraint in mig 127. getMissingMilestones returns the subset of these 5 that have no photo yet.',
  },
  {
    question:
      'The milestone photo gate distance threshold is:',
    options: ['25 m', '50 m', '100 m', '500 m'],
    correct_index: 2,
    explanation:
      'LOCATION_GATE_METERS = 100 in milestone-photos-actions.ts. Photos farther than this still save (field conditions vary) but with location_verified = false.',
  },

  // ---- Cut-length tracking (2) -------------------------------------------
  {
    question:
      'Where do you log "cut 12 m of DC cable today" on a project?',
    options: [
      '/inventory — pick the project from the dropdown',
      '/projects/[id]?tab=materials — Cut Length tab; recordCutLength server action writes to inventory_cut_records',
      'Daily site report textarea',
      'WhatsApp the PM the length',
    ],
    correct_index: 1,
    explanation:
      'CutLengthTab at /projects/[id]?tab=materials writes inventory_cut_records rows (mig 121). get_project_cable_summary RPC powers the summary strip.',
  },
  {
    question:
      'Why do we record cut lengths at all? (business reason)',
    options: [
      'To bill the customer per metre',
      'To reconcile actuals vs BOM, calculate offcut waste, and seed correction_factors that improve future quote accuracy',
      'TNEB requires it for net metering',
      'For the warranty card',
    ],
    correct_index: 1,
    explanation:
      'projects.md + inventory.md: cut records feed bom_actual_vs_budgetary (mig 128) which nightly cron uses to compute correction_factor for future quoting.',
  },

  // ---- Completion % (2) --------------------------------------------------
  {
    question:
      'The /projects/[id]?tab=completion Progress tab uses 10 weighted components. What is the heaviest weight?',
    options: [
      'site_preparation = 25',
      'panel_installation = 25',
      'commissioning = 25',
      'handover = 25',
    ],
    correct_index: 1,
    explanation:
      'COMPONENT_WEIGHTS in project-completion-constants.ts: panel_installation = 25, structure_mounting = 20, inverter_installation = 15, dc_wiring = ac_wiring = 10, site_preparation = earthing = net_metering_applied = commissioning = 5, handover = 0.',
  },
  {
    question:
      'You\'ve ticked every component on the Progress checklist except handover. What % does the project show?',
    options: ['100%', '95%', '90%', '80%'],
    correct_index: 1,
    explanation:
      'get_project_completion_pct RPC weights sum to 95 (handover has weight 0). Handover is a milestone marker only — ticking it doesn\'t add %.',
  },

  // ---- Document upload (1) -----------------------------------------------
  {
    question:
      'When you drag-drop a Roof Layout PDF onto the project Documents tab, where does the file actually live?',
    options: [
      'Saved as a BYTEA blob in the documents table',
      'Supabase Storage (project-files bucket); the DB only stores the storage path string',
      'On the n8n droplet at /var/uploads',
      'In your browser\'s local storage',
    ],
    correct_index: 1,
    explanation:
      'NEVER-DO rule #7: never store files in the database. Storage holds the file, the DB row holds the path. Drag-drop recategorisation uses storage.move() which is an UPDATE on storage.objects (mig 047 added the UPDATE RLS policy).',
  },

  // ---- Handover pack PDF (2) ---------------------------------------------
  {
    question:
      'When should you click "Generate Handover Pack" on a project?',
    options: [
      'As soon as the BOQ is locked',
      'Right after Material Delivery is complete',
      'After Commissioning is finalized — the PDF embeds commissioned_date, panel/inverter specs, and warranty terms',
      'When the customer asks; otherwise never',
    ],
    correct_index: 2,
    explanation:
      'generateHandoverPackPdf in handover-pdf-actions.ts pulls commissioned_date and the system_config; pre-commissioning the data is incomplete. The action is gated to founder + project_manager.',
  },
  {
    question:
      'How many pages is the Handover Pack PDF and what\'s on them?',
    options: [
      '1 page: cover only',
      '2 pages: cover + warranty',
      '3 pages: Cover, System Summary + Performance + Warranty, O&M Instructions + Contacts + Signature block',
      '5 pages: cover, system, warranty, instructions, contacts',
    ],
    correct_index: 2,
    explanation:
      'apps/erp/src/lib/pdf/handover/handover-pack-pdf.tsx renders CoverPage + SystemPage + InstructionsPage. Upload to project-files/handover-packs/, returns 1-hour signed URL.',
  },

  // ---- DC certificate signing (1) ----------------------------------------
  {
    question:
      'You\'ve recorded a DC Completion certificate signature in the Certificates tab. What does that lock?',
    options: [
      'Nothing — you can re-sign whenever',
      'A second signDcCertificate call for the same (project_id, certificate_type) is rejected — the certificate is immutable once signed_at is set (app + RLS gate)',
      'The whole project — no further edits allowed',
      'Only the customer phone field',
    ],
    correct_index: 1,
    explanation:
      'dc-certificate-actions.ts:50-68 returns err("already signed") when signed_at IS NOT NULL. Mig 137 added the DB-level USING (signed_at IS NULL) WITH CHECK (signed_at IS NULL) on dc_certs_update.',
  },

  // ---- O&M ticket creation (1) -------------------------------------------
  {
    question:
      'A panel got cracked at a commissioned site. You create a ticket in /om/tickets. What severity should you use to get the 4-hour SLA?',
    options: ['low', 'medium', 'high', 'critical'],
    correct_index: 3,
    explanation:
      'om.md: SLA = critical → 4h, high → 24h, medium → 48h, low → 72h. om_service_tickets.severity has 4 values (low/medium/high/critical) from 005d_om.sql line 370. ticket_number format: TKT-001 padStart(3,"0").',
  },

  // ---- Inverter healthcheck + recent failures (2) ------------------------
  {
    question:
      'You click "Ping" on an inverter row in /om/inverters. What does it actually do?',
    options: [
      'Sends an ICMP ping to the inverter\'s IP',
      'Calls healthCheckInverter which resolves per-brand credentials (Growatt from plant_monitoring_credentials, Sungrow from inverter_monitoring_credentials.config) and runs a one-shot API call via the brand adapter',
      'Restarts the inverter remotely',
      'Triggers a manual rollup of inverter_readings',
    ],
    correct_index: 1,
    explanation:
      'inverters-actions.ts:155–243 healthCheckInverter. Growatt reads username/password from plant_monitoring_credentials matched by project_id; Sungrow uses the master OAuth token in inverter_monitoring_credentials.config.access_token.',
  },
  {
    question:
      'You see a "Recent poll failures" red box at the bottom of /om/inverters. What should you do first?',
    options: [
      'Ignore — these are auto-retried',
      'Read the error_message and timestamp for each row; common fixes are re-authorising the brand credential under /om/plant-monitoring or adding missing plant_monitoring_credentials for the project',
      'Delete the inverter row',
      'Re-create the partition table',
    ],
    correct_index: 1,
    explanation:
      'RecentFailures lists inverter_poll_failures (mig 050 lines 320–330) — the inverter-poll Edge Function logs every error with error_message and http_status. The fix is almost always credentials.',
  },
];

// Sanity check: 20 questions exactly
if (QUIZ_QUESTIONS.length !== 20) {
  console.error(
    `[seed-site-engineer-training] Expected 20 questions, got ${QUIZ_QUESTIONS.length}. Aborting.`,
  );
  process.exit(1);
}

// ----------------------------------------------------------------------------
// Module body (markdown)
// ----------------------------------------------------------------------------

const BODY_MD = `# Project Execution & Operations — Shiroi ERP

This module trains site engineers (project managers and O&M technicians) on the
daily-driver ERP surfaces. It assumes you can log in to https://erp.shiroienergy.com
and have a role of \`project_manager\` or \`om_technician\`.

## What you need to know cold

1. **Attendance** — Self-mark only \`present\` / \`work_from_home\` / \`half_day\` on
   \`/hr/attendance\`. \`absent\` and \`on_leave\` go through HR or the leave workflow.
2. **Leave** — Apply via \`/hr/leave\`. Approval inserts a \`leave_ledger\` debit
   atomically; \`leave_balances\` updates by trigger. You can cancel your own
   pending requests.
3. **Project milestones** — 9 standard milestones (advance_payment, material_delivery,
   structure_installation, panel_installation, electrical_work, testing_commissioning,
   civil_work, net_metering, handover) with status enum
   \`pending / in_progress / completed / blocked / skipped\`.
4. **Site photos** — Upload via the milestone-photos action. GPS coordinates from
   the browser are compared to the project's \`site_latitude\` / \`site_longitude\`
   via \`haversine_distance_m\`; > 100 m sets \`location_verified = false\`.
5. **Cut-length tracking** — Record cable / conduit cuts on the Materials tab so
   actuals reconcile against BOM and correction factors improve future quotes.
6. **Project Completion %** — Tick the 10 weighted components on the Progress tab.
   Weights total 95 + handover (0); 100% means all 10 ticked.
7. **Documents** — Drag-drop into the right category on the Documents tab. Files
   go to Supabase Storage; the DB only holds the path. Never paste files into a
   column.
8. **Handover pack** — After commissioning is finalized, click Generate. The PDF
   is 3 pages (Cover, System & Performance & Warranty, O&M & Contacts &
   Signature) and the action returns a 1-hour signed download URL.
9. **DC certificates** — Recording a signature on the Certificates tab is
   irreversible at both app and DB layers. Get the customer name and phone right
   the first time.
10. **O&M tickets** — Severity drives SLA: critical 4h, high 24h, medium 48h,
    low 72h. Ticket numbers are sequential (TKT-001, TKT-002, …).
11. **Inverter healthcheck** — Click "Ping" per row in \`/om/inverters\`. If it
    fails for a Growatt unit, the fix is almost always missing
    \`plant_monitoring_credentials\` for that project.
12. **Recent poll failures** — Bottom strip of \`/om/inverters\`. Read the error
    message; re-authorize the brand credential under \`/om/plant-monitoring\` or
    add the per-project plant_monitoring credentials.

## Pass criterion

Score at least ${'60'}% on the quiz below.
`;

// ----------------------------------------------------------------------------
// Insert / upsert
// ----------------------------------------------------------------------------

async function seedModule(targetRole: string, titleSuffix = ''): Promise<void> {
  const title = `Project Execution & Operations — Shiroi ERP${titleSuffix}`;

  const row: LearningModuleInsert = {
    title,
    body_md: BODY_MD,
    category: 'technical',
    target_role: targetRole,
    difficulty: 'intermediate',
    onboarding_track: 'install',
    sequence_order: 10,
    quiz_questions: QUIZ_QUESTIONS as unknown as LearningModuleInsert['quiz_questions'],
    pass_score_pct: 60,
    language: 'en',
    active: true,
  };

  console.log(`\n--- Seeding module ---`);
  console.log(`  title       : ${row.title}`);
  console.log(`  target_role : ${row.target_role}`);
  console.log(`  category    : ${row.category}`);
  console.log(`  track       : ${row.onboarding_track}`);
  console.log(`  questions   : ${QUIZ_QUESTIONS.length}`);
  console.log(`  pass score  : ${row.pass_score_pct}%`);

  if (isDryRun) {
    console.log('  [DRY RUN] Skipping DB write');
    return;
  }

  // Re-run safe: look up by title; update if exists; insert otherwise.
  const { data: existing, error: lookupErr } = await supabase
    .from('learning_modules')
    .select('id')
    .eq('title', title)
    .eq('target_role', targetRole)
    .maybeSingle();

  if (lookupErr) {
    console.error(`  Lookup failed: ${lookupErr.message}`);
    process.exit(1);
  }

  if (existing) {
    const { error: updateErr } = await supabase
      .from('learning_modules')
      .update(row)
      .eq('id', existing.id);
    if (updateErr) {
      console.error(`  Update failed: ${updateErr.message}`);
      process.exit(1);
    }
    console.log(`  [OK] Updated existing row id=${existing.id}`);
  } else {
    const { data: inserted, error: insertErr } = await supabase
      .from('learning_modules')
      .insert(row)
      .select('id')
      .single();
    if (insertErr || !inserted) {
      console.error(`  Insert failed: ${insertErr?.message ?? 'unknown'}`);
      process.exit(1);
    }
    console.log(`  [OK] Inserted new row id=${inserted.id}`);
  }
}

async function main(): Promise<void> {
  console.log('[seed-site-engineer-training] Starting');
  console.log(`  Supabase URL : ${SUPABASE_URL}`);
  console.log(`  Dry run      : ${isDryRun}`);
  console.log(`  Split rows   : ${split}`);

  if (split) {
    await seedModule('project_manager', ' (PM)');
    await seedModule('om_technician', ' (O&M)');
  } else {
    // Single row, comma-separated multi-role target_role.
    await seedModule('project_manager,om_technician');
  }

  console.log('\n[seed-site-engineer-training] Done.');
}

main().catch((e) => {
  console.error('Fatal:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
