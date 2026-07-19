import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { parseBomSheet, parseBomWorkbook, normalizeProjectName } from '../bom-sheet-parser';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build a worksheet from row arrays (index 0 = column A). */
function sheetFrom(name: string, rows: Array<Array<string | number | Date | null>>): ExcelJS.Worksheet {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(name);
  for (const row of rows) ws.addRow(row.map((v) => (v === null ? undefined : v)));
  return ws;
}

const COL_HEADER = [
  '', 'Items', 'Con Without Gst', 'Con In With Gst', 'Act Without Gst', 'Act With Gst',
  'Make', 'Qty', 'Units', 'Rate', 'Gst', 'Amount In Rs', 'Total Amount in Rs',
  'Qty', 'Units', 'Rate', 'Gst', 'Amount In Rs', 'Total Amount in Rs', 'Remarks',
];

/** A standard sheet modelled on the real "Mr Muralidharan" layout. */
function standardRows(): Array<Array<string | number | null>> {
  return [
    ['', 'Bill Of Materials'],
    ['Project Name', 'Mr Muralidharan', '', '', '', '', 'Rev No', 0],
    ['Type of Shed', 'RCC Elevated', '', '', '', '', 'Date', '2024-07-25'],
    ['Slope orientations', 'South', '', '', '', '', 'Sys Size', '3.3 KWp'],
    ['Final termination Points', 'EB room', '', '', '', '', 'Loaction', 'Chitalapakkam'],
    ['System Configurations', '1*3.3 KWp', '', '', '', '', 'Prepared by', 'Manivel'],
    ['DC/AC Capacity', '3.3/3'],
    COL_HEADER,
    // category, then item (with vendor label in col A + gst as fraction)
    ['Solar PV Modules', '', 79200, 88704, 74229, 83136.48],
    ['Southern Power', '545 Wp DCR Bifacial Solar Modules', '', '', '', '', 'Vikram', 6, 'Nos', 12371.5, 0.12, 74229, 83136.48, 0, 'Nos', 12371.5, 0.12, 0, 0, ''],
    // category, then item (no vendor label in col A)
    ['Solar Inverter', '', 19000, 21280, 18000, 20160],
    ['', '3 KW on grid Single phase inverter', '', '', '', '', 'deye', 1, 'Nos', 18000, 0.12, 18000, 20160, 0, 'Nos', 18000, 0.12, 0, 0, ''],
    // category, then item with DIFFERING actuals + remarks
    ['Module Mounting Structure', '', 26565, 31346.7, 11068.2, 13060.476],
    ['Thanigai', 'GI structure purchased as per design', '', '', '', '', 'GI', 3.3, 'KWp', 3354, 0.18, 11068.2, 13060.476, 2, 'Nos', 3000, 0.18, 6000, 7080, 'client Scope'],
    ['Summary'],
    ['', '', 183812, 206994.86],
    ['Work Order', 'Work Order Value in rs with Gst & Profit', 238044.089],
  ];
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('parseBomSheet', () => {
  it('parses a standard sheet: header, category grouping, contracted+actual split, gst normalisation', () => {
    const res = parseBomSheet(sheetFrom('Mr Muralidharan', standardRows()));

    expect(res.ok).toBe(true);
    expect(res.projectName).toBe('Mr Muralidharan');
    expect(res.header.type_of_shed).toBe('RCC Elevated');
    expect(res.header.location).toBe('Chitalapakkam');
    expect(res.header.prepared_by).toBe('Manivel');
    expect(res.header.sys_size).toBe('3.3 KWp');

    expect(res.lines).toHaveLength(3);

    const pv = res.lines[0]!;
    const inv = res.lines[1]!;
    const mms = res.lines[2]!;

    expect(pv.item_category).toBe('Solar PV Modules');
    expect(pv.item_description).toBe('545 Wp DCR Bifacial Solar Modules');
    expect(pv.make).toBe('Vikram');
    expect(pv.vendor_name).toBe('Southern Power');
    expect(pv.quantity).toBe(6);
    expect(pv.unit).toBe('Nos');
    expect(pv.unit_price).toBe(12371.5);
    expect(pv.gst_rate).toBe(12); // 0.12 → 12
    expect(pv.total_price).toBe(83136.48);
    expect(pv.actual_quantity).toBe(0);
    expect(pv.actual_unit_price).toBe(12371.5);
    expect(pv.actual_total_price).toBe(0);

    expect(inv.item_category).toBe('Solar Inverter');
    expect(inv.make).toBe('deye');
    expect(inv.vendor_name).toBeNull(); // col A empty
    expect(inv.quantity).toBe(1);
    expect(inv.gst_rate).toBe(12);

    expect(mms.item_category).toBe('Module Mounting Structure');
    expect(mms.vendor_name).toBe('Thanigai');
    expect(mms.unit).toBe('KWp');
    expect(mms.gst_rate).toBe(18); // 0.18 → 18
    expect(mms.actual_quantity).toBe(2);
    expect(mms.actual_unit_price).toBe(3000);
    expect(mms.actual_total_price).toBe(7080);
    expect(mms.remarks).toBe('client Scope');

    // defaults
    expect(pv.bill_status).toBe('na');
    expect(pv.voucher_no).toBeNull();

    // stops at Summary (subtotal/work-order rows are not lines)
    expect(res.lines.every((l) => l.item_description !== 'Work Order Value in rs with Gst & Profit')).toBe(true);

    // summary best-effort
    expect(res.summary.work_order_value).toBeCloseTo(238044.089, 2);
  });

  it('handles the "/Purchase Request" title variant and integer GST', () => {
    const rows = standardRows();
    rows[0] = ['', 'Bill Of Materials/Purchase Request '];
    // make the PV line gst already a percent (18) — should pass through unchanged
    rows[9]![10] = 18;
    const res = parseBomSheet(sheetFrom('GK shetty tulive bellevue', rows));
    expect(res.ok).toBe(true);
    expect(res.lines[0]!.gst_rate).toBe(18);
  });

  it('computes total/actual_total from components when the cell is a formula with no cached result', () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Formula Co');
    ws.addRow(['', 'Bill Of Materials']);
    ws.addRow(['Project Name', 'Formula Co']);
    ws.addRow(COL_HEADER);
    ws.addRow(['Cables', '']); // category
    // contracted qty=10 rate=50 gst=0.18 (total formula); actual qty=5 rate=200 gst=0.18 (total formula)
    const item = ['', '6 sq mm DC Cable', '', '', '', '', 'Polycab', 10, 'Meter', 50, 0.18, '', '', 5, 'Nos', 200, 0.18, '', ''];
    ws.addRow(item.map((v) => (v === '' ? undefined : v)));
    const r = ws.lastRow!.number;
    ws.getCell(r, 13).value = { formula: `H${r}*J${r}` } as unknown as ExcelJS.CellValue; // contracted total
    ws.getCell(r, 19).value = { formula: `N${r}*P${r}` } as unknown as ExcelJS.CellValue; // actual total
    ws.addRow(['Summary']);

    const res = parseBomSheet(ws);
    expect(res.ok).toBe(true);
    const line = res.lines[0]!;
    expect(line.total_price).toBe(590); // 10*50*1.18
    expect(line.actual_quantity).toBe(5);
    expect(line.actual_unit_price).toBe(200);
    expect(line.actual_total_price).toBe(1180); // 5*200*1.18
  });

  it('returns ok:false with a warning when there is no Items/grid header anchor', () => {
    const res = parseBomSheet(
      sheetFrom('Broken', [
        ['', 'Bill Of Materials'],
        ['Project Name', 'Whoever'],
        ['some', 'random', 'rows', 'no header'],
      ]),
    );
    expect(res.ok).toBe(false);
    expect(res.warnings.join(' ')).toMatch(/header/i);
    expect(res.lines).toHaveLength(0);
  });

  it('falls back to the sheet name when the header has no Project Name', () => {
    const rows = standardRows();
    rows[1] = ['', '', '', '', '', '', 'Rev No', 0]; // drop the Project Name pair
    const res = parseBomSheet(sheetFrom('Mr Devadoss', rows));
    expect(res.projectName).toBe('Mr Devadoss');
  });
});

