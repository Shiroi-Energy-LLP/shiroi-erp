/**
 * Temp: peek at Zoho .xls exports to understand schema before finance-import design.
 * Usage: npx tsx scripts/inspect-zoho.ts
 */
import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';

const ZOHO_DIR = path.resolve(__dirname, '../docs/Zoho data');

const FILES = [
  'Projects.xls',
  'Invoice.xls',
  'Customer_Payment.xls',
  'Bill.xls',
  'Vendor_Payment.xls',
  'Expense.xls',
  'Purchase_Order.xls',
  'Journal.xls',
  'Chart_of_Accounts.xls',
  'Contacts.xls',
  'Vendors.xls',
  'Item.xls',
  'Budget.xls',
  'Credit_Note.xls',
  'Deposit.xls',
  'Transfer_Fund.xls',
  'Inventory_Adjustment.xls',
  'Sales_Order.xls',
  'Vendor_Credits.xls',
  'Bill_Of_Entry.xls',
];

for (const file of FILES) {
  const fullPath = path.join(ZOHO_DIR, file);
  if (!fs.existsSync(fullPath)) {
    console.log(`\n=== ${file}: NOT FOUND ===`);
    continue;
  }
  const stat = fs.statSync(fullPath);
  console.log(`\n==================== ${file} (${Math.round(stat.size / 1024)} KB) ====================`);
  try {
    const wb = XLSX.readFile(fullPath, { cellDates: true });
    for (const sheetName of wb.SheetNames) {
      const sheet = wb.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
      const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
      console.log(`  Sheet: "${sheetName}" | ${rows.length} rows | ${headers.length} cols`);
      console.log(`  Headers: ${JSON.stringify(headers)}`);
      if (rows.length > 0) {
        console.log(`  First row sample:`);
        const firstRow = rows[0];
        for (const [k, v] of Object.entries(firstRow)) {
          const strVal = v === null || v === undefined ? 'null' : String(v).slice(0, 80);
          console.log(`    ${k}: ${strVal}`);
        }
      }
    }
  } catch (err) {
    console.log(`  ERROR: ${(err as Error).message}`);
  }
}
