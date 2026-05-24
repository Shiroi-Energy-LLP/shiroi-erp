/**
 * voice-report-structurer.ts — Haiku-powered Tamil voice report structurer.
 *
 * Takes a raw transcript (Tamil / Tanglish / Indian English) from Sarvam ASR
 * and returns a strongly-typed StructuredVoiceReport ready to write into
 * daily_site_reports + material_requisitions.
 *
 * Used by: apps/erp/src/app/api/whatsapp/voice-report/route.ts
 * AI provider: Claude Haiku 4.5 via ai-caller.ts (honours AI_PROVIDER env)
 *
 * B1 feature — S7 Wave 1 AI roadmap (May 2026)
 *
 * NOTE: No 'use server' directive — this is a server-only utility module
 * imported by the API route, not a Next.js Server Action module.
 */

import { callAi } from './ai-caller';

// ─── Haiku 4.5 model ID ──────────────────────────────────────────────────────
const HAIKU_MODEL = 'claude-haiku-4-5';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface StructuredVoiceReportProject {
  project_id: string;
  project_number: string;
  confidence: number; // 0.0 – 1.0
}

export interface StructuredVoiceReportReport {
  workers_count: number | null;
  panels_installed_today: number | null;
  /** 'not_started' | 'columns_done' | 'rails_done' | 'bracing_done' | 'complete' */
  structure_progress: string | null;
  /** 'not_started' | 'inverter_mounted' | 'acdb_done' | 'strings_done' | 'ac_cable_done' | 'complete' */
  electrical_progress: string | null;
  /** 'sunny' | 'partly_cloudy' | 'cloudy' | 'rainy' | 'stormy' */
  weather: string | null;
  /** English prose summary of work done today */
  work_description: string;
  issues_reported: boolean;
  issue_summary: string | null;
}

export type DetectedAction =
  | {
      type: 'create_material_requisition';
      material: string;
      quantity_m?: number;
      quantity_nos?: number;
      urgency: 'normal' | 'urgent' | 'critical';
      specification?: string;
    }
  | { type: 'flag_safety_concern'; description: string }
  | { type: 'request_pm_attention'; reason: string };

export interface StructuredVoiceReport {
  project_match: StructuredVoiceReportProject | null;
  report: StructuredVoiceReportReport;
  detected_actions: DetectedAction[];
  /** 1-line English confirmation summary */
  reply_summary_en: string;
  /** 1-line Tamil confirmation summary */
  reply_summary_ta: string;
}

export interface EmployeeContext {
  employee_id: string;
  full_name: string;
  recent_projects: Array<{ id: string; number: string; customer_name: string }>;
}

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You parse Tamil/Tanglish/Indian-English site reports from Shiroi Energy field officers and return STRICT JSON.

Rules:
1. Map fuzzy progress phrases to the correct enum:
   - structure_progress: 'not_started' | 'columns_done' | 'rails_done' | 'bracing_done' | 'complete'
   - electrical_progress: 'not_started' | 'inverter_mounted' | 'acdb_done' | 'strings_done' | 'ac_cable_done' | 'complete'
   - weather: 'sunny' | 'partly_cloudy' | 'cloudy' | 'rainy' | 'stormy'
2. "80% complete", "மிக்க கொஞ்சம் left" on structure → 'bracing_done' (closest pre-complete step).
3. Detect material shortages from phrases like "கம்பி குறைவா இருக்கு" (wire is low), "rail போதல" (not enough rail). Emit create_material_requisition actions.
4. Urgency: "இன்னைக்கே வேணும்" or "urgent" → critical. "நாளைக்கு" → urgent. Default → normal.
5. If the officer mentions a project number (e.g. "SHR-124" or "124 project"), match it from recent_projects. Set confidence 0.9.
   If they mention a customer name, try to match. Set confidence 0.6.
   If no match, set project_match to null.
