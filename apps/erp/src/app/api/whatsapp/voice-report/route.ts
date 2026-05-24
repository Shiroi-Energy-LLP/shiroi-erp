/**
 * POST /api/whatsapp/voice-report
 *
 * Inbound handler for Tamil voice-to-text site reports (B1, S7).
 * Called by n8n workflow #64 via multipart/form-data.
 *
 * Two modes:
 *   1. Audio note  → transcribe → structure → store pending → reply asking YES/NO
 *   2. Text reply  → if sender has an awaiting_confirmation row:
 *                    YES  → insert daily_site_report + material_requisitions
 *                    NO   → mark rejected
 *
 * Security: x-webhook-secret header must match N8N_WEBHOOK_SECRET env var.
 *
 * NEVER-DO compliance:
 * - No inline Supabase from pages/components (#15) — this is an API route.
 * - No throw across RSC boundary (#19) — we return NextResponse, not server action.
 * - All money fields via NUMERIC(14,2) columns — no JS aggregation.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@repo/supabase/admin';
import { sarvamTranscribe } from '@/lib/ai/sarvam-client';
import { structureVoiceReport } from '@/lib/ai/voice-report-structurer';
import type { Json } from '@repo/types/database';

export const dynamic = 'force-dynamic';

// ─── Env ──────────────────────────────────────────────────────────────────────

const N8N_WEBHOOK_SECRET = process.env.N8N_WEBHOOK_SECRET;
const ERP_URL = process.env.NEXT_PUBLIC_ERP_URL ?? 'https://erp.shiroienergy.com';

// ─── Confirmation keywords ────────────────────────────────────────────────────

const YES_KEYWORDS = ['yes', 'y', 'okay', 'ok', 'சரி'];
const NO_KEYWORDS = ['no', 'cancel', 'வேண்டாம்'];

// ─── Type helpers ─────────────────────────────────────────────────────────────

interface EmployeeRow {
  id: string;
  full_name: string;
  whatsapp_number: string | null;
}

interface RecentProject {
  id: string;
  number: string;
  customer_name: string;
}

interface VoiceReportLogRow {
  id: string;
  structured_json: unknown;
  detected_actions: unknown;
  detected_project_id: string | null;
}

// ─── POST handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const op = '[POST /api/whatsapp/voice-report]';

  // ── 1. Validate webhook secret ─────────────────────────────────────────────
  const incomingSecret = req.headers.get('x-webhook-secret');
  if (!N8N_WEBHOOK_SECRET || incomingSecret !== N8N_WEBHOOK_SECRET) {
    console.warn(`${op} Invalid or missing x-webhook-secret`, {
      hasEnvSecret: Boolean(N8N_WEBHOOK_SECRET),
      timestamp: new Date().toISOString(),
    });
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // ── 2. Check SARVAM_API_KEY early (audio path only) ───────────────────────
  //     We check it here so text-reply (YES/NO) paths still work even when
  //     SARVAM_API_KEY is temporarily unset.

  // ── 3. Parse multipart form ────────────────────────────────────────────────
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${op} Failed to parse multipart form`, {
      error: msg,
      timestamp: new Date().toISOString(),
    });
    return NextResponse.json({ error: 'Invalid multipart body' }, { status: 400 });
  }

  const senderPhone = (formData.get('sender_phone') as string | null)?.trim() ?? '';
  const messageId = (formData.get('message_id') as string | null)?.trim() ?? '';
  const audioFile = formData.get('audio') as File | null;
  const textBody = (formData.get('text_body') as string | null)?.trim() ?? '';

  if (!senderPhone) {
    return NextResponse.json({ error: 'Missing sender_phone' }, { status: 400 });
  }

  const supabase = createAdminClient();

  // ── 4. Look up employee by whatsapp_number ─────────────────────────────────
  const { data: empRows, error: empErr } = await supabase
    .from('employees')
    .select('id, full_name, whatsapp_number')
    .eq('whatsapp_number', senderPhone)
    .limit(1);

  if (empErr) {
    console.error(`${op} Employee lookup failed`, {
      error: empErr.message,
      sender_phone: senderPhone,
      timestamp: new Date().toISOString(),
    });
    return NextResponse.json(
      { reply_text: 'Sorry, an internal error occurred. Please try again.' },
      { status: 200 },
    );
  }

  const employee = empRows?.[0] as EmployeeRow | undefined;

  if (!employee) {
    // Unknown number — send polite refusal (n8n will relay this as a WA reply)
    return NextResponse.json(
      {
        reply_text:
          'This number is not registered in the Shiroi ERP. Please contact your manager.',
      },
      { status: 200 },
    );
  }

  // ── 5. Is this a text reply (YES/NO confirmation)? ─────────────────────────
  if (!audioFile && textBody) {
    return handleTextReply(op, supabase, employee, senderPhone, textBody, messageId);
  }

  // ── 6. Audio path — must have a file ──────────────────────────────────────
  if (!audioFile) {
    return NextResponse.json({ error: 'Missing audio file' }, { status: 400 });
  }

  // 6a. Check SARVAM_API_KEY — fail gracefully
  if (!process.env.SARVAM_API_KEY) {
    console.error(`${op} SARVAM_API_KEY not set`, {
      sender_phone: senderPhone,
      timestamp: new Date().toISOString(),
    });
    return NextResponse.json(
      {
        reply_text:
          'Voice transcription temporarily unavailable. Please type your report at erp.shiroienergy.com',
      },
      { status: 503 },
    );
  }

  return handleAudioNote(op, supabase, employee, senderPhone, messageId, audioFile);
}

// ─── Audio note handler ───────────────────────────────────────────────────────

async function handleAudioNote(
  op: string,
  supabase: ReturnType<typeof createAdminClient>,
  employee: EmployeeRow,
  senderPhone: string,
  messageId: string,
  audioFile: File,
): Promise<NextResponse> {
  // a. Read audio bytes
  let audioBytes: Uint8Array;
  try {
    const buffer = await audioFile.arrayBuffer();
    audioBytes = new Uint8Array(buffer);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${op} Failed to read audio bytes`, {
      error: msg,
      employee_id: employee.id,
      timestamp: new Date().toISOString(),
    });
    return NextResponse.json(
      { reply_text: 'Could not read audio file. Please resend.' },
      { status: 200 },
    );
  }

  // b. Upload audio to Storage for audit
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const audioStoragePath = `${employee.id}/${timestamp}_${messageId || crypto.randomUUID()}.ogg`;

  const { error: uploadErr } = await supabase.storage
    .from('voice-reports')
    .upload(audioStoragePath, audioBytes, {
      contentType: audioFile.type || 'audio/ogg',
      upsert: false,
    });

  if (uploadErr) {
    console.error(`${op} Audio upload to Storage failed`, {
      error: uploadErr.message,
      employee_id: employee.id,
      path: audioStoragePath,
      timestamp: new Date().toISOString(),
    });
    // Non-fatal — continue without audio backup
  }

  // c. INSERT voice_report_log row (status=transcribing)
  const logId = crypto.randomUUID();
  const { error: insertErr } = await supabase.from('voice_report_log').insert({
    id: logId,
    sender_phone: senderPhone,
    sender_employee_id: employee.id,
    audio_storage_path: uploadErr ? null : audioStoragePath,
    status: 'transcribing',
    asr_provider: 'sarvam',
  });

  if (insertErr) {
    console.error(`${op} Failed to insert voice_report_log row`, {
      error: insertErr.message,
      employee_id: employee.id,
      timestamp: new Date().toISOString(),
    });
    return NextResponse.json(
      { reply_text: 'Internal error. Please try again or type your report.' },
      { status: 200 },
    );
  }

  // d. Transcribe via Sarvam
  let transcript: string;
  let asrDurationSeconds = 0;
  try {
    const asrResult = await sarvamTranscribe(audioBytes, audioFile.type || 'audio/ogg');
    transcript = asrResult.transcript;
    asrDurationSeconds = asrResult.durationSeconds;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${op} Sarvam transcription failed`, {
      error: msg,
      log_id: logId,
      employee_id: employee.id,
      timestamp: new Date().toISOString(),
    });

    await supabase
      .from('voice_report_log')
      .update({ status: 'error', error_message: `ASR failed: ${msg}` })
      .eq('id', logId);

    return NextResponse.json(
      {
        reply_text:
          'Could not transcribe your voice note. Please type your report at erp.shiroienergy.com',
      },
      { status: 200 },
    );
  }

  // Estimate Sarvam cost: ~₹0.006 per second (rough Sarvam Saaras-v2 rate)
  const asrCostInr = parseFloat((asrDurationSeconds * 0.006).toFixed(2));

  // e. UPDATE log with transcript
  await supabase
    .from('voice_report_log')
    .update({
      raw_transcript: transcript,
      asr_cost_inr: asrCostInr,
    })
    .eq('id', logId);

  // f. Fetch recent projects for this employee (for project matching)
  // projects.customer_name is a direct TEXT column (no FK to customers table — see mig 004a)
  const { data: projectRows } = await supabase
    .from('projects')
    .select('id, project_number, customer_name')
    .or(`project_manager_id.eq.${employee.id},site_supervisor_id.eq.${employee.id}`)
    .not('status', 'eq', 'completed')
    .order('created_at', { ascending: false })
    .limit(10);

  const recentProjects: RecentProject[] = (projectRows ?? []).map(
    (p: { id: string; project_number: string; customer_name: string }) => ({
      id: p.id,
      number: p.project_number,
      customer_name: p.customer_name ?? '',
    }),
  );

  // g. Structure via Haiku
  let structured: Awaited<ReturnType<typeof structureVoiceReport>>;
  try {
    structured = await structureVoiceReport(transcript, {
      employee_id: employee.id,
      full_name: employee.full_name,
      recent_projects: recentProjects,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${op} Haiku structuring failed`, {
      error: msg,
      log_id: logId,
      employee_id: employee.id,
      timestamp: new Date().toISOString(),
    });

    await supabase
      .from('voice_report_log')
      .update({ status: 'error', error_message: `Structuring failed: ${msg}` })
      .eq('id', logId);

    return NextResponse.json(
      {
        reply_text:
          'Could not process your report. Please type it at erp.shiroienergy.com',
      },
      { status: 200 },
    );
  }

  // h. UPDATE log with structured data
  const actionCount = structured.detected_actions.length;

  await supabase
    .from('voice_report_log')
    .update({
      detected_project_id: structured.project_match?.project_id ?? null,
      project_match_confidence: structured.project_match?.confidence ?? null,
      // Cast via unknown→Json to satisfy Supabase JSONB column typing
      structured_json: structured.report as unknown as Json,
      detected_actions: structured.detected_actions as unknown as Json,
      status: 'awaiting_confirmation',
    })
    .eq('id', logId);

  // i. Build Tamil+English reply
  const projectLabel = structured.project_match
    ? `(Project ${structured.project_match.project_number})`
    : '(project not identified — will need to confirm)';

  const actionNote = actionCount > 0
    ? ` + create ${actionCount} action${actionCount === 1 ? '' : 's'}`
    : '';

  const replyText = [
    `✅ கிடைத்தது / Got it ${projectLabel}:`,
    `EN: ${structured.reply_summary_en}`,
    `TA: ${structured.reply_summary_ta}`,
    '',
    `Reply *YES* to save${actionNote}, or *NO* to discard.`,
  ].join('\n');

  return NextResponse.json({ reply_text: replyText }, { status: 200 });
}

// ─── Text reply handler (YES/NO) ──────────────────────────────────────────────

async function handleTextReply(
  op: string,
  supabase: ReturnType<typeof createAdminClient>,
  employee: EmployeeRow,
  senderPhone: string,
  textBody: string,
  _messageId: string,
): Promise<NextResponse> {
  const normalised = textBody.toLowerCase().trim();

  // Find the most recent awaiting_confirmation log for this sender
  const { data: logRows, error: logErr } = await supabase
    .from('voice_report_log')
    .select('id, structured_json, detected_actions, detected_project_id')
    .eq('sender_phone', senderPhone)
    .eq('status', 'awaiting_confirmation')
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1);

  if (logErr) {
    console.error(`${op} Voice report log lookup failed`, {
      error: logErr.message,
      sender_phone: senderPhone,
      timestamp: new Date().toISOString(),
    });
    return NextResponse.json(
      { reply_text: 'Internal error. Please try again.' },
      { status: 200 },
    );
  }

  const logRow = logRows?.[0] as VoiceReportLogRow | undefined;

  if (!logRow) {
    // No pending confirmation — could be an unrelated text message
    console.info(`${op} No awaiting_confirmation log for sender`, {
      sender_phone: senderPhone,
      text: normalised.slice(0, 50),
      timestamp: new Date().toISOString(),
    });
    // Don't reply — fall through silently (avoid confusing employees)
    return NextResponse.json({ reply_text: null }, { status: 200 });
  }

  // ── YES branch ──
  const isYes = YES_KEYWORDS.some(kw => normalised === kw || normalised.startsWith(kw));
  const isNo = NO_KEYWORDS.some(kw => normalised === kw || normalised.startsWith(kw));

  if (isYes) {
    return handleConfirmYes(op, supabase, employee, logRow);
  }

  if (isNo) {
    await supabase
      .from('voice_report_log')
      .update({ status: 'rejected' })
      .eq('id', logRow.id);

    return NextResponse.json(
      {
        reply_text: '❌ Discarded / வேண்டாம். Send a new voice note if needed.',
      },
      { status: 200 },
    );
  }

  // Unrecognised text — log it and stay silent
  console.info(`${op} Unrecognised reply text — ignoring`, {
    sender_phone: senderPhone,
    text: normalised.slice(0, 80),
    log_id: logRow.id,
    timestamp: new Date().toISOString(),
  });
  return NextResponse.json({ reply_text: null }, { status: 200 });
}

// ─── YES confirmation handler ─────────────────────────────────────────────────

async function handleConfirmYes(
  op: string,
  supabase: ReturnType<typeof createAdminClient>,
  employee: EmployeeRow,
  logRow: VoiceReportLogRow,
): Promise<NextResponse> {
  const structuredReport = logRow.structured_json as {
    workers_count?: number | null;
    panels_installed_today?: number | null;
    structure_progress?: string | null;
    electrical_progress?: string | null;
    weather?: string | null;
    work_description?: string;
    issues_reported?: boolean;
    issue_summary?: string | null;
  } | null;

  const detectedActions = (logRow.detected_actions as Array<{
    type: string;
    material?: string;
    quantity_m?: number;
    quantity_nos?: number;
    urgency?: string;
    specification?: string;
    description?: string;
    reason?: string;
  }> | null) ?? [];

  const projectId = logRow.detected_project_id;

  if (!projectId) {
    return NextResponse.json(
      {
        reply_text:
          '⚠️ Could not identify the project. Please mention the project number (e.g. SHR-124) and try again.',
      },
      { status: 200 },
    );
  }

  if (!structuredReport) {
    return NextResponse.json(
      {
        reply_text: 'Internal error: no report data found. Please resend your voice note.',
      },
      { status: 200 },
    );
  }

  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Kolkata' }); // YYYY-MM-DD

  // Insert daily_site_report
  const reportId = crypto.randomUUID();
  const { error: reportInsertErr } = await supabase.from('daily_site_reports').insert({
    id: reportId,
    project_id: projectId,
    submitted_by: employee.id,
    report_date: today,
    workers_count: structuredReport.workers_count ?? 0,
    panels_installed_today: structuredReport.panels_installed_today ?? 0,
    panels_installed_cumulative: structuredReport.panels_installed_today ?? 0, // simplified; no historical sum available here
    structure_progress: structuredReport.structure_progress ?? null,
    electrical_progress: structuredReport.electrical_progress ?? null,
    weather: structuredReport.weather ?? 'sunny',
    work_description: structuredReport.work_description ?? '(voice report)',
    issues_reported: structuredReport.issues_reported ?? false,
    issue_summary: structuredReport.issue_summary ?? null,
    sync_status: 'synced',
    created_on_device_at: new Date().toISOString(),
  });

  if (reportInsertErr) {
    console.error(`${op} Failed to insert daily_site_report`, {
      error: reportInsertErr.message,
      project_id: projectId,
      employee_id: employee.id,
      log_id: logRow.id,
      timestamp: new Date().toISOString(),
    });
    return NextResponse.json(
      {
        reply_text:
          '❌ Failed to save report. Please check erp.shiroienergy.com or try again.',
      },
      { status: 200 },
    );
  }

  // Create material_requisitions for flagged actions
  const matActions = detectedActions.filter(a => a.type === 'create_material_requisition');
  let requisitionsCreated = 0;

  for (const action of matActions) {
    const items = [
      {
        description: action.material ?? 'Unknown material',
        quantity: action.quantity_m ?? action.quantity_nos ?? 1,
        unit: action.quantity_m != null ? 'm' : 'nos',
        notes: action.specification ?? null,
      },
    ];

    const { error: reqErr } = await supabase.from('material_requisitions').insert({
      project_id: projectId,
      requested_by: employee.id,
      urgency: (action.urgency as 'normal' | 'urgent' | 'critical') ?? 'normal',
      status: 'pending',
      items,
      notes: `Auto-created from voice report ${reportId}`,
    });

    if (reqErr) {
      console.error(`${op} Failed to insert material_requisition`, {
        error: reqErr.message,
        material: action.material,
        log_id: logRow.id,
        timestamp: new Date().toISOString(),
      });
      // Continue — don't fail the entire save for one requisition
    } else {
      requisitionsCreated++;
    }
  }

  // Update voice_report_log
  await supabase
    .from('voice_report_log')
    .update({
      status: 'confirmed_applied',
      daily_site_report_id: reportId,
      applied_at: new Date().toISOString(),
    })
    .eq('id', logRow.id);

  const actionSuffix = requisitionsCreated > 0
    ? ` Actions created: ${requisitionsCreated}.`
    : '';

  const replyText = [
    `✅ Saved! Report id: ...${reportId.slice(-6)}.${actionSuffix}`,
    `Web: ${ERP_URL}/projects/${projectId}`,
  ].join('\n');

  return NextResponse.json({ reply_text: replyText }, { status: 200 });
}
