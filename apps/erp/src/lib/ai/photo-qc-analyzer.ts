'use server';

/**
 * S16 — B2 Photo QC Analyzer
 *
 * Given a milestone_photos row id, downloads the photo from Supabase Storage,
 * runs Claude Sonnet vision to detect installation quality issues, and inserts
 * findings into qc_photo_findings for PM review.
 *
 * Called by:
 *  - /api/qc-photos/scan-recent (cron endpoint, runs every 2h business hours)
 *
 * Vision detects:
 *  - panel_alignment: >5° tilt deviation
 *  - cable_routing: loose cables, no conduits, tight bending radius
 *  - mms_structural: loose bolts, rust, undersized members
 *  - panel_count_mismatch: actual vs spec count
 *  - safety_concern: no rails, exposed wires, fall risk
 *  - image_quality_low: blurry / obstructed / cannot assess
 *  - no_issue: clean install, nothing to flag
 */

import { createAdminClient } from '@repo/supabase/admin';
import { emitErpEvent } from '@/lib/n8n/emit';
import type { Database } from '@repo/types/database';

const SONNET_MODEL = 'claude-sonnet-4-20250514' as const;
const MAX_TOKENS = 2048;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024; // 20 MB

export interface PhotoFinding {
  finding_type:
    | 'panel_alignment'
    | 'cable_routing'
    | 'mms_structural'
    | 'panel_count_mismatch'
    | 'safety_concern'
    | 'image_quality_low'
    | 'no_issue';
  severity: 'info' | 'warning' | 'critical';
  description: string;       // 1-2 sentence AI observation
  suggested_action: string;  // 1-line PM recommendation
  confidence_score: number;  // 0-1
}

interface ClaudeVisionResponse {
  content: Array<{ type: string; text?: string }>;
  usage?: { input_tokens: number; output_tokens: number };
}

interface ParsedFindingsResponse {
  findings: PhotoFinding[];
}

type MilestonePhotoRow = Database['public']['Tables']['milestone_photos']['Row'];
type QcPhotoFindingInsert = Database['public']['Tables']['qc_photo_findings']['Insert'];

interface ProjectContext {
  customer_name: string;
  system_size_kwp: number;
  system_type: string;
  panel_count: number;
  panel_brand: string | null;
  panel_model: string | null;
  structure_type: string | null;
}

const QC_SYSTEM_PROMPT = `You are a solar installation quality control inspector for Shiroi Energy, a solar EPC company in Chennai, Tamil Nadu.

Analyse the provided milestone photo and identify any installation quality issues. Look for:
1. Panel alignment issues (>5° tilt deviation from others, uneven rows, misaligned panels)
2. Cable routing safety (loose/dangling cables, missing conduits, overly tight bending radius, cable clutter)
3. MMS structural concerns (loose or missing bolts, rust, undersized members, inadequate support)
4. Panel count mismatch (count visible panels vs the spec count provided — flag if different)
5. Safety hazards (missing safety rails/handrails on rooftop, exposed live wires, fall risk, unsafe scaffolding)
6. Image quality issues (blurry, obstructed, or photo angle prevents proper assessment)

Return STRICT JSON in this exact format — no markdown, no explanation outside the JSON:
{
  "findings": [
    {
      "finding_type": "<one of: panel_alignment|cable_routing|mms_structural|panel_count_mismatch|safety_concern|image_quality_low|no_issue>",
      "severity": "<info|warning|critical>",
      "description": "<1-2 sentence factual observation of what you see>",
      "suggested_action": "<1-line actionable recommendation for the project manager>",
      "confidence_score": <0.0 to 1.0>
    }
  ]
}

Severity guide:
- info: cosmetic issue, document for records
- warning: should be fixed before commissioning
- critical: safety or structural risk, must be fixed immediately

Rules:
- If the install looks clean with no issues, return a single finding with finding_type="no_issue", severity="info".
- Be conservative — false positives waste PM time. Only flag issues you can clearly see.
- confidence_score: 1.0 = certain, 0.5 = possible but unclear, 0.0 = cannot tell.
- Panel count mismatch: only flag if you can clearly count panels and the number differs from the spec.
- Do NOT return empty findings array — always return at least one finding.`;

