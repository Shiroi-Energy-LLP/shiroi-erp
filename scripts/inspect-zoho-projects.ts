import * as XLSX from 'xlsx';
import * as path from 'path';

const wb = XLSX.readFile(path.resolve(__dirname, '../docs/Zoho data/Projects.xls'), { cellDates: true });
const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: null });
console.log('Total Zoho projects:', rows.length);
console.log('\nFirst 15 Zoho projects:');
for (const r of rows.slice(0, 15)) {
  console.log(`  ${r['Project Code']} | ${r['Project Name']} | ${r['Customer Name']} | ${r['Project Status']}`);
}
console.log('\nStatus breakdown:');
const statuses: Record<string, number> = {};
for (const r of rows) {
  const s = String(r['Project Status'] ?? 'null');
  statuses[s] = (statuses[s] || 0) + 1;
}
for (const [s, n] of Object.entries(statuses)) console.log(`  ${s}: ${n}`);
