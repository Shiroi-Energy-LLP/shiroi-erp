/**
 * ingest-all.ts — Orchestrator: run all 5 RAG ingest scripts in sequence.
 *
 * Order: docs → proposals → service-tickets → lead-activities → price-book-items
 *
 * Each script runs in its own child_process.spawn so:
 *   - Env vars + dotenv load cleanly per script
 *   - A failure in one script is logged but does NOT stop the next
 *   - stdout/stderr from each script streams to this process's stdio
 *
 * Usage:
 *   pnpm rag:ingest-all
 *
 * Prints a per-script summary at the end:
 *   [script name]  rows_processed  chunks_upserted  duration_ms  status
 */

import * as path from 'path';
import { spawn } from 'child_process';

const repoRoot = path.resolve(__dirname, '../..');

interface ScriptResult {
  name: string;
  scriptPath: string;
  durationMs: number;
  exitCode: number;
}

const SCRIPTS: { name: string; script: string }[] = [
  { name: 'docs',            script: 'scripts/rag/ingest-docs.ts' },
  { name: 'proposals',       script: 'scripts/rag/ingest-proposals.ts' },
  { name: 'service-tickets', script: 'scripts/rag/ingest-service-tickets.ts' },
  { name: 'lead-activities', script: 'scripts/rag/ingest-lead-activities.ts' },
  { name: 'price-book',      script: 'scripts/rag/ingest-price-book-items.ts' },
];

async function runScript(name: string, scriptRelPath: string): Promise<ScriptResult> {
  const scriptPath = path.join(repoRoot, scriptRelPath);
  const t0 = Date.now();

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`[ingest-all] Starting: ${name}`);
  console.log(`${'═'.repeat(60)}\n`);

  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,        // current node binary
      [
        '--import', 'tsx/esm', // tsx ESM loader (matches how pnpm tsx runs)
        scriptPath,
      ],
      {
        cwd: repoRoot,
        env: { ...process.env },
        stdio: 'inherit',      // stream child stdout/stderr directly to this process
      },
    );

    // Try tsx CLI path as fallback — if tsx/esm loader fails, use tsx binary
    child.on('error', () => {
      // Fallback: use tsx binary directly
      const tsxPath = path.join(repoRoot, 'node_modules', '.bin', 'tsx');
      const fallback = spawn(tsxPath, [scriptPath], {
        cwd: repoRoot,
        env: { ...process.env },
        stdio: 'inherit',
      });

      fallback.on('error', (err2) => {
        console.error(`[ingest-all] Failed to spawn ${name}: ${err2.message}`);
        resolve({ name, scriptPath, durationMs: Date.now() - t0, exitCode: 1 });
      });

      fallback.on('close', (code) => {
        resolve({ name, scriptPath, durationMs: Date.now() - t0, exitCode: code ?? 1 });
      });
    });

    child.on('close', (code) => {
      resolve({ name, scriptPath, durationMs: Date.now() - t0, exitCode: code ?? 1 });
    });
  });
}

async function main() {
  const overallStart = Date.now();

  console.log('\n[ingest-all] Shiroi RAG — full ingest run');
  console.log(`[ingest-all] Scripts: ${SCRIPTS.map((s) => s.name).join(' → ')}`);
  console.log(`[ingest-all] Started at: ${new Date().toISOString()}\n`);

  const results: ScriptResult[] = [];

  for (const { name, script } of SCRIPTS) {
    const result = await runScript(name, script);
    results.push(result);

    if (result.exitCode !== 0) {
      console.log(`\n[ingest-all] WARNING: ${name} exited with code ${result.exitCode} — continuing to next script\n`);
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────

  const overallMs = Date.now() - overallStart;
  const succeeded = results.filter((r) => r.exitCode === 0).length;
  const failed = results.filter((r) => r.exitCode !== 0).length;

  console.log(`\n${'═'.repeat(60)}`);
  console.log('[ingest-all] Summary');
  console.log(`${'═'.repeat(60)}`);
  console.log(
    `${'Script'.padEnd(20)} ${'Duration'.padStart(10)} ${'Status'.padStart(10)}`,
  );
  console.log(`${'-'.repeat(42)}`);

  for (const r of results) {
    const dur = `${(r.durationMs / 1000).toFixed(1)}s`;
    const status = r.exitCode === 0 ? 'OK' : `EXIT ${r.exitCode}`;
    console.log(
      `${r.name.padEnd(20)} ${dur.padStart(10)} ${status.padStart(10)}`,
    );
  }

  console.log(`${'-'.repeat(42)}`);
  console.log(`Total duration: ${(overallMs / 1000).toFixed(1)}s`);
  console.log(`Scripts: ${succeeded} succeeded, ${failed} failed`);
  console.log(`Completed at: ${new Date().toISOString()}`);
  console.log('');

  // Exit 1 if any script failed (allows n8n / CI to detect partial failure)
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('\n[ingest-all] Fatal error:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
