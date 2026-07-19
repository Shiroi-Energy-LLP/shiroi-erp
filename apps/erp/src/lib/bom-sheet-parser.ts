import ExcelJS from 'exceljs';

// ═══════════════════════════════════════════════════════════════════════
// BOM Sheet Parser
//
// Parses Shiroi's hand-maintained per-project "Bill Of Materials" sheets
// (se-master-file: one sheet per project) into structured lines for the
// staged BOM-import pipeline (/bom-review/import).
//
// The sheets drift between projects (89–194 rows, title variants, shifting
// columns), so parsing is TOLERANT: it anchors on the header row dynamically
// rather than hardcoding column offsets, classifies category-header vs item
// rows, and emits warnings instead of throwing. The mandatory review/edit
// step catches anything it gets wrong — nothing is blind-written.
//
// Layout (anchored on the row containing "Items"):
//   col A          = category name (header rows) OR vendor label (item rows)
//   "Items"        = item description
//   "Make"         = brand
//   contracted block (1st Qty/Units/Rate/Gst/Amount/Total after Make)
//   actual block    (2nd Qty/Units/Rate/Gst/Amount/Total)
//   "Remarks"      = trailing notes
// Stops at the "Summary" row.
// ═══════════════════════════════════════════════════════════════════════

export type BillStatus = 'need_bill' | 'submitted' | 'na';

export interface ParsedBomLine {
  line_number: number;
  item_category: string;
  item_description: string;
  make: string | null;
  vendor_name: string | null;
  // Contracted track
  quantity: number | null;
  unit: string | null;
  unit_price: number | null;
  gst_rate: number | null;
  total_price: number | null;
  // Actual track
  actual_quantity: number | null;
  actual_unit_price: number | null;
  actual_total_price: number | null;
  // Voucher (reserved — per-project sheets rarely carry it inline; editable in review)
  voucher_no: string | null;
  bill_status: BillStatus;
  remarks: string | null;
}

export interface ParsedBomSheet {
  ok: boolean;
  sheetName: string;
  projectName: string;
  normalizedName: string;
  header: Record<string, string>;
  lines: ParsedBomLine[];
  summary: Record<string, number>;
  warnings: string[];
}

export interface ParsedBomWorkbook {
  sheets: ParsedBomSheet[];
  warnings: string[];
}

// ─── Cell helpers (mirrors excel-quote-parser cell normalisation) ──────────────

function cellRaw(cell: ExcelJS.Cell): unknown {
  const v = cell.value;
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'object') {
    if ('result' in v) return (v as { result: unknown }).result ?? null;
    if ('richText' in v) return (v as { richText: Array<{ text: string }> }).richText.map((r) => r.text).join('');
    if ('text' in v) return (v as { text: string }).text;
  }
  return null;
}

function asText(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  if (raw instanceof Date) return raw.toISOString().slice(0, 10);
  return String(raw).trim();
}

