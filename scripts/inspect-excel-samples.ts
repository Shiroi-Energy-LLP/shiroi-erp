/**
 * Utility: Download and inspect sample Excel files from Supabase Storage
 * to understand BOM/costing sheet structure before building the parser.
 *
 * Usage: npx tsx scripts/inspect-excel-samples.ts
 */

import { createClient } from '@supabase/supabase-js';
import ExcelJS from 'exceljs';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  dotenv.config({ path: 'C:/Users/vivek/Projects/shiroi-erp/.env.local' });
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SECRET_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

const SAMPLE_FILES = [
  // Various file types to understand different formats
  '38e60a7c-5582-44cd-a7ab-447e916878e0/3MWp_Costing_Sheet_IRR_ROI.xlsx',
  '70155a92-23cc-429d-bc2c-ec85a9d77e1b/tata_costing.xlsx',
  '4b0960e8-fe3c-461f-b548-7d0e296cabb9/BOM_BOOT.xlsx',
  'f20836cd-0df5-4f71-9ceb-e16b32511e17/BOQ_fo_Roof_Top_Solar_Panel_for_Executive_Enclave.xlsx',
  '47367801-5f20-4664-b9eb-b5b1f64f96a4/Detailed_BOM_3.9MW_to_3MW.xlsx',
];

async function inspectFile(filePath: string) {
  console.log(`\n${'═'.repeat(80)}`);
  console.log(`FILE: ${filePath}`);
  console.log(`${'═'.repeat(80)}`);

  const { data, error } = await supabase.storage
    .from('proposal-files')
    .download(filePath);

  if (error || !data) {
    console.error(`  Download failed: ${error?.message}`);
    return;
  }

  const buffer = Buffer.from(await data.arrayBuffer());
  const workbook = new ExcelJS.Workbook();

  try {
    await workbook.xlsx.load(buffer);
  } catch (e) {
    console.error(`  Parse failed: ${(e as Error).message}`);
    return;
  }

  console.log(`  Sheets: ${workbook.worksheets.map((s) => `"${s.name}" (${s.rowCount} rows × ${s.columnCount} cols)`).join(', ')}`);

  for (const sheet of workbook.worksheets) {
    console.log(`\n  ── Sheet: "${sheet.name}" ──`);

    // Print first 30 rows to understand structure
    const maxRows = Math.min(sheet.rowCount, 40);
    for (let r = 1; r <= maxRows; r++) {
      const row = sheet.getRow(r);
      const cells: string[] = [];
      const maxCol = Math.min(sheet.columnCount, 15);

      for (let c = 1; c <= maxCol; c++) {
        const cell = row.getCell(c);
        let val = '';
        if (cell.value !== null && cell.value !== undefined) {
          if (typeof cell.value === 'object' && 'result' in (cell.value as any)) {
            val = String((cell.value as any).result ?? '');
          } else {
            val = String(cell.value);
          }
        }
        if (val.length > 30) val = val.substring(0, 27) + '...';
        cells.push(val);
      }

      // Skip completely empty rows
      if (cells.every((c) => !c)) continue;

      console.log(`    R${String(r).padStart(3)}: ${cells.map((c) => c.padEnd(20)).join(' | ')}`);
    }
  }
}

async function main() {
  console.log('[inspect-excel] Downloading and inspecting sample Excel files...\n');

  for (const file of SAMPLE_FILES) {
    await inspectFile(file);
  }
}

main().catch(console.error);
