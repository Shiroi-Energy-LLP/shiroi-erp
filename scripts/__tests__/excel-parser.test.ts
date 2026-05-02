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
    // Each line is individually plausible (₹3L ≪ ₹5Cr per-line limit, real descriptions),
    // but 5 × ₹3L = ₹15L for a 2 kWp system = ₹7.5L/kWp > ₹5L/kWp ceiling.
    // This exercises the per-kWp accumulation guard in parseCostingSheet, NOT the
    // per-line ₹5Cr guard in parseBOMSheet (which fired on the old ₹100Cr fixture).
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet('Detailed BOM');
    sheet.addRow(['System Size', '2 kWp']);
    sheet.addRow([]);
    sheet.addRow(['S.No', 'Description', 'Qty', 'Rate', 'Amount']);
    // 5 lines × ₹3L each = ₹15L total = ₹7.5L/kWp > ₹5L/kWp threshold.
    // Each ₹3,00,000 line is safely below the ₹5Cr per-line guard.
    sheet.addRow([1, 'Solar Panels 400 Wp Mono PERC', 5, 60_000, 300_000]);
    sheet.addRow([2, 'Grid-Tie Inverter 2 kW', 1, 300_000, 300_000]);
    sheet.addRow([3, 'Mounting Structure GI', 1, 300_000, 300_000]);
    sheet.addRow([4, 'AC/DC Cabling & Conduit', 1, 300_000, 300_000]);
    sheet.addRow([5, 'Balance of System & Installation', 1, 300_000, 300_000]);

    const buffer = await bookToBuffer(book);
    const result = await parseCostingSheet(buffer);

    expect(result.summary.total_cost).toBeNull();
    expect(result.bom_lines).toHaveLength(0);
    expect(result.summary.supply_cost).toBeNull();
    expect(result.summary.installation_cost).toBeNull();
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
