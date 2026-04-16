import * as XLSX from 'xlsx';

// ═══════════════════════════════════════════════════════════════════════
// Excel Quote Parser
//
// Parses a vendor quote Excel file uploaded via the RFQ module.
// Expected format:
//   Column A = S.No   (number)
//   Column B = Item Description  (string)
//   Column C = Unit Price  (number)
//   Column D = GST %  (number, optional — defaults to 18)
//
// Returns parsed rows + warnings. Matching each row back to an rfq_item
// is done by the caller (submitQuoteFromExcel action) via normalized
// description comparison.
// ═══════════════════════════════════════════════════════════════════════

export type ParsedQuoteRow = {
  sNo: number;
  itemDescription: string;
  unitPrice: number;
  gstRate?: number;
};

export async function parseQuoteExcel(buffer: ArrayBuffer): Promise<
  | { ok: true; rows: ParsedQuoteRow[]; warnings: string[] }
  | { ok: false; error: string }
> {
  const op = '[parseQuoteExcel]';
  try {
    const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array' });

    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      return { ok: false, error: 'Excel file has no sheets' };
    }

    const sheet = workbook.Sheets[sheetName];
    if (!sheet) {
      return { ok: false, error: 'Could not read sheet from Excel file' };
    }

    // Convert to 2D array (header row at index 0, data from index 1)
    const rawRows: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: null,
    }) as unknown[][];

    const rows: ParsedQuoteRow[] = [];
    const warnings: string[] = [];

    // Start from row index 1 (skip header)
    for (let i = 1; i < rawRows.length; i++) {
      const rawRow = rawRows[i];
      if (!rawRow) continue;

      const rowNum = i + 1; // 1-based for user-facing messages

      const rawSNo = rawRow[0];
      const rawDesc = rawRow[1];
      const rawPrice = rawRow[2];
      const rawGst = rawRow[3];

      // Stop if both S.No and description are missing (end of data)
      const sNoMissing = rawSNo === null || rawSNo === undefined || rawSNo === '';
      const descMissing = rawDesc === null || rawDesc === undefined || rawDesc === '';
      if (sNoMissing && descMissing) {
        break;
      }

      // Parse S.No
      const sNo = typeof rawSNo === 'number' ? rawSNo : Number(rawSNo);

      // Parse description
      const itemDescription = rawDesc !== null && rawDesc !== undefined
        ? String(rawDesc).trim()
        : '';

      // Validate unit price
      if (rawPrice === null || rawPrice === undefined || rawPrice === '') {
        warnings.push(`Row ${rowNum}: unit_price missing or invalid`);
        continue;
      }
      const unitPrice = typeof rawPrice === 'number' ? rawPrice : Number(rawPrice);
      if (!isFinite(unitPrice)) {
        warnings.push(`Row ${rowNum}: unit_price missing or invalid`);
        continue;
      }

      // Parse GST rate — default 18 if absent
      let gstRate = 18;
      if (rawGst !== null && rawGst !== undefined && rawGst !== '') {
        const parsed = typeof rawGst === 'number' ? rawGst : Number(rawGst);
        if (!isFinite(parsed)) {
          warnings.push(`Row ${rowNum}: gst_rate is not a valid number, defaulting to 18`);
        } else if (parsed < 0 || parsed > 28) {
          warnings.push(`Row ${rowNum}: gst_rate ${parsed} is out of range (0–28), skipping row`);
          continue;
        } else {
          gstRate = parsed;
        }
      }

      rows.push({
        sNo: isFinite(sNo) ? sNo : i,
        itemDescription,
        unitPrice,
        gstRate,
      });
    }

    console.log(`${op} Parsed ${rows.length} rows with ${warnings.length} warnings`);
    return { ok: true, rows, warnings };
  } catch (e) {
    console.error(`${op} Failed to read Excel file`, {
      error: e instanceof Error ? e.message : String(e),
    });
    return { ok: false, error: 'Could not read Excel file' };
  }
}
