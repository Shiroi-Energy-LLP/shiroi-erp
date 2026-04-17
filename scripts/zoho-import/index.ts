// scripts/zoho-import/index.ts
// Usage: npx tsx scripts/zoho-import/index.ts [--phase=<name>] [--dry-run]
import { reportResult } from './logger';
import { runPhase01 } from './phase-01-accounts';
import { runPhase02 } from './phase-02-taxes';
import { runPhase03 } from './phase-03-items';
import { runPhase04 } from './phase-04-contacts';
import { runPhase05 } from './phase-05-vendors';
import { runPhase06 } from './phase-06-projects';
import { runPhase07 } from './phase-07-pos';
import { runPhase08 } from './phase-08-invoices';
import { runPhase09 } from './phase-09-customer-payments';
import { runPhase10 } from './phase-10-bills';
import { runPhase11 } from './phase-11-vendor-payments';
import { runPhase12 } from './phase-12-expenses';
import { runPhase13 } from './phase-13-credit-notes';
import { runReconcile } from './reconcile';

const PHASES = {
  '01': runPhase01, '02': runPhase02, '03': runPhase03,
  '04': runPhase04, '05': runPhase05, '06': runPhase06,
  '07': runPhase07, '08': runPhase08, '09': runPhase09,
  '10': runPhase10, '11': runPhase11, '12': runPhase12,
  '13': runPhase13, 'reconcile': runReconcile,
} as const;

async function main() {
  const args = process.argv.slice(2);
  const phaseArg = args.find(a => a.startsWith('--phase='))?.split('=')[1] ?? 'all';
  const dryRun = args.includes('--dry-run');
  if (dryRun) process.env.ZOHO_IMPORT_DRY_RUN = '1';

  const order = Object.keys(PHASES) as Array<keyof typeof PHASES>;
  const toRun = phaseArg === 'all' ? order : [phaseArg as keyof typeof PHASES];

  console.log(`Zoho Import — ${dryRun ? 'DRY RUN' : 'LIVE'} — phases: ${toRun.join(', ')}`);
  console.log('='.repeat(60));

  for (const name of toRun) {
    const fn = PHASES[name];
    if (!fn) { console.error(`Unknown phase: ${name}`); process.exit(1); }
    console.log(`\n===== Phase ${name} =====`);
    const res = await fn();
    reportResult(res);
  }

  console.log('\n' + '='.repeat(60));
  console.log('Import complete.');
}

main().catch((e) => { console.error(e); process.exit(1); });
