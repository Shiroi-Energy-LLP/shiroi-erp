// scripts/zoho-import/logger.ts
export interface PhaseResult {
  phase: string;
  inserted: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: Array<{ row: number; reason: string }>;
}

export function emptyResult(phase: string): PhaseResult {
  return { phase, inserted: 0, updated: 0, skipped: 0, failed: 0, errors: [] };
}

export function reportResult(r: PhaseResult): void {
  console.log(`\n[${r.phase}] inserted=${r.inserted} updated=${r.updated} skipped=${r.skipped} failed=${r.failed}`);
  if (r.errors.length > 0) {
    console.log(`  first 5 errors:`);
    for (const e of r.errors.slice(0, 5)) {
      console.log(`    row ${e.row}: ${e.reason}`);
    }
    if (r.errors.length > 5) {
      console.log(`  ... and ${r.errors.length - 5} more errors`);
    }
  }
}
