/**
 * Test the Excel BOM parser against sample files from storage.
 * Usage: npx tsx scripts/test-excel-parser.ts
 */

import { createClient } from '@supabase/supabase-js';
import { parseCostingSheet } from './excel-parser';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  dotenv.config({ path: 'C:/Users/vivek/Projects/shiroi-erp/.env.local' });
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
);

const SAMPLE_FILES = [
  '38e60a7c-5582-44cd-a7ab-447e916878e0/3MWp_Costing_Sheet_IRR_ROI.xlsx',
  '70155a92-23cc-429d-bc2c-ec85a9d77e1b/tata_costing.xlsx',
  '4b0960e8-fe3c-461f-b548-7d0e296cabb9/BOM_BOOT.xlsx',
  'f20836cd-0df5-4f71-9ceb-e16b32511e17/BOQ_fo_Roof_Top_Solar_Panel_for_Executive_Enclave.xlsx',
  '47367801-5f20-4664-b9eb-b5b1f64f96a4/Detailed_BOM_3.9MW_to_3MW.xlsx',
];

async function main() {
  for (const filePath of SAMPLE_FILES) {
    console.log(`\n${'═'.repeat(70)}`);
    console.log(`FILE: ${filePath.split('/').pop()}`);
    console.log(`${'═'.repeat(70)}`);

    const { data, error } = await supabase.storage
      .from('proposal-files')
      .download(filePath);

    if (error || !data) {
      console.error(`  Download failed: ${error?.message}`);
      continue;
    }

    const buffer = Buffer.from(await data.arrayBuffer());
    try {
      const result = await parseCostingSheet(buffer);

      console.log(`  System Size: ${result.system_size_kwp ? result.system_size_kwp + ' kWp' : 'NOT FOUND'}`);
      console.log(`  Parse Quality: ${result.parse_quality}`);
      console.log(`  Sheets Parsed: ${result.sheets_parsed.join(', ') || 'none'}`);
      console.log(`  BOM Lines: ${result.bom_lines.length}`);

      if (result.bom_lines.length > 0) {
        console.log(`\n  Top items:`);
        for (const line of result.bom_lines.slice(0, 10)) {
          console.log(
            `    ${String(line.line_number).padStart(2)}. [${line.item_category.padEnd(18)}] ${line.item_description.substring(0, 50).padEnd(52)} Qty: ${String(line.quantity).padStart(6)} × ₹${String(line.unit_price.toFixed(0)).padStart(10)} = ₹${line.total_price.toFixed(0).padStart(12)} (GST ${line.gst_rate}%)`
          );
        }
        if (result.bom_lines.length > 10) {
          console.log(`    ... +${result.bom_lines.length - 10} more lines`);
        }

        // Category summary
        const categories = new Map<string, { count: number; total: number }>();
        for (const line of result.bom_lines) {
          const cat = categories.get(line.item_category) || { count: 0, total: 0 };
          cat.count++;
          cat.total += line.total_price;
          categories.set(line.item_category, cat);
        }
        console.log(`\n  Category breakdown:`);
        for (const [cat, { count, total }] of [...categories.entries()].sort((a, b) => b[1].total - a[1].total)) {
          console.log(`    ${cat.padEnd(20)} ${count} items  ₹${total.toFixed(0).padStart(12)}`);
        }
      }

      if (result.summary.total_cost) {
        console.log(`\n  Summary:`);
        if (result.summary.supply_cost) console.log(`    Supply Cost:  ₹${result.summary.supply_cost.toFixed(0)}`);
        if (result.summary.installation_cost) console.log(`    Install Cost: ₹${result.summary.installation_cost.toFixed(0)}`);
        if (result.summary.gst_supply) console.log(`    GST Supply:   ₹${result.summary.gst_supply.toFixed(0)}`);
        if (result.summary.gst_installation) console.log(`    GST Install:  ₹${result.summary.gst_installation.toFixed(0)}`);
        console.log(`    Total:        ₹${result.summary.total_cost.toFixed(0)}`);
      }
    } catch (e) {
      console.error(`  Parse error: ${(e as Error).message}`);
    }
  }
}

main().catch(console.error);
