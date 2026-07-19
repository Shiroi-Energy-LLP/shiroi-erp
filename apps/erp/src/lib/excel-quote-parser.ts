import ExcelJS from 'exceljs';

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

// ─── Cell value normalisation ─────────────────────────────────────────────────
// exceljs cell.value can be: null | number | string | boolean | Date |
//   { formula, result } (formula cell) | { richText: [...] } | { text, hyperlink }
// We extract the underlying number or string before applying business logic.

function cellRawValue(cell: ExcelJS.Cell): unknown {
  const v = cell.value;
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'object') {
    // Formula cell: { formula: '...', result: <value> }
    if ('result' in v) return (v as { formula: string; result: unknown }).result ?? null;
    // Rich text: { richText: [{ text: '...' }, ...] }
    if ('richText' in v) {
      const rt = (v as { richText: Array<{ text: string }> }).richText;
      return rt.map((r) => r.text).join('');
    }
    // Hyperlink: { text: '...', hyperlink: '...' }
    if ('text' in v) return (v as { text: string }).text;
  }
  return null;
}

function isBlank(raw: unknown): boolean {
  return raw === null || raw === undefined || raw === '';
}

export async function parseQuoteExcel(buffer: ArrayBuffer): Promise<
  | { ok: true; rows: ParsedQuoteRow[]; warnings: string[] }
  | { ok: false; error: string }
> {
  const op = '[parseQuoteExcel]';
  try {
    const wb = new ExcelJS.Workbook();
    // exceljs declares its own `Buffer` interface that extends ArrayBuffer.
    // Passing the ArrayBuffer directly satisfies that interface without needing
    // Node's Buffer.from() conversion (which produces Uint8Array, not ArrayBuffer).
    await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0]);

    const ws = wb.worksheets[0];
    if (!ws) {
      return { ok: false, error: 'Excel file has no sheets' };
    }

    const rows: ParsedQuoteRow[] = [];
    const warnings: string[] = [];

    // exceljs rows are 1-based. Row 1 = header (skipped). Data starts at row 2.
    // ws.rowCount is the last row with data; iterate from 2 to rowCount inclusive.
    // We use i as the 0-based data-array index (mirrors the original: i=1 for
    // row 2, so `isFinite(sNo) ? sNo : i` gives the correct fallback).
    for (let r = 2; r <= ws.rowCount; r++) {
      const i = r - 1; // 0-based data index (matches original loop variable i)
      const rowNum = r; // 1-based spreadsheet row for user-facing messages

      const rawSNo = cellRawValue(ws.getRow(r).getCell(1));
      const rawDesc = cellRawValue(ws.getRow(r).getCell(2));
      const rawPrice = cellRawValue(ws.getRow(r).getCell(3));
      const rawGst = cellRawValue(ws.getRow(r).getCell(4));

      // Stop if both S.No and description are missing (end of data)
      const sNoMissing = isBlank(rawSNo);
      const descMissing = isBlank(rawDesc);
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
      if (isBlank(rawPrice)) {
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
      if (!isBlank(rawGst)) {
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
