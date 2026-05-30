/**
 * seed-site-engineer-faq.ts
 *
 * Seeds 50 site-engineer Q&A pairs into rag_chunks so the AI assistant can
 * answer the most common questions a project_manager or om_technician asks.
 *
 * Each Q&A pair becomes one row in `rag_chunks`:
 *   - source_type  = 'module_doc'   (one of the existing allowed values in
 *                                    the rag_chunks CHECK constraint, mig 138)
 *   - source_path  = 'docs/training/site-engineer-faq.md'  (single canonical
 *                                    source so the chunks group together)
 *   - chunk_index  = 0..49          (sequential, used by UNIQUE(source_path,
 *                                    chunk_index))
 *   - content      = "Q: ...\nA: ..." (Q + A joined so both retrieve well)
 *   - heading_path = ['Site Engineer FAQ', <topic>]
 *   - metadata     = { topic, question, answer }
 *   - embedding    = 1024-dim Jina v3 vector
 *
 * The script re-uses the existing scripts/rag/embed.ts helper (Jina primary,
 * Cohere fallback) so it picks up the same JINA_API_KEY / COHERE_API_KEY
 * env vars as `pnpm rag:ingest-docs`.
 *
 * Required env:
 *   NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL)
 *   SUPABASE_SECRET_KEY      (service role — needed because rag_chunks is
 *                             writable only via service_role policy)
 *   JINA_API_KEY             (required; Cohere fallback if Jina fails)
 *
 * Usage:
 *   npx tsx scripts/seed-site-engineer-faq.ts
 *   npx tsx scripts/seed-site-engineer-faq.ts --dry-run     # no DB write
 *   npx tsx scripts/seed-site-engineer-faq.ts --no-embed    # also no Jina call
 *
 * Re-run safe: uses UPSERT on (source_path, chunk_index) — the n-th chunk
 * for this source_path always wins.
 */

import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

import * as crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { embed } from './rag/embed';
import type { Database } from '../packages/types/database';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY in .env.local');
  process.exit(1);
}

const isDryRun = process.argv.includes('--dry-run');
const noEmbed = process.argv.includes('--no-embed');

const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

type RagChunkInsert = Database['public']['Tables']['rag_chunks']['Insert'];

const SOURCE_TYPE = 'module_doc';
const SOURCE_PATH = 'docs/training/site-engineer-faq.md';

// ----------------------------------------------------------------------------
// 50 Q&A pairs, grouped by topic.
//
// Topic order = chunk_index ordering. Topics:
//   Attendance (6) · Leave (6) · Project Milestones (5) · Photos & GPS (6) ·
//   Documents & Storage (4) · Completion % (5) · Handover Pack (4) ·
//   DC Certificates (3) · Cut-Length Tracking (3) · O&M Tickets (4) ·
//   Inverters & Plant Monitoring (4)
// Total = 50.
// ----------------------------------------------------------------------------

interface FaqPair {
  topic: string;
  question: string;
  answer: string;
}

