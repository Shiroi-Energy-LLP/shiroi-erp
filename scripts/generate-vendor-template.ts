/**
 * Phase 5: Generate CSV template for manual vendor data collection
 *
 * Exports vendors with missing GSTIN/PAN/phone/email for manual filling.
 *
 * Usage:
 *   npx tsx scripts/generate-vendor-template.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
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

async function main() {
  const op = '[vendor-template]';

  const { data: vendors } = await supabase
    .from('vendors')
    .select('id, company_name, phone, email, gstin, pan_number, is_msme, address_line1, city, state')
    .order('company_name');

  if (!vendors) {
    console.error(`${op} Failed to fetch vendors`);
    return;
  }

  // Filter to vendors with gaps
  const gapVendors = vendors.filter((v) =>
    !v.gstin || !v.phone || !v.email || !v.pan_number
  );

  console.log(`${op} ${vendors.length} total vendors, ${gapVendors.length} with data gaps`);

  // Count POs per vendor for priority
  const { data: poCounts } = await supabase
    .from('purchase_orders')
    .select('vendor_id');

  const poCountMap = new Map<string, number>();
  for (const po of poCounts ?? []) {
    poCountMap.set(po.vendor_id, (poCountMap.get(po.vendor_id) ?? 0) + 1);
  }

  // Generate CSV
  const headers = ['vendor_name', 'po_count', 'phone', 'email', 'gstin', 'pan', 'is_msme', 'address', 'city', 'state'];
  const rows = gapVendors
    .sort((a, b) => (poCountMap.get(b.id) ?? 0) - (poCountMap.get(a.id) ?? 0))
    .map((v) => [
      `"${(v.company_name || '').replace(/"/g, '""')}"`,
      poCountMap.get(v.id) ?? 0,
      v.phone || '',
      v.email || '',
      v.gstin || '',
      v.pan_number || '',
      v.is_msme ?? '',
      `"${(v.address_line1 || '').replace(/"/g, '""')}"`,
      v.city || '',
      v.state || '',
    ].join(','));

  const csv = [headers.join(','), ...rows].join('\n');
  const outPath = path.resolve(__dirname, 'data/vendor-gaps-template.csv');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, csv);

  console.log(`${op} Written ${gapVendors.length} vendors to ${outPath}`);
  console.log(`${op} Top 10 vendors by PO count (need data):`);
  gapVendors
    .sort((a, b) => (poCountMap.get(b.id) ?? 0) - (poCountMap.get(a.id) ?? 0))
    .slice(0, 10)
    .forEach((v) => {
      const missing = [
        !v.gstin ? 'GSTIN' : '',
        !v.phone ? 'Phone' : '',
        !v.email ? 'Email' : '',
        !v.pan_number ? 'PAN' : '',
      ].filter(Boolean).join(', ');
      console.log(`  ${(v.company_name || '').padEnd(40)} ${String(poCountMap.get(v.id) ?? 0).padEnd(5)} POs | Missing: ${missing}`);
    });
}

main().catch((err) => {
  console.error('[vendor-template] Fatal error:', err);
  process.exit(1);
});
