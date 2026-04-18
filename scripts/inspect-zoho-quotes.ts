import * as XLSX from 'xlsx';
import * as path from 'path';

const wb = XLSX.readFile(path.resolve(__dirname, '../docs/Zoho data/Quote.xls'), { cellDates: true });
const sheetName = wb.SheetNames[0];
const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName], { defval: null });

console.log('Sheet:', sheetName);
console.log('Total rows:', rows.length);
console.log('\nColumns:');
console.log(Object.keys(rows[0] ?? {}).join('\n'));

console.log('\nFirst 3 rows:');
for (const r of rows.slice(0, 3)) {
  console.log('---');
  for (const [k, v] of Object.entries(r)) {
    const show = v instanceof Date ? v.toISOString().slice(0, 10) : v;
    if (show !== null && show !== '') console.log(`  ${k}: ${show}`);
  }
}

// Aggregate: unique quote numbers (= unique quotations), date range, customer count
const quoteNumbers = new Set<string>();
const customers = new Set<string>();
const dates: Date[] = [];
for (const r of rows) {
  const qn = r['Quote Number'] as string | null;
  const cust = r['Customer Name'] as string | null;
  const dt = r['Quote Date'] as Date | string | null;
  if (qn) quoteNumbers.add(qn);
  if (cust) customers.add(cust);
  if (dt) {
    const d = dt instanceof Date ? dt : new Date(dt);
    if (!isNaN(d.getTime())) dates.push(d);
  }
}
dates.sort((a, b) => a.getTime() - b.getTime());
console.log('\nSummary:');
console.log('  Unique quotes:', quoteNumbers.size);
console.log('  Unique customers:', customers.size);
console.log('  Date range:', dates[0]?.toISOString().slice(0, 10), '→', dates[dates.length - 1]?.toISOString().slice(0, 10));

// Status breakdown
const statuses: Record<string, number> = {};
for (const r of rows) {
  const s = String(r['Quote Status'] ?? r['Status'] ?? 'unknown');
  statuses[s] = (statuses[s] || 0) + 1;
}
console.log('\nStatus breakdown (by row):');
for (const [s, n] of Object.entries(statuses).sort((a, b) => b[1] - a[1])) console.log(`  ${s}: ${n}`);