const FAQ: FaqPair[] = [
  // ---- Attendance (6) -----------------------------------------------------
  {
    topic: 'Attendance',
    question: 'How do I mark today\'s attendance?',
    answer:
      'Open /hr/attendance, find your row, click today\'s cell, and pick "present", "work_from_home", or "half_day". You can only self-mark those three statuses; the system blocks "absent" and "on_leave" for self-mark by RLS.',
  },
  {
    topic: 'Attendance',
    question: 'Why can\'t I mark myself absent?',
    answer:
      'Migration 136 added a CHECK on the attendance_insert RLS policy that restricts employee self-mark to "present", "work_from_home", and "half_day". "absent" goes through HR; "on_leave" must come from an approved leave_request.',
  },
  {
    topic: 'Attendance',
    question: 'I forgot to mark attendance for a day last week — can I add it now?',
    answer:
      'Yes — click the empty cell for that date in /hr/attendance and pick one of the self-mark statuses. If the day should be "absent" or "on_leave", ask HR or the founder to mark it for you.',
  },
  {
    topic: 'Attendance',
    question: 'What does "WFH" mean in the legend?',
    answer:
      '"WFH" is the short label for status "work_from_home". You\'ll also see P (present), A (absent), L (on_leave), ½ (half_day), and H (holiday).',
  },
  {
    topic: 'Attendance',
    question: 'How is my monthly attendance % calculated?',
    answer:
      'In /hr/attendance the right-most column shows P% for the month = (present + work_from_home + half_day×0.5) ÷ total_marked_days × 100. It\'s greyed out until at least one day is marked.',
  },
  {
    topic: 'Attendance',
    question: 'Can someone else mark attendance for me?',
    answer:
      'Only HR (hr_manager role) or the founder can mark attendance for another employee, and only they can use any status. Everyone else is locked to self-mark with the three "I\'m at work" statuses.',
  },

  // ---- Leave (6) ----------------------------------------------------------
  {
    topic: 'Leave',
    question: 'How do I request leave for tomorrow?',
    answer:
      'Go to /hr/leave (or the leave request form on your employee page), pick the leave_type (casual, sick, earned, etc.), set from_date and to_date, and submit. The status starts at "pending" and HR / founder approves it.',
  },
  {
    topic: 'Leave',
    question: 'Where do I see my leave balance?',
    answer:
      'Your own balance shows on /hr/employees/[your-id] (or wherever the dashboard surfaces get_leave_balances_for_employee). The number per type — casual, sick, earned, comp off — is read from leave_balances, which is auto-refreshed by trigger after every ledger entry.',
  },
  {
    topic: 'Leave',
    question: 'How is leave taken from my balance?',
    answer:
      'When HR approves your request, fn_approve_leave_request RPC runs atomically: it updates the leave_request row to "approved", inserts a "debit" entry in leave_ledger with the days as negative, and the refresh_leave_balance trigger updates leave_balances. Nothing is computed at read time.',
  },
  {
    topic: 'Leave',
    question: 'Can I cancel my own leave request?',
    answer:
      'Yes — if the request is still "pending", click Cancel. cancelLeaveRequest verifies you own the request and that status === "pending" before flipping it to "cancelled". Once it\'s approved, only HR can reverse it.',
  },
  {
    topic: 'Leave',
    question: 'My manager rejected my leave. Where do I see why?',
    answer:
      'The rejected_reason text is stored on the leave_requests row when HR/founder rejects it (a reason is required by rejectLeaveRequest). It shows in the list at /hr/leave/all under your request row.',
  },
  {
    topic: 'Leave',
    question: 'What\'s the difference between leave_ledger and leave_balances?',
    answer:
      'leave_ledger is the double-entry source of truth — immutable rows for opening_balance, accrual, debit, reversal, adjustment, lapse, encashment. leave_balances is a per-employee-per-type summary refreshed from the ledger by trigger. Disputes are resolved by reading the ledger, never by editing leave_balances.',
  },

  // ---- Project Milestones (5) ---------------------------------------------
  {
    topic: 'Project Milestones',
    question: 'How do I mark a project milestone complete?',
    answer:
      'Open the project (/projects/[id]), go to the Execution tab, find the milestone row, and toggle the status field from "in_progress" → "completed". The five status values are pending / in_progress / completed / blocked / skipped (milestone_status enum, mig 004a).',
  },
  {
    topic: 'Project Milestones',
    question: 'What happens when I mark commissioning as finalized?',
    answer:
      'Two things fire automatically: (1) fn_sync_plant_monitoring_from_commissioning upserts plant_monitoring_credentials when status becomes submitted/finalized and the 3 monitoring fields are filled, and (2) the first Free AMC contract is auto-created with 3 scheduled visits.',
  },
  {
    topic: 'Project Milestones',
    question: 'Why are some milestones marked "payment gate"?',
    answer:
      'is_payment_gate=true on a project_milestones row means completing that milestone unlocks an invoice. Gate 1 = material_delivery (40% invoice), Gate 2 = mid-installation PM visit, Gate 3 = pre-commissioning QC (commissioning invoice 20%).',
  },
  {
    topic: 'Project Milestones',
    question: 'My milestone says "blocked" — what do I do?',
    answer:
      'Open the milestone in /projects/[id]/Execution and read blocked_reason and blocked_since on the row. Resolve the issue (e.g. customer payment, material arrival, weather) and toggle status back to "in_progress" so the gate doesn\'t hold up downstream work.',
  },
  {
    topic: 'Project Milestones',
    question: 'How do I see all 9 standard milestones for a project?',
    answer:
      'On /projects/[id]/Execution you\'ll see project_milestones rows (one per CHECK value: advance_payment, material_delivery, structure_installation, panel_installation, electrical_work, testing_commissioning, civil_work, net_metering, handover). They\'re auto-seeded when the project is created from an accepted proposal.',
  },

  // ---- Photos & GPS (6) ---------------------------------------------------
  {
    topic: 'Photos & GPS',
    question: 'How do I upload a site photo?',
    answer:
      'Use the milestone photo uploader on the project detail page. Pick the milestone (panel_install_start / panel_install_complete / inverter_install / commissioning / post_commissioning), allow browser geolocation, and select the file. uploadMilestonePhoto stores it under documents/milestone-photos/{project_number}/{milestone}/.',
  },
  {
    topic: 'Photos & GPS',
    question: 'Why does the photo upload say location too far?',
    answer:
      'The server compares your phone\'s GPS coordinates to the project\'s site_latitude / site_longitude using haversine_distance_m (SQL function added in mig 127). If the distance is > 100 m, location_verified is set to false and you get a warning. The photo still saves so field conditions don\'t block you.',
  },
  {
    topic: 'Photos & GPS',
    question: 'What does the GPS gate check?',
    answer:
      'It compares two lat/lon pairs: the project\'s site_latitude / site_longitude and the photo\'s latitude / longitude (from the browser geolocation API). haversine_distance_m returns the great-circle distance in metres; > 100 m fails the gate.',
  },
  {
    topic: 'Photos & GPS',
    question: 'My phone has GPS off. Can I still upload?',
    answer:
      'Yes — uploadMilestonePhoto accepts null latitude / longitude. In that case location_verified is null (not false) and location_distance_m is null. The photo uploads to documents bucket and the milestone_photos row is created.',
  },
  {
    topic: 'Photos & GPS',
    question: 'Which milestones can I upload photos for?',
    answer:
      'Five: panel_install_start, panel_install_complete, inverter_install, commissioning, post_commissioning. These come from the milestone_photos.milestone CHECK constraint in mig 127. getMissingMilestones tells you which of the five are still missing for a project.',
  },
  {
    topic: 'Photos & GPS',
    question: 'Where are the milestone photos stored?',
    answer:
      'In Supabase Storage, in the "documents" bucket, at path documents/milestone-photos/{project_number}/{milestone}/{uuid}.{ext}. The DB row in milestone_photos has the storage_path; never the file bytes.',
  },

  // ---- Documents & Storage (4) -------------------------------------------
  {
    topic: 'Documents & Storage',
    question: 'How do I upload a project document?',
    answer:
      'Open /projects/[id], go to the Documents tab, and drag-drop the file into the right category card (Site Photo, Survey Report, Roof Layout, Proposal PDF, Invoice, etc.). It uploads to the project-files or site-photos bucket; the DB only stores the storage path.',
  },
  {
    topic: 'Documents & Storage',
    question: 'I dragged a PDF into the wrong category — can I move it?',
    answer:
      'Yes — drag-drop to the new category. The Documents tab uses Supabase Storage .move() to recategorise (which is an UPDATE on storage.objects). If you see "Object not found" it usually means the UPDATE RLS policy is missing — that was fixed in mig 047 (project-files) and mig 054 (site-photos).',
  },
  {
    topic: 'Documents & Storage',
    question: 'What file types can I upload to a project?',
    answer:
      'The Documents tab accepts the common ones: PDF, JPG/JPEG, PNG, DWG, DXF, XLSX, CSV. Files go to the project-files bucket for paperwork and site-photos bucket for images (QC photos always go to site-photos under projects/{id}/qc/).',
  },
  {
    topic: 'Documents & Storage',
    question: 'Where is the file actually stored once I upload?',
    answer:
      'Supabase Storage. The DB row only has a path string (NEVER-DO rule #7). For project-files: project-files/{whatever-path}. For QC photos: site-photos/projects/{id}/qc/{section}_{ts}.{ext}. For milestone photos: documents/milestone-photos/{project_number}/{milestone}/.',
  },

  // ---- Completion % (5) ---------------------------------------------------
  {
    topic: 'Completion %',
    question: 'What does completion % include?',
    answer:
      'Ten components on the Progress tab (project_completion_items), weighted: panel_installation 25, structure_mounting 20, inverter_installation 15, dc_wiring 10, ac_wiring 10, site_preparation 5, earthing 5, net_metering_applied 5, commissioning 5, handover 0. Sums to 95 + handover (marker only).',
  },
  {
    topic: 'Completion %',
    question: 'I ticked everything but the bar shows 95%, not 100%. Why?',
    answer:
      'Handover has weight 0 — it\'s a milestone marker, not a weighted component. The other 9 sum to 95. Tick handover too and the bar reads 95% (because handover\'s weight is 0); the get_project_completion_pct RPC is intentionally capped at 95 once everything else is done.',
  },
  {
    topic: 'Completion %',
    question: 'Who can tick completion items?',
    answer:
      'founder, project_manager, and site_supervisor — see the completion_items_insert / completion_items_update RLS policies in mig 121. Everyone authenticated can read; only those three can mutate.',
  },
  {
    topic: 'Completion %',
    question: 'How do I roll back a component I ticked by mistake?',
    answer:
      'Click the green tick again. markComponentIncomplete clears completed_at and completed_by — but only if you have the rollback right (founder / project_manager / site_supervisor). The completion % recomputes via get_project_completion_pct.',
  },
  {
    topic: 'Completion %',
    question: 'Where is the completion % computed?',
    answer:
      'In SQL via the get_project_completion_pct(project_id) RPC. The weights are hard-coded in that function and mirrored in apps/erp/src/lib/project-completion-constants.ts so the bar in the React UI matches the RPC value.',
  },

  // ---- Handover Pack (4) -------------------------------------------------
  {
    topic: 'Handover Pack',
    question: 'How do I generate the handover PDF?',
    answer:
      'On /projects/[id]/Certificates click "Generate Handover Pack". generateHandoverPackPdf renders the 3-page PDF in-process, uploads to project-files/handover-packs/{id}/, records the storage path in projects.handover_pdf_path, and returns a 1-hour signed download URL.',
  },
  {
    topic: 'Handover Pack',
    question: 'What\'s in the handover PDF?',
    answer:
      '3 pages. Page 1 (Cover): customer name, site address, project number, system size, commissioned date. Page 2 (System): brand/model of panels & inverter, performance estimate (Chennai 1450 kWh/kWp/year default), warranty summary. Page 3 (Instructions): O&M instructions, emergency contacts, documents checklist, signature block.',
  },
  {
    topic: 'Handover Pack',
    question: 'When should I generate the handover pack?',
    answer:
      'Only after commissioning is finalized — the PDF pulls commissioned_date from the projects row, and pre-commissioning the date is null. The action is gated to founder + project_manager.',
  },
  {
    topic: 'Handover Pack',
    question: 'How does the customer get the handover PDF?',
    answer:
      'You share the signed URL the action returns (valid 1 hour). For a longer-lived link, call getHandoverPackDownloadUrl again — it re-signs the same storage path. The customer never sees the bucket directly.',
  },

  // ---- DC Certificates (3) -----------------------------------------------
  {
    topic: 'DC Certificates',
    question: 'How do I sign a DC certificate?',
    answer:
      'On /projects/[id]/Certificates pick the certificate type (dc_completion / handing_over / net_metering_submission), type the customer\'s name and phone, then click Sign. signDcCertificate writes the row with signed_at = now() and the certificate is locked.',
  },
  {
    topic: 'DC Certificates',
    question: 'I signed a DC certificate with the wrong customer name — can I re-sign?',
    answer:
      'No. Once signed_at is set, the certificate is immutable. The app-level gate in dc-certificate-actions.ts returns an error and the DB-level gate (mig 137: USING (signed_at IS NULL) WITH CHECK (signed_at IS NULL) on dc_certs_update) also rejects the write. Ask the founder to use service-role to correct it.',
  },
  {
    topic: 'DC Certificates',
    question: 'Which certificate types are there?',
    answer:
      'Three: dc_completion (the system is electrically complete), handing_over (system handed over to customer), net_metering_submission (paperwork submitted to discom for net metering). UNIQUE on (project_id, certificate_type) — one of each per project.',
  },

  // ---- Cut-Length Tracking (3) -------------------------------------------
  {
    topic: 'Cut-Length Tracking',
    question: 'Where do I record cable cut lengths?',
    answer:
      'On /projects/[id]?tab=materials click "Record Cut". Pick material_type (dc_cable / ac_cable / earthing_wire / conduit_pvc / conduit_gi / other), enter specification, length in metres, optional rolls count, and project stage. recordCutLength writes to inventory_cut_records.',
  },
  {
    topic: 'Cut-Length Tracking',
    question: 'Why do we record cut lengths?',
    answer:
      'To track actual material consumption vs the BOM estimate. The data feeds bom_actual_vs_budgetary (mig 128) and the nightly cron computes correction_factor to improve future BOM accuracy. It also gives the PM real-time site visibility on cable waste.',
  },
  {
    topic: 'Cut-Length Tracking',
    question: 'How do I see total cable used on this project?',
    answer:
      'The summary strip at the top of the Materials tab shows totals per material_type from the get_project_cable_summary RPC. For example: 142.5 m DC Cable · 86 m AC Cable · 28 m Earthing Wire.',
  },

  // ---- O&M Tickets (4) ---------------------------------------------------
  {
    topic: 'O&M Tickets',
    question: 'How do I create an O&M ticket?',
    answer:
      'Open /om/tickets, click + New Ticket, pick the project, set issue_type (no_generation / low_generation / inverter_fault / panel_damage / wiring_issue / etc.), set severity (low / medium / high / critical), write the title + description, optionally assign an engineer. ticket_number is auto-assigned (TKT-001, TKT-002, …).',
  },
  {
    topic: 'O&M Tickets',
    question: 'What\'s the SLA for each severity?',
    answer:
      'Critical 4h, High 24h, Medium 48h, Low 72h. The sla_deadline column gets stamped on insert; sla_breached flips to true once the deadline passes without resolution. The dashboard colour-codes breaches.',
  },
  {
    topic: 'O&M Tickets',
    question: 'How do I close a ticket once the fix is done?',
    answer:
      'On /om/tickets toggle status from "in_progress" → "resolved". That auto-sets resolved_at and resolved_by. Once the customer confirms, flip "resolved" → "closed" (auto-sets closed_at). Both transitions are inline on the row.',
  },
  {
    topic: 'O&M Tickets',
    question: 'Where do I see my SLAs?',
    answer:
      'For per-project profitability and SLA compliance, founders and om_technicians can open /om/profitability — the table shows ticket count, parts cost, service revenue, profit/loss, and SLA compliance % per project (from the get_om_profitability RPC, mig 128).',
  },

  // ---- Inverters & Plant Monitoring (4) ----------------------------------
  {
    topic: 'Inverters',
    question: 'How do I run an inverter healthcheck?',
    answer:
      'Open /om/inverters. For each row you\'ll see a "Ping" button. Click it; healthCheckInverter resolves the brand credential (Growatt from plant_monitoring_credentials for the project; Sungrow from inverter_monitoring_credentials.config.access_token), calls the brand adapter, and shows a ✓ or ✗ next to the button.',
  },
  {
    topic: 'Inverters',
    question: 'Why is the inverter healthcheck failing?',
    answer:
      'Most common causes: (1) no plant_monitoring_credentials row for the project (Growatt), (2) Sungrow access_token expired — re-authorize at /om/plant-monitoring, (3) inverter physically offline (router or modem issue at site), (4) brand API quota exhausted. Read the message next to the ✗ for the exact reason.',
  },
  {
    topic: 'Inverters',
    question: 'There\'s a red "Recent poll failures" box at the bottom of /om/inverters. What should I do?',
    answer:
      'Read each row\'s error_message and timestamp. The fix is almost always credential-related: re-authorize the brand under /om/plant-monitoring, or add a missing plant_monitoring_credentials row for that project. The poll Edge Function logs every error to inverter_poll_failures (mig 050).',
  },
  {
    topic: 'Inverters',
    question: 'I see no readings for an inverter. Where do they come from?',
    answer:
      'Readings come from the inverter-poll Edge Function on a cron schedule — it dispatches per-brand adapters and writes to inverter_readings (partitioned monthly). The frontend never queries inverter_readings directly; it reads inverter_readings_hourly / _daily rollups (mig 050). No readings usually means poll failures or credentials missing.',
  },
];

