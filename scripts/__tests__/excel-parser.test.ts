/**
 * Sanity-check tests for excel-parser.ts. We're not testing the full BOM-shape
 * extraction here — just the guardrails added in 2026-04-30 to stop the
 * proposal-financial-corruption regression from ever reappearing.
 */
import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { parseCostingSheet } from '../excel-parser';

async function bookToBuffer(book: ExcelJS.Workbook): Promise<Buffer> {
  const arr = await book.xlsx.writeBuffer();
  return Buffer.from(arr);
}

describe('parseCostingSheet sanity checks', () => {
  it('rejects a parsed total > ₹5L/kWp', async () => {
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet('Detailed BOM');
    sheet.addRow(['System Size', '4 kWp']);
    sheet.addRow([]);
    sheet.addRow(['S.No', 'Description', 'Qty', 'Rate', 'Amount']);
    // 1 row × ₹100 Cr — way above 4 kWp × ₹5L/kWp = ₹20L ceiling.
    sheet.addRow([1, 'Solar Panels', 1, 1_000_000_000, 1_000_000_000]);

    const summary = await bookToBuffer(book);
    const result = await parseCostingSheet(summary);

    expect(result.summary.total_cost).toBeNull();
    expect(result.bom_lines).toHaveLength(0);
  });

  it('keeps a reasonable total intact (₹2L/kWp ≈ premium hybrid)', async () => {
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet('Detailed BOM');
    sheet.addRow(['System Size', '5 kWp']);
    sheet.addRow([]);
    sheet.addRow(['S.No', 'Description', 'Qty', 'Rate', 'Amount']);
    // Total ~₹10L for 5 kWp = ₹2L/kWp = OK
    sheet.addRow([1, 'Solar Panels 550 Wp', 10, 25_000, 250_000]);
    sheet.addRow([2, 'Inverter 5kW Hybrid', 1, 500_000, 500_000]);
    sheet.addRow([3, 'Battery 5 kWh', 1, 250_000, 250_000]);

    const buffer = await bookToBuffer(book);
    const result = await parseCostingSheet(buffer);

    expect(result.bom_lines.length).toBeGreaterThanOrEqual(3);
    expect(result.summary.total_cost).toBeGreaterThan(0);
    expect(result.summary.total_cost).toBeLessThan(2_000_000); // < ₹20L sanity
  });

  it('skips capex-summary rows masquerading as line items', async () => {
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet('Detailed BOM');
    sheet.addRow(['System Size', '10 kWp']);
    sheet.addRow([]);
    sheet.addRow(['S.No', 'Description', 'Qty', 'Rate', 'Amount']);
    sheet.addRow([1, 'Solar Panels', 20, 12_000, 240_000]);
    // Capex summary rows that historically broke the parser:
    sheet.addRow([2, 'Cost /KW in Rs', 197_211, 66_832, 13_180_140_000_000]);
    sheet.addRow([3, '', 680_000, 761_600, 517_888_000_000]);

    const buffer = await bookToBuffer(book);
    const result = await parseCostingSheet(buffer);

    // Only the panel row should survive.
    expect(result.bom_lines).toHaveLength(1);
    expect(result.bom_lines[0].item_description.toLowerCase()).toContain('solar panels');
  });

  it('skips empty-description rows with > ₹50L total', async () => {
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet('BOM');
    sheet.addRow(['System Size', '5 kWp']);
    sheet.addRow([]);
    sheet.addRow(['S.No', 'Description', 'Qty', 'Rate', 'Amount']);
    sheet.addRow([1, 'Panels', 10, 25_000, 250_000]);
    sheet.addRow([2, '', 100_000, 1_000, 100_000_000]); // ₹10Cr empty-desc → reject

    const buffer = await bookToBuffer(book);
    const result = await parseCostingSheet(buffer);

    expect(result.bom_lines).toHaveLength(1);
  });
});
