'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { createClient } from '@repo/supabase/server';
import { ok, err, type ActionResult } from '@/lib/types/actions';
import type { Json } from '@repo/types/database';
import type { ParsedBomLine } from './bom-sheet-parser';

// One parsed sheet handed from the upload dialog to be staged.
export interface SeedSheetInput {
  sheetName: string;
  projectName: string;
  normalizedName: string;
  header: Record<string, unknown>;
  summary: Record<string, number>;
  lines: ParsedBomLine[];
}

interface Candidate { project_id: string; customer_name: string; project_number: string; score: number }

function classify(score: number): 'exact' | 'fuzzy' | 'none' {
  if (score >= 0.85) return 'exact';
  if (score >= 0.45) return 'fuzzy';
  return 'none';
}

/**
 * Stage uploaded BOM sheets into pending_bom_imports. Parsing happens client-side
 * (bom-sheet-parser via exceljs); this action fuzzy-matches each sheet to a
 * project and inserts a staging row. Founder/PM only (enforced by RLS).
 * Idempotent: skips a (file, sheet) already in a pending/imported row.
 */
export async function seedBomImports(input: {
  fileName: string;
  sheets: SeedSheetInput[];
}): Promise<ActionResult<{ seeded: number; skipped: number }>> {
  const op = '[seedBomImports]';
  try {
    if (!input.fileName || input.sheets.length === 0) return err('Nothing to import');
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return err('Not authenticated');

    const batchId = randomUUID();
    let seeded = 0;
    let skipped = 0;

    for (const sheet of input.sheets) {
      const { data: existing } = await supabase
        .from('pending_bom_imports')
        .select('id')
        .eq('source_file_name', input.fileName)
        .eq('sheet_name', sheet.sheetName)
        .in('status_review', ['pending', 'imported'])
        .limit(1);
      if (existing && existing.length > 0) {
        skipped++;
        continue;
      }

      const { data: matchData } = await supabase.rpc('match_project_by_name', {
        p_name: sheet.projectName,
        p_limit: 5,
      });
      const candidates: Candidate[] = (matchData ?? []).map((r: Record<string, unknown>) => ({
        project_id: String(r.project_id),
        customer_name: String(r.customer_name ?? ''),
        project_number: String(r.project_number ?? ''),
        score: Number(r.score ?? 0),
      }));
      const top = candidates[0];
      const confidence = top ? classify(top.score) : 'none';
      const matchedId = top && top.score >= 0.45 ? top.project_id : null;

      const { error: insErr } = await supabase.from('pending_bom_imports').insert({
        import_batch_id: batchId,
        source_file_name: input.fileName,
        sheet_name: sheet.sheetName,
        project_name: sheet.projectName,
        normalized_name: sheet.normalizedName,
        matched_project_id: matchedId,
        match_confidence: confidence,
        match_score: top?.score ?? 0,
        match_candidates: candidates as unknown as Json,
        header: sheet.header as unknown as Json,
        parsed_lines: sheet.lines as unknown as Json,
        summary: sheet.summary as unknown as Json,
        line_count: sheet.lines.length,
        created_by: user.id,
      });
      if (insErr) {
        console.error(`${op} Insert failed:`, { code: insErr.code, message: insErr.message, sheet: sheet.sheetName });
        return err(`Failed to stage "${sheet.sheetName}": ${insErr.message}`, insErr.code);
      }
      seeded++;
    }

    revalidatePath('/bom-review/import');
    console.log(`${op} Done:`, { seeded, skipped, file: input.fileName, timestamp: new Date().toISOString() });
    return ok({ seeded, skipped });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${op} Exception:`, { message: msg, timestamp: new Date().toISOString() });
    return err(msg);
  }
}

/** Confirm a staged sheet into a project's BOM (project_bois + project_boq_items). */
export async function approveBomImport(
  id: string,
  projectId: string,
  lines: ParsedBomLine[],
): Promise<ActionResult<{ boi_id: string }>> {
  const op = '[approveBomImport]';
  if (!id) return err('Import id is required');
  if (!projectId) return err('Pick a project to import into');
  if (!lines || lines.length === 0) return err('No lines to import');
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('approve_bom_import', {
      p_id: id,
      p_project_id: projectId,
      p_lines: lines as unknown as Json,
    });
    if (error) {
      console.error(`${op} Failed:`, { code: error.code, message: error.message, id, projectId, timestamp: new Date().toISOString() });
      return err(error.message, error.code);
    }
    revalidatePath('/bom-review/import');
    revalidatePath(`/procurement/project/${projectId}`);
    return ok({ boi_id: data as string });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${op} Exception:`, { message: msg, id, projectId, timestamp: new Date().toISOString() });
    return err(msg);
  }
}

/** Skip a staged sheet (status_review = rejected). RLS-gated UPDATE; no RPC. */
export async function rejectBomImport(id: string, reason: string | null): Promise<ActionResult<null>> {
  const op = '[rejectBomImport]';
  if (!id) return err('Import id is required');
  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from('pending_bom_imports')
      .update({ status_review: 'rejected', rejection_reason: reason, reviewed_at: new Date().toISOString() })
      .eq('id', id)
      .eq('status_review', 'pending');
    if (error) {
      console.error(`${op} Failed:`, { code: error.code, message: error.message, id });
      return err(error.message, error.code);
    }
    revalidatePath('/bom-review/import');
    return ok(null);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${op} Exception:`, { message: msg, id, timestamp: new Date().toISOString() });
    return err(msg);
  }
}