// Sanity check: 50 pairs exactly
if (FAQ.length !== 50) {
  console.error(
    `[seed-site-engineer-faq] Expected 50 Q&A pairs, got ${FAQ.length}. Aborting.`,
  );
  process.exit(1);
}

// ----------------------------------------------------------------------------
// Build → embed → upsert
// ----------------------------------------------------------------------------

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function buildContent(pair: FaqPair): string {
  // Q+A joined so both retrieve well via cosine similarity.
  return `Q: ${pair.question}\n\nA: ${pair.answer}`;
}

async function main(): Promise<void> {
  console.log('[seed-site-engineer-faq] Starting');
  console.log(`  Supabase URL : ${SUPABASE_URL}`);
  console.log(`  Source path  : ${SOURCE_PATH}`);
  console.log(`  Q&A count    : ${FAQ.length}`);
  console.log(`  Dry run      : ${isDryRun}`);
  console.log(`  Skip embed   : ${noEmbed}`);

  const contents = FAQ.map(buildContent);

  // 1. Embed all 50 in one batch (Jina v3 limit is 100 per request).
  let vectors: number[][];
  if (noEmbed) {
    console.log('\n[--no-embed] Using zero vectors (DB write only — RAG search WILL NOT work)');
    vectors = FAQ.map(() => new Array<number>(1024).fill(0));
  } else {
    if (!process.env.JINA_API_KEY) {
      console.error(
        '\n[seed-site-engineer-faq] JINA_API_KEY is not set.\n' +
        'Add it to .env.local (free tier at https://jina.ai), or use --no-embed for a smoke-test.\n',
      );
      process.exit(1);
    }
    console.log('\n[embed] Calling Jina (1 batch of 50, ~1024-dim each)...');
    const t0 = Date.now();
    vectors = await embed(contents);
    const ms = Date.now() - t0;
    console.log(`  Done in ${ms}ms — ${vectors.length} vectors`);
  }

  // 2. Build rag_chunks rows.
  const rows: RagChunkInsert[] = FAQ.map((pair, i) => ({
    source_type: SOURCE_TYPE,
    source_path: SOURCE_PATH,
    source_id: null,
    chunk_index: i,
    content: contents[i] ?? '',
    heading_path: ['Site Engineer FAQ', pair.topic],
    metadata: {
      topic: pair.topic,
      question: pair.question,
      answer: pair.answer,
    },
    embedding: `[${(vectors[i] ?? []).join(',')}]`,
    embedding_model: noEmbed ? 'placeholder-zero' : 'jina-embeddings-v3',
    embedding_dim: 1024,
    content_hash: sha256(contents[i] ?? ''),
    last_indexed_at: new Date().toISOString(),
  }));

  if (isDryRun) {
    console.log('\n[--dry-run] First row preview:');
    console.log(JSON.stringify({ ...rows[0], embedding: '<1024-dim vector elided>' }, null, 2));
    console.log(`\n[--dry-run] Skipping ${rows.length} upserts`);
    return;
  }

  // 3. Upsert in batches of 25 (Supabase RPC payload safety; 50 also works).
  console.log('\n[upsert] Writing to rag_chunks...');
  const BATCH = 25;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error } = await supabase
      .from('rag_chunks')
      .upsert(batch, { onConflict: 'source_path,chunk_index' });
    if (error) {
      console.error(`  Batch ${i}-${i + batch.length} failed: ${error.message}`);
      process.exit(1);
    }
    console.log(`  Upserted ${i + batch.length} / ${rows.length}`);
  }

  console.log('\n[seed-site-engineer-faq] Done.');
  console.log(`  Inserted/updated ${rows.length} rag_chunks rows under ${SOURCE_PATH}.`);
  console.log('  These will surface in rag_search() results once embedded.');
}

main().catch((e) => {
  console.error('Fatal:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
