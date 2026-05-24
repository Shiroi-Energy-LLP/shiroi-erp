import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@repo/supabase/admin';
import { analyzeMilestonePhoto } from '@/lib/ai/photo-qc-analyzer';

const MAX_PHOTOS_PER_RUN = 50;
const LOOKBACK_HOURS = 24;

interface ScanResult {
  photos_scanned: number;
  photos_skipped_already_analysed: number;
  findings_total: number;
  findings_critical: number;
  findings_warning: number;
  tokens_used_total: number;
  errors: number;
  capped: boolean;
  detail: string[];
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const op = '[qc-photos/scan-recent]';

  // ── Auth: validate x-webhook-secret ──
  const secret = req.headers.get('x-webhook-secret');
  const expectedSecret = process.env.N8N_WEBHOOK_SECRET;
  if (!secret || !expectedSecret || secret !== expectedSecret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // ── API key guard: return 503 if ANTHROPIC_API_KEY unset ──
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn(`${op} ANTHROPIC_API_KEY not set — scan aborted`, {
      timestamp: new Date().toISOString(),
    });
    return NextResponse.json(
      { error: 'ANTHROPIC_API_KEY not configured. Set it in environment variables.' },
      { status: 503 },
    );
  }

  const admin = createAdminClient();
  const result: ScanResult = {
    photos_scanned: 0,
    photos_skipped_already_analysed: 0,
    findings_total: 0,
    findings_critical: 0,
    findings_warning: 0,
    tokens_used_total: 0,
    errors: 0,
    capped: false,
    detail: [],
  };

  try {
    // ── Step 1: Find milestone_photos uploaded in last 24h ──
    const cutoff = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();

    const { data: recentPhotos, error: queryErr } = await admin
      .from('milestone_photos')
      .select('id, project_id, storage_path, milestone, uploaded_at')
      .gte('uploaded_at', cutoff)
      .order('uploaded_at', { ascending: false })
      .limit(MAX_PHOTOS_PER_RUN + 50); // Fetch extra so we can identify already-analysed

    if (queryErr) {
      console.error(`${op} query failed`, {
        error: queryErr.message,
        timestamp: new Date().toISOString(),
      });
      return NextResponse.json(
        { error: `Query failed: ${queryErr.message}` },
        { status: 500 },
      );
    }

    if (!recentPhotos || recentPhotos.length === 0) {
      result.detail.push('No photos uploaded in last 24h');
      return NextResponse.json(result, { status: 200 });
    }

    result.detail.push(`Found ${recentPhotos.length} recent photos`);

    // ── Step 2: Filter out photos that already have findings ──
    const photoIds = recentPhotos.map((p) => p.id);

    const { data: alreadyAnalysed, error: checkErr } = await admin
      .from('qc_photo_findings')
      .select('milestone_photo_id')
      .in('milestone_photo_id', photoIds);

    if (checkErr) {
      console.error(`${op} already-analysed check failed`, {
        error: checkErr.message,
        timestamp: new Date().toISOString(),
      });
      // Non-fatal — proceed without filtering, might re-analyse some
    }

    const alreadyAnalysedSet = new Set(
      (alreadyAnalysed ?? []).map((r) => r.milestone_photo_id),
    );

    const unanalysedPhotos = recentPhotos.filter(
      (p) => !alreadyAnalysedSet.has(p.id),
    );

    result.photos_skipped_already_analysed =
      recentPhotos.length - unanalysedPhotos.length;
    result.detail.push(
      `${result.photos_skipped_already_analysed} already analysed, ${unanalysedPhotos.length} pending`,
    );

    // ── Step 3: Cap at MAX_PHOTOS_PER_RUN ──
    const photosToScan = unanalysedPhotos.slice(0, MAX_PHOTOS_PER_RUN);
    if (unanalysedPhotos.length > MAX_PHOTOS_PER_RUN) {
      result.capped = true;
      result.detail.push(`Capped at ${MAX_PHOTOS_PER_RUN} photos (${unanalysedPhotos.length - MAX_PHOTOS_PER_RUN} deferred to next run)`);
    }

    // ── Step 4: Analyse each photo ──
    for (const photo of photosToScan) {
      try {
        const { findings, ai_tokens_used } = await analyzeMilestonePhoto(photo.id);

        result.photos_scanned++;
        result.findings_total += findings.length;
        result.tokens_used_total += ai_tokens_used;

        for (const f of findings) {
          if (f.severity === 'critical') result.findings_critical++;
          if (f.severity === 'warning') result.findings_warning++;
        }

        result.detail.push(
          `Photo ${photo.id} (${photo.milestone}): ${findings.length} finding(s)`,
        );
      } catch (e) {
        result.errors++;
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`${op} photo analysis failed`, {
          photoId: photo.id,
          error: msg,
          timestamp: new Date().toISOString(),
        });
        result.detail.push(`Photo ${photo.id}: ERROR — ${msg}`);
      }
    }

    console.log(`${op} scan complete`, {
      ...result,
      timestamp: new Date().toISOString(),
    });

    return NextResponse.json(result, { status: 200 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${op} unhandled error`, { error: msg, timestamp: new Date().toISOString() });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