function asNum(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

function textAt(row: ExcelJS.Row, col: number | null): string {
  if (!col) return '';
  return asText(cellRaw(row.getCell(col)));
}

function numAt(row: ExcelJS.Row, col: number | null): number | null {
  if (!col) return null;
  return asNum(cellRaw(row.getCell(col)));
}

/** GST in the sheets is a fraction (0.12 / 0.18); the column convention is a percent (12 / 18). */
function normGst(n: number | null): number | null {
  if (n === null) return null;
  if (n > 0 && n <= 1) return Math.round(n * 10000) / 100;
  return n;
}

/**
 * The "Amount"/"Total" cells (especially the Actual track) are Excel formulas
 * (`R10*(1+Q10)`, shared formulas, …) saved WITHOUT a cached result, so exceljs
 * reads them as null. Reconstruct the GST-inclusive total from the component
 * cells — identical to the sheet's own formula — when the cell isn't a number.
 */
function computeTotal(qty: number | null, rate: number | null, gstPercent: number | null): number | null {
  if (qty === null || rate === null) return null;
  return Math.round(qty * rate * (1 + (gstPercent ?? 0) / 100) * 100) / 100;
}

/** Loose key for fuzzy project matching + de-dup; drops honorifics & punctuation. */
export function normalizeProjectName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(mr|mrs|ms|m s|dr)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── Title / anchor detection ──────────────────────────────────────────────────

function isBomTitle(ws: ExcelJS.Worksheet): boolean {
  for (let r = 1; r <= Math.min(3, ws.rowCount || 3); r++) {
    const row = ws.getRow(r);
    for (let c = 1; c <= 6; c++) {
      if (norm(textAt(row, c)).includes('bill of materials')) return true;
    }
  }
  return false;
}

interface ColumnMap {
  headerRow: number;
  descCol: number | null;
  makeCol: number | null;
  remarksCol: number | null;
  con: { qty: number | null; unit: number | null; rate: number | null; gst: number | null; amount: number | null; total: number | null };
  act: { qty: number | null; unit: number | null; rate: number | null; gst: number | null; amount: number | null; total: number | null };
}

function buildColumnMap(ws: ExcelJS.Worksheet): ColumnMap | null {
  const maxScan = Math.min(30, ws.rowCount || 30);
  for (let r = 1; r <= maxScan; r++) {
    const labels: Array<{ col: number; t: string }> = [];
    ws.getRow(r).eachCell({ includeEmpty: false }, (cell, col) => {
      labels.push({ col, t: norm(asText(cellRaw(cell))) });
    });
    const hasItems = labels.some((l) => l.t === 'items');
    const hasGrid = labels.some((l) => l.t === 'qty' || l.t === 'rate' || l.t === 'make');
    if (!hasItems || !hasGrid) continue;

    const first = (t: string) => labels.find((l) => l.t === t)?.col ?? null;
    const all = (t: string) => labels.filter((l) => l.t === t).map((l) => l.col);
    const remarksCol = labels.filter((l) => l.t === 'remarks').map((l) => l.col).pop() ?? null;

    // The grid is always six contiguous columns in fixed order
    // (Qty Units Rate Gst Amount Total) per track. Derive every column from
    // the Qty anchors rather than per-label lookup — the 2nd "Total Amount in
    // Rs" header is sometimes merged/blank in exceljs, which would otherwise
    // drop actual_total_price. Anchors are reliable; the order is invariant.
    const block = (anchor: number | undefined) =>
      anchor === undefined
        ? { qty: null, unit: null, rate: null, gst: null, amount: null, total: null }
        : { qty: anchor, unit: anchor + 1, rate: anchor + 2, gst: anchor + 3, amount: anchor + 4, total: anchor + 5 };
    const qty = all('qty');

    return {
      headerRow: r,
      descCol: first('items'),
      makeCol: first('make'),
      remarksCol,
      con: block(qty[0]),
      // Only treat the 2nd Qty as an actual block if it sits past the contracted block.
      act: qty[1] !== undefined && qty[0] !== undefined && qty[1] >= qty[0] + 5 ? block(qty[1]) : block(undefined),
    };
  }
  return null;
}

// ─── Header + summary blocks ───────────────────────────────────────────────────

const HEADER_LABELS: Record<string, string> = {
  'project name': 'project_name',
  'type of shed': 'type_of_shed',
  'sys size': 'sys_size',
  'system size': 'sys_size',
  loaction: 'location',
  location: 'location',
  'prepared by': 'prepared_by',
  'dc/ac capacity': 'dc_ac_capacity',
  'system configurations': 'system_configurations',
  'slope orientations': 'slope_orientations',
  'final termination points': 'final_termination_points',
  date: 'date',
};

function parseHeaderBlock(ws: ExcelJS.Worksheet, headerRow: number): Record<string, string> {
  const header: Record<string, string> = {};
  for (let r = 1; r < headerRow; r++) {
    const cells: Array<{ col: number; t: string; raw: unknown }> = [];
    ws.getRow(r).eachCell({ includeEmpty: false }, (cell, col) => {
      cells.push({ col, t: norm(asText(cellRaw(cell))), raw: cellRaw(cell) });
    });
    for (const cell of cells) {
      const key = HEADER_LABELS[cell.t];
      if (key && !header[key]) {
        const next = cells.find((c) => c.col > cell.col && asText(c.raw) !== '');
        if (next) header[key] = asText(next.raw);
      }
    }
  }
  return header;
}

const SUMMARY_LABELS: Array<{ match: string; key: string }> = [
  { match: 'work order value in rs with gst', key: 'work_order_value' },
  { match: 'estimate cost in rs with gst', key: 'estimate_cost' },
  { match: 'con profit', key: 'con_profit' },
  { match: 'est/act profit', key: 'act_profit' },
];

function parseSummaryBlock(ws: ExcelJS.Worksheet, fromRow: number): Record<string, number> {
  const summary: Record<string, number> = {};
  for (let r = fromRow; r <= (ws.rowCount || fromRow); r++) {
    const cells: Array<{ col: number; t: string; raw: unknown }> = [];
    ws.getRow(r).eachCell({ includeEmpty: false }, (cell, col) => {
      cells.push({ col, t: norm(asText(cellRaw(cell))), raw: cellRaw(cell) });
    });
    for (const label of SUMMARY_LABELS) {
      if (summary[label.key] !== undefined) continue;
      const hit = cells.find((c) => c.t.includes(label.match));
      if (hit) {
        const valCell = cells.find((c) => c.col > hit.col && asNum(c.raw) !== null);
        if (valCell) summary[label.key] = asNum(valCell.raw)!;
      }
    }
  }
  return summary;
}

// ─── Per-sheet parse ───────────────────────────────────────────────────────────

export function parseBomSheet(ws: ExcelJS.Worksheet): ParsedBomSheet {
  const warnings: string[] = [];
  const base: Omit<ParsedBomSheet, 'ok' | 'lines' | 'summary'> = {
    sheetName: ws.name,
    projectName: ws.name,
    normalizedName: normalizeProjectName(ws.name),
    header: {},
    warnings,
  };

  const map = buildColumnMap(ws);
  if (!map) {
    warnings.push('Could not find the BOM table header (no "Items" + Qty/Rate row). Sheet skipped.');
    return { ...base, ok: false, lines: [], summary: {} };
  }

  const header = parseHeaderBlock(ws, map.headerRow);
  const projectName = header.project_name?.trim() || ws.name;

  const lines: ParsedBomLine[] = [];
  let currentCategory = '';
  let summaryRow = -1;
  let blankStreak = 0;
  const lastRow = ws.rowCount || map.headerRow;

  for (let r = map.headerRow + 1; r <= lastRow; r++) {
    const row = ws.getRow(r);
    const aText = textAt(row, 1);
    const desc = textAt(row, map.descCol);

    if (norm(aText) === 'summary' || norm(desc) === 'summary') {
      summaryRow = r;
      break;
    }

    if (aText === '' && desc === '') {
      if (++blankStreak >= 12) break;
      continue;
    }
    blankStreak = 0;

    // Category header: a labelled row with no description and no contracted qty
    // (its numbers live in the Con/Act subtotal columns, not the line grid).
    if (desc === '' && aText !== '' && numAt(row, map.con.qty) === null) {
      currentCategory = aText;
      continue;
    }
    if (desc === '') continue; // stray non-item row

    const qty = numAt(row, map.con.qty);
    const rate = numAt(row, map.con.rate);
    const gst = normGst(numAt(row, map.con.gst));
    const aQty = numAt(row, map.act.qty);
    const aRate = numAt(row, map.act.rate);
    const aGst = normGst(numAt(row, map.act.gst)) ?? gst;

    lines.push({
      line_number: lines.length + 1,
      item_category: currentCategory || 'Other',
      item_description: desc,
      make: textAt(row, map.makeCol) || null,
      vendor_name: aText || null,
      quantity: qty,
      unit: textAt(row, map.con.unit) || null,
      unit_price: rate,
      gst_rate: gst,
      total_price: numAt(row, map.con.total) ?? computeTotal(qty, rate, gst),
      actual_quantity: aQty,
      actual_unit_price: aRate,
      actual_total_price: numAt(row, map.act.total) ?? computeTotal(aQty, aRate, aGst),
      voucher_no: null,
      bill_status: 'na',
      remarks: textAt(row, map.remarksCol) || null,
    });
  }

  if (lines.length === 0) warnings.push('No line items parsed below the header row.');

  const summary = summaryRow > 0 ? parseSummaryBlock(ws, summaryRow) : {};

  return { ...base, ok: lines.length > 0, projectName, normalizedName: normalizeProjectName(projectName), header, lines, summary };
}

// ─── Workbook parse (filters to BOM sheets) ────────────────────────────────────

const NON_BOM_SHEET = /^(project report|project details|daily report|dashboard|tasks|budgets|services|plant monitoring|activities|rough|rough sheet|sheet\d+)$/i;

export async function parseBomWorkbook(buffer: ArrayBuffer): Promise<ParsedBomWorkbook> {
  const op = '[parseBomWorkbook]';
  const warnings: string[] = [];
  const sheets: ParsedBomSheet[] = [];

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0]);

  for (const ws of wb.worksheets) {
    if (NON_BOM_SHEET.test(ws.name.trim())) continue;
    if (!isBomTitle(ws)) continue;
    const parsed = parseBomSheet(ws);
    if (parsed.ok) sheets.push(parsed);
    else warnings.push(`Sheet "${ws.name}": ${parsed.warnings.join('; ')}`);
  }

  if (sheets.length === 0) warnings.push('No parseable BOM sheets found in the workbook.');
  console.log(`${op} Parsed ${sheets.length} BOM sheet(s) with ${warnings.length} warning(s)`);
  return { sheets, warnings };
}