async function downloadPhotoAsBase64(
  storagePath: string,
  anthropicKey: string,
): Promise<{ base64: string; mimeType: string } | null> {
  const op = '[downloadPhotoAsBase64]';

  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from('milestone-photos')
    .download(storagePath);

  if (error || !data) {
    console.error(`${op} storage download failed`, {
      storagePath,
      error: error?.message,
      timestamp: new Date().toISOString(),
    });
    return null;
  }

  const buf = await data.arrayBuffer();
  if (buf.byteLength > MAX_IMAGE_BYTES) {
    console.warn(`${op} image too large, skipping`, {
      storagePath,
      bytes: buf.byteLength,
      timestamp: new Date().toISOString(),
    });
    return null;
  }

  // Convert to base64
  const bytes = new Uint8Array(buf);
  const CHUNK = 8192;
  const chars: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK) {
    chars.push(String.fromCharCode(...bytes.slice(i, i + CHUNK)));
  }
  const base64 = btoa(chars.join(''));

  // Infer mime type from path
  const lower = storagePath.toLowerCase();
  let mimeType = 'image/jpeg';
  if (lower.endsWith('.png')) mimeType = 'image/png';
  else if (lower.endsWith('.webp')) mimeType = 'image/webp';
  else if (lower.endsWith('.gif')) mimeType = 'image/gif';

  return { base64, mimeType };
}

async function callClaudeVision(
  anthropicKey: string,
  base64: string,
  mimeType: string,
  userPrompt: string,
): Promise<{ findings: PhotoFinding[]; tokensUsed: number } | null> {
  const op = '[callClaudeVision]';

  let response: Response;
  try {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: SONNET_MODEL,
        max_tokens: MAX_TOKENS,
        system: QC_SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: mimeType,
                  data: base64,
                },
              },
              { type: 'text', text: userPrompt },
            ],
          },
        ],
      }),
    });
  } catch (e) {
    console.error(`${op} fetch threw`, {
      error: e instanceof Error ? e.message : String(e),
      timestamp: new Date().toISOString(),
    });
    return null;
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    console.error(`${op} Anthropic API error`, {
      status: response.status,
      body: body.substring(0, 200),
      timestamp: new Date().toISOString(),
    });
    return null;
  }

  const json = (await response.json()) as ClaudeVisionResponse;
  const tokensUsed = (json.usage?.input_tokens ?? 0) + (json.usage?.output_tokens ?? 0);
  const rawText = json.content?.[0]?.text ?? '';

  if (!rawText) {
    console.error(`${op} empty response`, { timestamp: new Date().toISOString() });
    return null;
  }

  // Parse JSON from the response (Claude sometimes wraps in markdown code fences)
  let parsed: ParsedFindingsResponse;
  try {
    // Strip potential markdown fences
    const stripped = rawText.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
    parsed = JSON.parse(stripped) as ParsedFindingsResponse;
  } catch {
    console.error(`${op} failed to parse Claude JSON`, {
      rawText: rawText.substring(0, 500),
      timestamp: new Date().toISOString(),
    });
    return null;
  }

  if (!Array.isArray(parsed.findings) || parsed.findings.length === 0) {
    console.error(`${op} findings array missing or empty`, { timestamp: new Date().toISOString() });
    return null;
  }

  // Validate and clamp each finding
  const VALID_TYPES = new Set([
    'panel_alignment',
    'cable_routing',
    'mms_structural',
    'panel_count_mismatch',
    'safety_concern',
    'image_quality_low',
    'no_issue',
  ]);
  const VALID_SEVERITIES = new Set(['info', 'warning', 'critical']);

  const findings: PhotoFinding[] = parsed.findings
    .filter(
      (f): f is PhotoFinding =>
        typeof f === 'object' &&
        f !== null &&
        VALID_TYPES.has(f.finding_type) &&
        VALID_SEVERITIES.has(f.severity) &&
        typeof f.description === 'string' &&
        typeof f.suggested_action === 'string' &&
        typeof f.confidence_score === 'number',
    )
    .map((f) => ({
      ...f,
      confidence_score: Math.min(1, Math.max(0, f.confidence_score)),
    }));

  if (findings.length === 0) {
    console.error(`${op} no valid findings after validation`, { timestamp: new Date().toISOString() });
    return null;
  }

  return { findings, tokensUsed };
}

