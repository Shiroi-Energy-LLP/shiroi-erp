/**
 * inspect-status-values.ts
 * Quick — list distinct Status values + counts in shiroienergy.Projects.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as XLSX from 'xlsx';

const wb = XLSX.read(readFileSync(resolve('scripts/data/shiroienergy-2026-06-05.xlsx')), { type: 'buffer' });
const ws = wb.Sheets['Projects']!;
const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(ws, { header: 1, blankrows: false, defval: null });

const counts = new Map<string, number>();
for (const r of rows.slice(1)) {
  const status = (r[3] == null ? '(null)' : String(r[3])).trim();
  counts.set(status, (counts.get(status) ?? 0) + 1);
}
console.log('Status values in shiroienergy.Projects:');
for (const [s, c] of [...counts.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${c.toString().padStart(4)}  ${s}`);

const yrs = new Map<number, number>();
for (const r of rows.slice(1)) {
  if (typeof r[6] === 'number') yrs.set(r[6], (yrs.get(r[6]) ?? 0) + 1);
}
console.log('\nYears:');
for (const [y, c] of [...yrs.entries()].sort((a, b) => a[0] - b[0])) console.log(`  ${y}: ${c}`);

const completed = rows.slice(1).filter((r) => String(r[3] ?? '').trim().toLowerCase() === 'completed');
console.log(`\nTotal completed: ${completed.length}`);
