// scripts/zoho-import/inspect-headers.ts
// Dump headers + first 2 rows of every Zoho XLS to understand what attribution we have.
import { loadSheet } from './parse-xls';

const files = [
  'Customer_Payment.xls',
  'Invoice.xls',
  'Vendor_Payment.xls',
  'Bill.xls',
  'Purchase_Order.xls',
  'Projects.xls',
  'Expense.xls',
  'Sales_Receipt.xls',
  'Deposit.xls',
  'Credit_Note.xls',
  'Journal.xls',
];

for (const f of files) {
  try {
    const rows = loadSheet<Record<string, unknown>>(f);
    console.log(`\n========== ${f} (${rows.length} rows) ==========`);
    if (rows.length === 0) {
      console.log('  EMPTY');
      continue;
    }
    const headers = Object.keys(rows[0]);
    console.log(`  HEADERS (${headers.length}):`);
    for (const h of headers) console.log(`    - ${h}`);
    console.log(`  SAMPLE ROW[0]:`);
    const sample = rows[0];
    for (const h of headers) {
      const v = sample[h];
      const vs = v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').slice(0, 80);
      console.log(`    ${h}: ${vs}`);
    }
    if (rows.length > 1) {
      console.log(`  SAMPLE ROW[1]:`);
      const s2 = rows[1];
      for (const h of headers) {
        const v = s2[h];
        const vs = v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').slice(0, 80);
        console.log(`    ${h}: ${vs}`);
      }
    }
  } catch (e) {
    console.log(`  ERROR loading ${f}: ${(e as Error).message}`);
  }
}