6. translate work_description to clean English prose. Keep it to 1–2 sentences.
7. reply_summary_en: exactly 1 line English ("12 panels installed, structure complete, wiring 60% done").
8. reply_summary_ta: exactly 1 line Tamil ("12 பேனல் பொருத்தினோம், கட்டமைப்பு முடிந்தது, வயரிங் 60% ஆனது").
9. Output ONLY raw JSON — no markdown fences, no explanation.`;

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * structureVoiceReport
 *
 * Calls Claude Haiku to parse a Tamil/Tanglish transcript into a typed report.
 *
 * @param transcript     Raw transcript from Sarvam ASR
 * @param employeeContext Employee identity + recent projects for project matching
 * @returns Parsed StructuredVoiceReport
 * @throws on AI failure or unparseable JSON (caller must handle gracefully)
 */
export async function structureVoiceReport(
  transcript: string,
  employeeContext: EmployeeContext,
): Promise<StructuredVoiceReport> {
  const op = '[structureVoiceReport]';

  const recentProjectsText = employeeContext.recent_projects.length > 0
    ? employeeContext.recent_projects
        .map(p => `  • ${p.number} — ${p.customer_name} (id: ${p.id})`)
        .join('\n')
    : '  (no recent projects on record)';

  const userMessage = `Field officer ${employeeContext.full_name} sent this voice transcript:

"${transcript}"

Recent projects they work on:
${recentProjectsText}

Return STRICT JSON matching the StructuredVoiceReport schema. No markdown, no prose.

Schema:
{
  "project_match": { "project_id": string, "project_number": string, "confidence": number } | null,
  "report": {
    "workers_count": number | null,
    "panels_installed_today": number | null,
    "structure_progress": "not_started"|"columns_done"|"rails_done"|"bracing_done"|"complete"|null,
    "electrical_progress": "not_started"|"inverter_mounted"|"acdb_done"|"strings_done"|"ac_cable_done"|"complete"|null,
    "weather": "sunny"|"partly_cloudy"|"cloudy"|"rainy"|"stormy"|null,
    "work_description": string,
    "issues_reported": boolean,
    "issue_summary": string | null
  },
  "detected_actions": [
    { "type": "create_material_requisition", "material": string, "quantity_m"?: number, "quantity_nos"?: number, "urgency": "normal"|"urgent"|"critical", "specification"?: string }
    | { "type": "flag_safety_concern", "description": string }
    | { "type": "request_pm_attention", "reason": string }
  ],
  "reply_summary_en": string,
  "reply_summary_ta": string
}`;

  const prompt = `${SYSTEM_PROMPT}\n\n${userMessage}`;

  let raw: string;
  try {
    raw = await callAi(prompt, {
      maxTokens: 1500,
      model: HAIKU_MODEL,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${op} Haiku call failed`, {
      error: msg,
      employee_id: employeeContext.employee_id,
      timestamp: new Date().toISOString(),
    });
    throw new Error(`${op} AI structuring failed: ${msg}`);
  }

  // Strip ```json fences if Haiku adds them despite instructions
  const clean = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(clean);
  } catch (e) {
    console.error(`${op} JSON parse failed`, {
      raw_prefix: clean.slice(0, 200),
      employee_id: employeeContext.employee_id,
      timestamp: new Date().toISOString(),
    });
    throw new Error(`${op} Could not parse AI response as JSON`);
  }

  // Runtime shape guard — if core fields are missing, throw clearly
  const obj = parsed as Record<string, unknown>;
  if (!obj.report || typeof obj.report !== 'object') {
    throw new Error(`${op} AI response missing required 'report' field`);
  }
  if (!Array.isArray(obj.detected_actions)) {
    // Tolerate missing array — default to empty
    obj.detected_actions = [];
  }
  if (!obj.reply_summary_en) obj.reply_summary_en = '';
  if (!obj.reply_summary_ta) obj.reply_summary_ta = '';

  return parsed as StructuredVoiceReport;
}
