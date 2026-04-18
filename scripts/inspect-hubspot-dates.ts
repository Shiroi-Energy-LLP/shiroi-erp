import * as fs from 'fs';
import * as path from 'path';

// Minimal CSV parser (handles quoted fields with embedded commas)
function parseCSV(content: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    const next = content[i + 1];
    if (inQuotes) {
      if (c === '"' && next === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { cur.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (field !== '' || cur.length) { cur.push(field); rows.push(cur); cur = []; field = ''; }
        if (c === '\r' && next === '\n') i++;
      }
      else field += c;
    }
  }
  if (field !== '' || cur.length) { cur.push(field); rows.push(cur); }
  return rows;
}

const csv = fs.readFileSync(path.resolve(__dirname, 'data/hubspot-deals.csv'), 'utf-8');
const rows = parseCSV(csv);
const headers = rows[0];
const createIdx = headers.findIndex(h => h === 'Create Date');
const recordIdx = headers.findIndex(h => h === 'Record ID');
const dealNameIdx = headers.findIndex(h => h === 'Deal Name');

console.log('Columns -- Create Date idx:', createIdx, '| Record ID idx:', recordIdx, '| Deal Name idx:', dealNameIdx);
console.log('Total data rows:', rows.length - 1);

const formats: Record<string, number> = {};
let nonEmpty = 0;
const samples: string[] = [];
for (let i = 1; i < rows.length; i++) {
  const v = rows[i][createIdx]?.trim();
  if (!v) continue;
  nonEmpty++;
  if (samples.length < 10) samples.push(v);
  // Classify format
  let fmt = 'other';
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) fmt = 'YYYY-MM-DD';
  else if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(v)) fmt = 'MM/DD/YYYY or DD/MM/YYYY';
  else if (/^\d{1,2}-\d{1,2}-\d{4}/.test(v)) fmt = 'DD-MM-YYYY';
  else if (/^\d{4}\/\d{2}\/\d{2}/.test(v)) fmt = 'YYYY/MM/DD';
  formats[fmt] = (formats[fmt] || 0) + 1;
}

console.log('\nNon-empty Create Date count:', nonEmpty);
console.log('Format breakdown:');
for (const [f, n] of Object.entries(formats)) console.log(`  ${f}: ${n}`);
console.log('\nSample values:');
for (const s of samples) console.log(` ${JSON.stringify(s)}`);

// Year breakdown using best-effort parse
const years: Record<string, number> = {};
for (let i = 1; i < rows.length; i++) {
  const v = rows[i][createIdx]?.trim();
  if (!v) continue;
  let y: string | null = null;
  const m1 = v.match(/^(\d{4})/);
  const m2 = v.match(/\/(\d{4})/);
  if (m1) y = m1[1]; else if (m2) y = m2[1];
  if (y) years[y] = (years[y] || 0) + 1;
}
console.log('\nYear breakdown:');
for (const [y, n] of Object.entries(years).sort()) console.log(`  ${y}: ${n}`);

// Also check close date format + record id distribution
const closeIdx = headers.findIndex(h => h === 'Close Date');
const closeFormats: Record<string, number> = {};
for (let i = 1; i < rows.length; i++) {
  const v = rows[i][closeIdx]?.trim();
  if (!v) continue;
  let fmt = 'other';
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) fmt = 'YYYY-MM-DD';
  else if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(v)) fmt = 'MM/DD/YYYY or DD/MM/YYYY';
  closeFormats[fmt] = (closeFormats[fmt] || 0) + 1;
}
console.log('\nClose Date format breakdown (for comparison):');
for (const [f, n] of Object.entries(closeFormats)) console.log(`  ${f}: ${n}`);
