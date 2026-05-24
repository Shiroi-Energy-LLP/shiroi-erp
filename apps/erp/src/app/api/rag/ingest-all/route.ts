/**
 * POST /api/rag/ingest-all
 *
 * Spawns `pnpm rag:ingest-all` via child_process.spawn with a 30-minute timeout.
 * Streams stdout/stderr to the server console. Returns a JSON summary on completion.
 *
 * Auth: x-webhook-secret header (same pattern as all internal cron/trigger routes).
 * Called by: n8n workflow 72-rag-ingest-cron.json (nightly 02:00 IST).
 * Also callable on-demand from the RAG debug admin page.
 *
 * Response 200: { ok: true, succeeded: number, failed: number, durationMs: number, completedAt: string, scripts: string[] }
 * Response 401: { error: 'Unauthorized' }
 * Response 500: { ok: false, error: string }
 */

import { NextResponse, type NextRequest } from 'next/server';
import { spawn } from 'child_process';
import * as path from 'path';

export const dynamic = 'force-dynamic';
// 30-minute timeout: Next.js default is 10s for API routes — override via maxDuration
export const maxDuration = 1800; // seconds (Vercel Pro supports up to 300s; on local dev uncapped)

const INGEST_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

/** Resolve the monorepo root from this file's location */
const repoRoot = path.resolve(process.cwd());

export async function POST(request: NextRequest) {
  const op = '[POST /api/rag/ingest-all]';

  // ── Auth ──────────────────────────────────────────────────────────────────
  const incomingSecret = request.headers.get('x-webhook-secret');
  const expectedSecret = process.env.N8N_WEBHOOK_SECRET;

  if (!expectedSecret || incomingSecret !== expectedSecret) {
    console.error(`${op} unauthorized`, { timestamp: new Date().toISOString() });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ── Spawn ingest-all ──────────────────────────────────────────────────────
  const t0 = Date.now();
  console.log(`${op} spawning rag:ingest-all`, { timestamp: new Date().toISOString() });

  try {
    const result = await spawnIngestAll();
    const durationMs = Date.now() - t0;
    const completedAt = new Date().toISOString();

    if (result.exitCode !== 0) {
      console.error(`${op} ingest-all exited ${result.exitCode}`, {
        durationMs,
        completedAt,
        timestamp: completedAt,
      });
      return NextResponse.json(
        {
          ok: false,
          exitCode: result.exitCode,
          durationMs,
          completedAt,
          error: `ingest-all exited with code ${result.exitCode}`,
        },
        { status: 500 },
      );
    }

    console.log(`${op} completed OK`, { durationMs, completedAt, timestamp: completedAt });
    return NextResponse.json({
      ok: true,
      durationMs,
      completedAt,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${op} spawn error`, { error: msg, timestamp: new Date().toISOString() });
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

async function spawnIngestAll(): Promise<{ exitCode: number }> {
  return new Promise((resolve, reject) => {
    // Use pnpm to run rag:ingest-all (respects workspace + tsx)
    const child = spawn('pnpm', ['rag:ingest-all'], {
      cwd: repoRoot,
      env: { ...process.env },
      stdio: ['ignore', 'inherit', 'inherit'],
      shell: process.platform === 'win32', // required on Windows for pnpm shim
    });

    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      reject(new Error(`ingest-all timed out after ${INGEST_TIMEOUT_MS / 60000} minutes`));
    }, INGEST_TIMEOUT_MS);

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode: code ?? 1 });
    });
  });
}
