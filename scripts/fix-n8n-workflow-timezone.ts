/**
 * Adds `settings.timezone: "Asia/Kolkata"` to every workflow so cron triggers
 * evaluate in IST.
 *
 * Background: n8n's `GENERIC_TIMEZONE` env var is ONLY used as a default
 * when a NEW workflow is created via the UI. For workflows imported via API
 * (our entire pipeline), the workflow's `settings.timezone` field starts
 * empty and n8n falls back to UTC for cron evaluation. That's why every
 * cron in our fleet fired ~5h30m late on the morning of 2026-05-03:
 *
 *   #19 cron `0 0 7 * * *`  → fired at 07:00 UTC = 12:30 IST (intended 07:00 IST)
 *   #20 cron `0 0 8 * * *`  → fired at 08:00 UTC = 13:30 IST (intended 08:00 IST)
 *   #03 cron `0 0 9 * * *`  → fired at 09:00 UTC = 14:30 IST (intended 09:00 IST)
 *
 * Setting `settings.timezone: "Asia/Kolkata"` makes n8n evaluate crons in IST.
 *
 * Idempotent — leaves already-set timezones alone.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

const WORKFLOWS_DIR = path.resolve(__dirname, '../infrastructure/n8n/workflows');
const TARGET_TZ = 'Asia/Kolkata';

interface N8nWorkflow {
  name: string;
  settings?: Record<string, unknown>;
  [key: string]: unknown;
}

function fixWorkflow(filePath: string): boolean {
  const raw = fs.readFileSync(filePath, 'utf8');
  const wf = JSON.parse(raw) as N8nWorkflow;

  if (!wf.settings) {
    wf.settings = {};
  }

  if (wf.settings.timezone === TARGET_TZ) return false;

  wf.settings.timezone = TARGET_TZ;
  fs.writeFileSync(filePath, JSON.stringify(wf, null, 2) + '\n', 'utf8');
  return true;
}

function main() {
  const files = fs
    .readdirSync(WORKFLOWS_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort();

  let updated = 0;
  for (const file of files) {
    if (fixWorkflow(path.join(WORKFLOWS_DIR, file))) {
      console.log(`  [updt] ${file} → settings.timezone = "${TARGET_TZ}"`);
      updated++;
    }
  }
  console.log('');
  console.log(`Done. ${updated} workflow file(s) updated.`);
}

main();
