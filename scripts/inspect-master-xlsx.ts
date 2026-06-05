/**
 * inspect-master-xlsx.ts
 *
 * Lists all sheets in the two master workbooks Vivek dropped on 2026-06-05,
 * with row count, header row, and a 3-row sample per sheet. Read-only.
 *
 * Usage: pnpm tsx scripts/inspect-master-xlsx.ts
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as XLSX from 'xlsx';

const FILES = [
  'scripts/data/se-master-file-2026-06-05.xlsx',
  'scripts/data/master-data-sheet-2026-06-05.xlsx',
  'scripts/data/shiroienergy-2026-06-05.xlsx',
];

for (const file of FILES) {
  const buf = readFileSync(resolve(file));
  const wb = XLSX.read(buf, { type: 'buffer' });
  console.log(`\n${'═'.repeat(70)}\n${file}\n${'═'.repeat(70)}`);
  console.log(`Sheets: ${wb.SheetNames.join(', ')}\n`);

  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name]!;
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
      header: 1, blankrows: false, defval: null,
    });
    const ref = ws['!ref'] ?? '(empty)';
    console.log(`── ${name}  [${ref}]  ${rows.length} rows`);
    // Find first non-empty row as a likely header
    let headerIdx = 0;
    for (let i = 0; i < Math.min(rows.length, 8); i++) {
      const r = rows[i] as unknown[];
      if (r && r.filter((c) => c !== null && c !== '').length >= 3) {
        headerIdx = i;
        break;
      }
    }
    const header = (rows[headerIdx] ?? []) as unknown[];
    console.log(`   header row ${headerIdx}: ${JSON.stringify(header).slice(0, 220)}`);
    const sample = rows.slice(headerIdx + 1, headerIdx + 4);
    for (const r of sample) {
      console.log(`   sample        : ${JSON.stringify(r).slice(0, 220)}`);
    }
    console.log('');
  }
}