/**
 * Analyse a single milestone photo for installation QC issues.
 * Inserts findings into qc_photo_findings and emits events for warning/critical.
 */
export async function analyzeMilestonePhoto(
  milestonePhotoId: string,
): Promise<{ findings: PhotoFinding[]; ai_tokens_used: number }> {
  const op = '[analyzeMilestonePhoto]';

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    throw new Error('ANTHROPIC_API_KEY is not set — configure it in .env.local or Vercel environment variables');
  }

  const admin = createAdminClient();

  // 1. Load milestone_photos row + project context
  const { data: photoRow, error: photoErr } = await admin
    .from('milestone_photos')
    .select('id, project_id, storage_path, milestone, uploaded_at')
    .eq('id', milestonePhotoId)
    .maybeSingle();

  if (photoErr) {
    console.error(`${op} fetch milestone_photos failed`, {
      milestonePhotoId,
      error: photoErr.message,
      timestamp: new Date().toISOString(),
    });
    throw new Error(`Failed to load milestone photo: ${photoErr.message}`);
  }

  if (!photoRow) {
    throw new Error(`Milestone photo not found: ${milestonePhotoId}`);
  }

  const photo = photoRow as MilestonePhotoRow;

  // 2. Load project context
  const { data: projectRow, error: projErr } = await admin
    .from('projects')
    .select('customer_name, system_size_kwp, system_type, panel_count, panel_brand, panel_model, structure_type')
    .eq('id', photo.project_id)
    .maybeSingle();

  if (projErr) {
    console.error(`${op} fetch project failed`, {
      projectId: photo.project_id,
      error: projErr.message,
      timestamp: new Date().toISOString(),
    });
    throw new Error(`Failed to load project: ${projErr.message}`);
  }

  const ctx: ProjectContext = {
    customer_name: (projectRow as any)?.customer_name ?? 'Unknown',
    system_size_kwp: (projectRow as any)?.system_size_kwp ?? 0,
    system_type: (projectRow as any)?.system_type ?? 'on_grid',
    panel_count: (projectRow as any)?.panel_count ?? 0,
    panel_brand: (projectRow as any)?.panel_brand ?? null,
    panel_model: (projectRow as any)?.panel_model ?? null,
    structure_type: (projectRow as any)?.structure_type ?? null,
  };

  // 3. Download photo from Supabase Storage
  const photoData = await downloadPhotoAsBase64(photo.storage_path, anthropicKey);
  if (!photoData) {
    console.warn(`${op} could not download photo, inserting image_quality_low finding`, {
      milestonePhotoId,
      storagePath: photo.storage_path,
      timestamp: new Date().toISOString(),
    });

    const fallbackFinding: PhotoFinding = {
      finding_type: 'image_quality_low',
      severity: 'warning',
      description: 'Photo could not be downloaded from storage for AI analysis.',
      suggested_action: 'Check that the photo was uploaded successfully and retry the scan.',
      confidence_score: 1.0,
    };

    const insert: QcPhotoFindingInsert = {
      milestone_photo_id: milestonePhotoId,
      project_id: photo.project_id,
      finding_type: fallbackFinding.finding_type,
      severity: fallbackFinding.severity,
      ai_description: fallbackFinding.description,
      ai_suggested_action: fallbackFinding.suggested_action,
      confidence_score: fallbackFinding.confidence_score,
      ai_tokens_used: 0,
      ai_model: SONNET_MODEL,
    };

    await admin.from('qc_photo_findings').insert(insert);
    return { findings: [fallbackFinding], ai_tokens_used: 0 };
  }

  // 4. Build user prompt with project context
  const panelSpec = ctx.panel_count > 0
    ? `${ctx.panel_count}× ${[ctx.panel_brand, ctx.panel_model].filter(Boolean).join(' ') || 'panels'}`
    : 'panel count not specified';
  const structureInfo = ctx.structure_type ? ` Structure type: ${ctx.structure_type}.` : '';

  const userPrompt = [
    `Project: ${ctx.customer_name}, ${ctx.system_size_kwp} kWp ${ctx.system_type}.`,
    `Panel spec: ${panelSpec}.${structureInfo}`,
    `Milestone: ${photo.milestone}.`,
    'Analyse this photo for installation quality issues.',
  ].join(' ');

  // 5. Call Claude Sonnet vision
  const visionResult = await callClaudeVision(
    anthropicKey,
    photoData.base64,
    photoData.mimeType,
    userPrompt,
  );

  if (!visionResult) {
    console.error(`${op} vision call failed, inserting image_quality_low fallback`, {
      milestonePhotoId,
      timestamp: new Date().toISOString(),
    });

    const fallbackFinding: PhotoFinding = {
      finding_type: 'image_quality_low',
      severity: 'info',
      description: 'AI vision analysis could not be completed for this photo.',
      suggested_action: 'Manual review required.',
      confidence_score: 1.0,
    };

    const insert: QcPhotoFindingInsert = {
      milestone_photo_id: milestonePhotoId,
      project_id: photo.project_id,
      finding_type: fallbackFinding.finding_type,
      severity: fallbackFinding.severity,
      ai_description: fallbackFinding.description,
      ai_suggested_action: fallbackFinding.suggested_action,
      confidence_score: fallbackFinding.confidence_score,
      ai_tokens_used: 0,
      ai_model: SONNET_MODEL,
    };

    await admin.from('qc_photo_findings').insert(insert);
    return { findings: [fallbackFinding], ai_tokens_used: 0 };
  }

  const { findings, tokensUsed } = visionResult;

  // 6. Insert each finding into qc_photo_findings
  for (const finding of findings) {
    const insert: QcPhotoFindingInsert = {
      milestone_photo_id: milestonePhotoId,
      project_id: photo.project_id,
      finding_type: finding.finding_type,
      severity: finding.severity,
      ai_description: finding.description,
      ai_suggested_action: finding.suggested_action,
      confidence_score: finding.confidence_score,
      ai_tokens_used: tokensUsed,
      ai_model: SONNET_MODEL,
    };

    const { data: insertedRow, error: insertErr } = await admin
      .from('qc_photo_findings')
      .insert(insert)
      .select('id')
      .single();

    if (insertErr) {
      console.error(`${op} insert finding failed`, {
        milestonePhotoId,
        finding_type: finding.finding_type,
        error: insertErr.message,
        timestamp: new Date().toISOString(),
      });
      continue;
    }

    // 7. Emit event for warning/critical findings (not info or no_issue)
    if (
      finding.severity !== 'info' &&
      finding.finding_type !== 'no_issue' &&
      insertedRow?.id
    ) {
      await emitErpEvent('qc.photo_finding_created', {
        photo_id: milestonePhotoId,
        finding_id: insertedRow.id,
        severity: finding.severity,
        finding_type: finding.finding_type,
        project_id: photo.project_id,
        timestamp: new Date().toISOString(),
      });
    }
  }

  console.log(`${op} done`, {
    milestonePhotoId,
    findingsCount: findings.length,
    tokensUsed,
    timestamp: new Date().toISOString(),
  });

  return { findings, ai_tokens_used: tokensUsed };
}
