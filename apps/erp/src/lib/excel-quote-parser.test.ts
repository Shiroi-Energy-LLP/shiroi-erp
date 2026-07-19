import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { parseQuoteExcel, ParsedQuoteRow } from './excel-quote-parser';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a minimal .xlsx buffer using exceljs.
 * Row format: [sNo, description, unitPrice, gstRate?]
 * Pass `null` to leave a cell empty. The first row is always a header.
 */
async function buildBuffer(
  dataRows: (string | number | null)[][],
  includeHeader = true,
): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');

  if (includeHeader) {
    ws.addRow(['S.No', 'Item Description', 'Unit Price', 'GST %']);
  }

  for (const row of dataRows) {
    // exceljs treats undefined the same as null (empty cell)
    ws.addRow(row.map((v) => (v === null ? undefined : v)));
  }

  // writeBuffer() returns exceljs's Buffer (extends ArrayBuffer).
  // Cast to ArrayBuffer for the parseQuoteExcel signature.
  const buf = await wb.xlsx.writeBuffer();
  return buf as unknown as ArrayBuffer;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('parseQuoteExcel', () => {
  // (a) Normal multi-row sheet → correct rows
  it('parses a normal multi-row sheet correctly', async () => {
    const buf = await buildBuffer([
      [1, 'Solar Panel 400W', 8500, 12],
      [2, 'Inverter 5kW', 45000, 18],
      [3, 'Mounting Structure', 12000, 18],
    ]);

    const result = await parseQuoteExcel(buf);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.rows).toHaveLength(3);
    expect(result.warnings).toHaveLength(0);

    expect(result.rows[0]).toEqual<ParsedQuoteRow>({
      sNo: 1,
      itemDescription: 'Solar Panel 400W',
      unitPrice: 8500,
      gstRate: 12,
    });
    expect(result.rows[1]).toEqual<ParsedQuoteRow>({
      sNo: 2,
      itemDescription: 'Inverter 5kW',
      unitPrice: 45000,
      gstRate: 18,
    });
    expect(result.rows[2]).toEqual<ParsedQuoteRow>({
      sNo: 3,
      itemDescription: 'Mounting Structure',
      unitPrice: 12000,
      gstRate: 18,
    });
  });

  // (b) GST omitted → defaults to 18
  it('defaults gstRate to 18 when GST column is absent/empty', async () => {
    const buf = await buildBuffer([
      [1, 'DC Cable 6mm', 250, null],
      [2, 'AC Cable 4mm', 180, null],
    ]);

    const result = await parseQuoteExcel(buf);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.rows).toHaveLength(2);
    expect(result.warnings).toHaveLength(0);
    expect(result.rows[0]!.gstRate).toBe(18);
    expect(result.rows[1]!.gstRate).toBe(18);
  });

  // (c) GST non-numeric → warning + defaulted to 18, row included
  it('warns and defaults gstRate to 18 when GST is non-numeric', async () => {
    const buf = await buildBuffer([
      [1, 'ACDB Box', 5000, 'N/A'],
    ]);

    const result = await parseQuoteExcel(buf);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.rows).toHaveLength(1);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('Row 2');
    expect(result.warnings[0]).toContain('gst_rate is not a valid number, defaulting to 18');
    expect(result.rows[0]!.gstRate).toBe(18);
    // Row IS included
    expect(result.rows[0]!.itemDescription).toBe('ACDB Box');
  });

  // (d) GST out of range → warning + row skipped
  it('warns and skips row when GST is out of range (> 28)', async () => {
    const buf = await buildBuffer([
      [1, 'Solar Panel 400W', 8500, 40],
      [2, 'Inverter 5kW', 45000, 18],
    ]);

    const result = await parseQuoteExcel(buf);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.rows).toHaveLength(1);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('Row 2');
    expect(result.warnings[0]).toContain('gst_rate 40 is out of range (0–28), skipping row');
    // Only the second row makes it through
    expect(result.rows[0]!.itemDescription).toBe('Inverter 5kW');
  });

  it('warns and skips row when GST is negative (< 0)', async () => {
    const buf = await buildBuffer([
      [1, 'Solar Panel 400W', 8500, -5],
    ]);

    const result = await parseQuoteExcel(buf);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.rows).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('gst_rate -5 is out of range (0–28), skipping row');
  });

  // (e) Missing unit price → warning + row skipped
  it('warns and skips row when unit price is missing', async () => {
    const buf = await buildBuffer([
      [1, 'Solar Panel 400W', null, 12],
      [2, 'Inverter 5kW', 45000, 18],
    ]);

    const result = await parseQuoteExcel(buf);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.rows).toHaveLength(1);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('Row 2');
    expect(result.warnings[0]).toContain('unit_price missing or invalid');
    expect(result.rows[0]!.itemDescription).toBe('Inverter 5kW');
  });

  it('warns and skips row when unit price is non-numeric string', async () => {
    const buf = await buildBuffer([
      [1, 'Solar Panel 400W', 'TBD', 12],
    ]);

    const result = await parseQuoteExcel(buf);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.rows).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('unit_price missing or invalid');
  });

  // (f) A fully-blank row mid-sheet → processing stops there
  it('stops processing at a fully blank row (both S.No and Description empty)', async () => {
    const buf = await buildBuffer([
      [1, 'Solar Panel 400W', 8500, 12],
      [null, null, null, null],  // blank row — should stop here
      [3, 'Mounting Structure', 12000, 18],  // should NOT be included
    ]);

    const result = await parseQuoteExcel(buf);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Only the first row should be parsed; the blank row terminates
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.itemDescription).toBe('Solar Panel 400W');
  });

  // (g) Non-numeric S.No → sNo falls back to row array index i
  it('falls back to array index i when S.No is non-numeric', async () => {
    const buf = await buildBuffer([
      ['A', 'Solar Panel 400W', 8500, 12],
      ['B', 'Inverter 5kW', 45000, 18],
    ]);

    const result = await parseQuoteExcel(buf);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.rows).toHaveLength(2);
    // Index i=1 for first data row, i=2 for second
    expect(result.rows[0]!.sNo).toBe(1);
    expect(result.rows[1]!.sNo).toBe(2);
  });

  // (h) Corrupt buffer → the catch branch returns ok:false. A valid .xlsx starts
  // with the PK zip magic; exceljs throws on non-zip content. This is the
  // untrusted vendor-upload path the migration is meant to reject cleanly, so it
  // must be asserted (not skipped).
  it('returns ok:false for a corrupt buffer', async () => {
    const corrupt = new Uint8Array([0x00, 0x01, 0x02, 0xde, 0xad, 0xbe, 0xef]).buffer;
    const result = await parseQuoteExcel(corrupt);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('Could not read Excel file');
  });

  // (i) Workbook with no worksheet → ok:false.
  it('returns ok:false for a workbook with no worksheets', async () => {
    const wb = new ExcelJS.Workbook();
    const buf = (await wb.xlsx.writeBuffer()) as unknown as ArrayBuffer;
    const result = await parseQuoteExcel(buf);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // A zero-sheet workbook either loads with no worksheet (→ 'Excel file has no
    // sheets') or fails to load (→ 'Could not read Excel file'); both are correct
    // rejections of an unusable file.
    expect(['Excel file has no sheets', 'Could not read Excel file']).toContain(result.error);
  });

  // Edge case: description whitespace trimming
  it('trims whitespace from item descriptions', async () => {
    const buf = await buildBuffer([
      [1, '  Solar Panel 400W  ', 8500, 12],
    ]);

    const result = await parseQuoteExcel(buf);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.rows[0]!.itemDescription).toBe('Solar Panel 400W');
  });

  // Edge case: GST = 0 is valid (boundary of range)
  it('accepts gstRate = 0 (boundary)', async () => {
    const buf = await buildBuffer([
      [1, 'Agricultural Item', 1000, 0],
    ]);

    const result = await parseQuoteExcel(buf);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.gstRate).toBe(0);
    expect(result.warnings).toHaveLength(0);
  });

  // Edge case: GST = 28 is valid (upper boundary)
  it('accepts gstRate = 28 (upper boundary)', async () => {
    const buf = await buildBuffer([
      [1, 'Luxury Item', 5000, 28],
    ]);

    const result = await parseQuoteExcel(buf);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.gstRate).toBe(28);
    expect(result.warnings).toHaveLength(0);
  });
});