describe('parseBomWorkbook', () => {
  it('parses only BOM sheets and skips PM/summary tabs', async () => {
    const wb = new ExcelJS.Workbook();
    const bom = wb.addWorksheet('Mr Muralidharan');
    for (const row of standardRows()) bom.addRow(row.map((v) => (v === null ? undefined : v)));
    const report = wb.addWorksheet('Project Report');
    report.addRow(['S.No', 'Project /Task Name', 'Syst Size']);
    report.addRow([1, 'BBCL Midland', 50]);
    const buf = (await wb.xlsx.writeBuffer()) as unknown as ArrayBuffer;

    const res = await parseBomWorkbook(buf);
    expect(res.sheets).toHaveLength(1);
    expect(res.sheets[0]!.sheetName).toBe('Mr Muralidharan');
    expect(res.sheets[0]!.lines).toHaveLength(3);
  });
});

describe('normalizeProjectName', () => {
  it('drops honorifics and punctuation for fuzzy matching', () => {
    expect(normalizeProjectName('Mr Muralidharan')).toBe('muralidharan');
    expect(normalizeProjectName("GK Shetty Tulive Bellevue")).toBe('gk shetty tulive bellevue');
    expect(normalizeProjectName('M/s legendary Platina')).toBe('legendary platina');
  });
});
