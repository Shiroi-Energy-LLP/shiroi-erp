/**
 * Phase 2.2: Deterministic Excel BOM/Costing Sheet Parser
 *
 * Parses Shiroi's costing Excel files to extract:
 *   - BOM line items (item, qty, rate, amount, GST)
 *   - System size (kWp)
 *   - Summary financials (supply cost, installation cost, GST)
 *
 * Handles multiple formats found in Shiroi's storage:
 *   - Detailed BOM with S.No | Description | Unit | Qty | Rate | Amount | GST% | Total
 *   - Summary BOM with Description | Qty | Cost | Amount
 *   - Pricing matrix sheets (system sizes across columns)
 *
 * Usage:
 *   import { parseCostingSheet } from './excel-parser';
 *   const result = await parseCostingSheet(buffer);
 */

import ExcelJS from 'exceljs';

// ─── Types ───

export interface ParsedBOM {
  system_size_kwp: number | null;
  bom_lines: ParsedBOMLine[];
  summary: {
    supply_cost: number | null;
    installation_cost: number | null;
    gst_supply: number | null;
    gst_installation: number | null;
    total_cost: number | null;
  };
  sheets_parsed: string[];
  parse_quality: 'high' | 'medium' | 'low' | 'empty';
}

export interface ParsedBOMLine {
  line_number: number;
  item_category: string;
  item_description: string;
  brand: string | null;
  model: string | null;
  hsn_code: string | null;
  quantity: number;
  unit: string;
  unit_price: number;
  total_price: number;
  gst_rate: number;
  gst_type: 'supply' | 'works_contract';
}

// ─── Item Category Classification ───

// DB categories: panel, inverter, battery, structure, dc_cable, ac_cable, ht_cable,
// conduit, earthing, acdb, dcdb, lt_panel, ht_panel, transformer, bus_duct,
// lightning_arrestor, connector, junction_box, monitoring, net_meter,
// civil_work, installation_labour, liaison, transport, safety_equipment, other
const CATEGORY_PATTERNS: [RegExp, string, 'supply' | 'works_contract'][] = [
  [/solar\s*panel|photovoltaic|module|dcr\s*panel/i, 'panel', 'supply'],
  [/inverter|grid\s*tie/i, 'inverter', 'supply'],
  [/mounting\s*structure|mms|module\s*mount|roof\s*top.*struct|^structure\b/i, 'structure', 'supply'],
  [/fabricat.*struct|ms\s*structure|gi\s*structure/i, 'structure', 'supply'],
  [/dc\s*wire|dc\s*cable|1c.*sq\s*mm|solar\s*cable/i, 'dc_cable', 'supply'],
  [/ac\s*cable|ac.*wire|4c.*sq\s*mm|xlpe|lt\s*cable/i, 'ac_cable', 'supply'],
  [/ht\s*cable/i, 'ht_cable', 'supply'],
  [/dcdb|dc\s*distribution/i, 'dcdb', 'supply'],
  [/acdb|ac\s*distribution|ac\s*box/i, 'acdb', 'supply'],
  [/lt\s*panel|lt\s*switchgear|breaker.*panel/i, 'lt_panel', 'supply'],
  [/ht\s*panel/i, 'ht_panel', 'supply'],
  [/transformer/i, 'transformer', 'supply'],
  [/bus\s*duct/i, 'bus_duct', 'supply'],
  [/earth|grounding|gi\s*strip|gi\s*earth|earthing/i, 'earthing', 'supply'],
  [/lightning|la\b|surge/i, 'lightning_arrestor', 'supply'],
  [/mc4|connector/i, 'connector', 'supply'],
  [/junction\s*box|ajb|mjb/i, 'junction_box', 'supply'],
  [/conduit|tray|pipe(?!line)|upvc/i, 'conduit', 'supply'],
  [/monitor|data\s*logger|scada|communication/i, 'monitoring', 'supply'],
  [/civil|trench|foundation|concrete|plinth/i, 'civil_work', 'works_contract'],
  [/install|erect|commission|labour|labor/i, 'installation_labour', 'works_contract'],
  [/liason|liaison/i, 'liaison', 'works_contract'],
  [/net\s*meter|ceig|tangedco|tneb/i, 'net_meter', 'works_contract'],
  [/transport|freight|logistics|shipping/i, 'transport', 'works_contract'],
  [/fire\s*ext|fire\s*fight|safety/i, 'safety_equipment', 'supply'],
  [/battery|storage/i, 'battery', 'supply'],
  [/circuit\s*breaker|mcb|mccb/i, 'other', 'supply'],
];

function classifyItem(description: string): { category: string; gst_type: 'supply' | 'works_contract' } {
  for (const [pattern, category, gst_type] of CATEGORY_PATTERNS) {
    if (pattern.test(description)) {
      return { category, gst_type };
    }
  }
  return { category: 'other', gst_type: 'supply' };
}

// ─── Cell value helpers ───

function cellToString(cell: ExcelJS.Cell): string {
  const val = cell.value;
  if (val === null || val === undefined) return '';
  if (typeof val === 'object' && 'result' in (val as any)) {
    return String((val as any).result ?? '');
  }
  return String(val).trim();
}

function cellToNumber(cell: ExcelJS.Cell): number {
  const val = cell.value;
  if (val === null || val === undefined) return 0;
  if (typeof val === 'number') return val;
  if (typeof val === 'object' && 'result' in (val as any)) {
    const r = (val as any).result;
    if (typeof r === 'number') return r;
    const parsed = parseFloat(String(r));
    return isNaN(parsed) ? 0 : parsed;
  }
  const parsed = parseFloat(String(val).replace(/[₹,\s]/g, ''));
  return isNaN(parsed) ? 0 : parsed;
}

// ─── System size detection ───

function extractSystemSize(text: string): number | null {
  // Try MWp/MW first (larger projects)
  const mwMatch = text.match(/(\d+\.?\d*)\s*(?:MWp|MW)/i);
  if (mwMatch) return parseFloat(mwMatch[1]) * 1000;

  // Then kWp/kW
  const kwMatch = text.match(/(\d+\.?\d*)\s*(?:kWp|KWp|kW|KW)/i);
  if (kwMatch) return parseFloat(kwMatch[1]);

  return null;
}

function findSystemSize(workbook: ExcelJS.Workbook): number | null {
  // Strategy 1: Sheet names often contain system size
  for (const sheet of workbook.worksheets) {
    const size = extractSystemSize(sheet.name);
    if (size) return size;
  }

  // Strategy 2: Scan first 20 rows of each sheet for "System Size" cell
  for (const sheet of workbook.worksheets) {
    for (let r = 1; r <= Math.min(sheet.rowCount, 20); r++) {
      const row = sheet.getRow(r);
      for (let c = 1; c <= Math.min(sheet.columnCount, 10); c++) {
        const text = cellToString(row.getCell(c));
        if (/system\s*size|plant\s*size|plant\s*capacity/i.test(text)) {
          // Check next cell or same row for the number
          for (let nc = c + 1; nc <= Math.min(sheet.columnCount, c + 3); nc++) {
            const numVal = cellToNumber(row.getCell(nc));
            if (numVal > 0 && numVal < 100000) return numVal;
          }
          // Also check if the text itself contains the size
          const size = extractSystemSize(text);
          if (size) return size;
        }
      }
    }
  }

  return null;
}

// ─── Header row detection ───

interface HeaderMapping {
  snoCol: number;
  descCol: number;
  qtyCol: number;
  unitCol: number;
  rateCol: number;
  amountCol: number;
  gstCol: number;
  totalCol: number;
  brandCol: number;
  hsnCol: number;
}

function detectHeaderRow(sheet: ExcelJS.Worksheet): { row: number; mapping: HeaderMapping } | null {
  const maxScan = Math.min(sheet.rowCount, 25);

  for (let r = 1; r <= maxScan; r++) {
    const row = sheet.getRow(r);
    const cells: string[] = [];
    for (let c = 1; c <= Math.min(sheet.columnCount, 20); c++) {
      cells.push(cellToString(row.getCell(c)).toLowerCase());
    }

    // Relaxed header matching for Indian solar costing sheets
    // Description: "Items", "Item Description", "Description", "Particulars", "Material", "Component"
    const descIdx = cells.findIndex((c) => /description|item|particulars|material|component/i.test(c));
    // Quantity: "Qty", "Quantity", "Quantity (Nos)", "QTY.", "Nos"
    const qtyIdx = cells.findIndex((c) => /qty|quantity|qtty|nos/i.test(c));
    // Rate: "Rate", "Rate(Rs.)", "Cost", "Unit Price", "Price"
    const rateIdx = cells.findIndex((c) => /rate|cost|price.*unit|unit.*price/i.test(c));
    // Amount: "Amount", "Amount(Rs.)", "Amount In Rs", "Total Amount"
    const amountIdx = cells.findIndex((c) => /amount/i.test(c));
    // Total: "Total Cost", "Total Cost(Rs.)", "Total Amount in Rs"
    const totalIdx = cells.findIndex((c) => /total\s*cost|total.*rs|total.*price/i.test(c));

    // Require description + at least 2 of: qty, rate, amount, total — avoids false positives on title rows
    const numericCols = [qtyIdx, rateIdx, amountIdx, totalIdx].filter(i => i >= 0 && i !== descIdx).length;
    if (descIdx >= 0 && numericCols >= 2) {
      return {
        row: r,
        mapping: {
          snoCol: cells.findIndex((c) => /^s\.?no|^sl\.?\s*no/i.test(c)),
          descCol: descIdx,
          qtyCol: qtyIdx >= 0 ? qtyIdx : -1,
          unitCol: cells.findIndex((c) => /^unit$/i.test(c)),
          rateCol: rateIdx >= 0 ? rateIdx : cells.findIndex((c) => /cost/i.test(c)),
          amountCol: amountIdx >= 0 ? amountIdx : -1,
          gstCol: cells.findIndex((c) => /gst|tax|input\s*tax/i.test(c)),
          totalCol: totalIdx >= 0 ? totalIdx : -1,
          brandCol: cells.findIndex((c) => /brand|make/i.test(c)),
          hsnCol: cells.findIndex((c) => /hsn/i.test(c)),
        },
      };
    }
  }
  return null;
}

// ─── Parse a single BOM sheet ───

function parseBOMSheet(sheet: ExcelJS.Worksheet): ParsedBOMLine[] {
  const header = detectHeaderRow(sheet);
  if (!header) return [];

  const { row: headerRow, mapping: m } = header;
  const lines: ParsedBOMLine[] = [];
  let lineNumber = 0;
  let currentSection = '';

  for (let r = headerRow + 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const desc = m.descCol >= 0 ? cellToString(row.getCell(m.descCol + 1)) : '';
    const qty = m.qtyCol >= 0 ? cellToNumber(row.getCell(m.qtyCol + 1)) : 0;
    const rate = m.rateCol >= 0 ? cellToNumber(row.getCell(m.rateCol + 1)) : 0;
    const amount = m.amountCol >= 0 ? cellToNumber(row.getCell(m.amountCol + 1)) : 0;
    const gstVal = m.gstCol >= 0 ? cellToNumber(row.getCell(m.gstCol + 1)) : 0;
    const totalVal = m.totalCol >= 0 ? cellToNumber(row.getCell(m.totalCol + 1)) : 0;
    const unit = m.unitCol >= 0 ? cellToString(row.getCell(m.unitCol + 1)) : '';
    const brand = m.brandCol >= 0 ? cellToString(row.getCell(m.brandCol + 1)) : '';
    const hsn = m.hsnCol >= 0 ? cellToString(row.getCell(m.hsnCol + 1)) : '';
    const sno = m.snoCol >= 0 ? cellToString(row.getCell(m.snoCol + 1)) : '';

    // Skip empty rows
    if (!desc && !qty && !amount && !totalVal) continue;

    // Detect section headers (no amounts, just text)
    if (desc && !qty && !amount && !rate && !totalVal) {
      // Could be a section header like "DC Side", "AC Side", etc.
      if (!/total|subtotal|grand|note|remark|term|condition/i.test(desc)) {
        currentSection = desc;
      }
      continue;
    }

    // Skip total/subtotal rows
    if (/^(sub)?total|grand\s*total|material\s*cost|system\s*cost/i.test(desc)) continue;

    // Skip rows with empty description but an amount (subtotal rows)
    if (!desc && !sno && (amount > 0 || totalVal > 0)) continue;

    // Must have some numeric value to be a BOM line
    const effectiveAmount = totalVal || amount || (qty * rate);
    if (effectiveAmount <= 0) continue;

    // Skip if description is just a number (like "Cost Per Watt" followed by value)
    if (/^cost\s*per\s*watt$/i.test(desc)) continue;

    // Reject capex-summary or pricing-matrix rows masquerading as line items.
    // Symptoms (from corruption analysis 2026-04-30):
    //   - "Cost /KW in Rs", "Cost per kW", "Total Project Value" etc. appearing
    //     in the description column with huge qty/unit_price.
    //   - "Unnamed item" (description is empty/whitespace) but with ₹crore-scale total.
    if (/^cost\s*\/?\s*kw|^cost\s*per\s*kw|^total\s*project|^grand\s*total|^project\s*cost/i.test(desc)) continue;
    if ((!desc || desc.trim().length === 0) && effectiveAmount > 5_000_000) continue; // empty desc + > ₹50L = sus
    // No real residential line item is > ₹50L; commercial rarely > ₹2Cr per line.
    if (effectiveAmount > 50_000_000) {
      console.warn(`[excel-parser] Skipping line with implausible total ₹${effectiveAmount}: "${desc.slice(0, 80)}"`);
      continue;
    }

    const { category, gst_type } = classifyItem(desc || currentSection);

    // Determine GST rate
    let gstRate = 0;
    if (gstVal > 0 && gstVal <= 1) gstRate = gstVal * 100; // 0.12 → 12
    else if (gstVal > 1 && gstVal <= 100) gstRate = gstVal; // 12 or 18
    else if (gst_type === 'works_contract') gstRate = 18;
    else gstRate = 12; // default for supply items

    lineNumber++;
    lines.push({
      line_number: lineNumber,
      item_category: category,
      item_description: desc.substring(0, 500),
      brand: brand || null,
      model: null,
      hsn_code: hsn || null,
      quantity: qty || 1,
      unit: unit || 'LS',
      unit_price: rate || (qty > 0 ? effectiveAmount / qty : effectiveAmount),
      total_price: effectiveAmount,
      gst_rate: gstRate,
      gst_type,
    });
  }

  return lines;
}

// ─── Parse summary/cost sheet for totals ───

function parseSummarySheet(sheet: ExcelJS.Worksheet): ParsedBOM['summary'] {
  const summary: ParsedBOM['summary'] = {
    supply_cost: null,
    installation_cost: null,
    gst_supply: null,
    gst_installation: null,
    total_cost: null,
  };

  for (let r = 1; r <= Math.min(sheet.rowCount, 60); r++) {
    const row = sheet.getRow(r);
    for (let c = 1; c <= Math.min(sheet.columnCount, 10); c++) {
      const text = cellToString(row.getCell(c)).toLowerCase();
      const nextVal = cellToNumber(row.getCell(c + 1));

      if (nextVal <= 0) continue;

      if (/supply\s*cost(?!\s*incl)/i.test(text) && !summary.supply_cost) {
        summary.supply_cost = nextVal;
      } else if (/installation\s*cost|service.*cost/i.test(text) && !summary.installation_cost) {
        summary.installation_cost = nextVal;
      } else if (/gst.*12|12.*gst.*supply/i.test(text) && !summary.gst_supply) {
        summary.gst_supply = nextVal;
      } else if (/gst.*18|18.*gst.*install|18.*gst.*service/i.test(text) && !summary.gst_installation) {
        summary.gst_installation = nextVal;
      } else if (/grand\s*total|total\s*cost.*incl|total\s*cost\s*\(/i.test(text) && !summary.total_cost) {
        summary.total_cost = nextVal;
      }
    }
  }

  return summary;
}

// ─── Choose best BOM sheet ───

function scoreBOMSheet(name: string): number {
  const lower = name.toLowerCase();
  // Prefer sheets with these names
  if (/^detailed\s*bom/i.test(lower)) return 100;
  if (/^bom\b/i.test(lower)) return 90;
  if (/^client\s*bom/i.test(lower)) return 80;
  if (/costing/i.test(lower)) return 70;
  if (/boq/i.test(lower)) return 60;
  if (/kwp|kw\b/i.test(lower)) return 50;
  if (/capex/i.test(lower)) return 40;
  return 0;
}

// ─── Main parser ───

export async function parseCostingSheet(buffer: Buffer): Promise<ParsedBOM> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const systemSize = findSystemSize(workbook);

  // Sort sheets by BOM relevance
  const sortedSheets = [...workbook.worksheets].sort(
    (a, b) => scoreBOMSheet(b.name) - scoreBOMSheet(a.name)
  );

  // Try each sheet until we find BOM lines
  let bestLines: ParsedBOMLine[] = [];
  let bestSheetName = '';

  for (const sheet of sortedSheets) {
    const lines = parseBOMSheet(sheet);
    if (lines.length > bestLines.length) {
      bestLines = lines;
      bestSheetName = sheet.name;
    }
    // If we found a good BOM (5+ lines), stop
    if (bestLines.length >= 5) break;
  }

  // Parse summary from cost/summary sheets
  let summary: ParsedBOM['summary'] = {
    supply_cost: null,
    installation_cost: null,
    gst_supply: null,
    gst_installation: null,
    total_cost: null,
  };

  for (const sheet of workbook.worksheets) {
    const lower = sheet.name.toLowerCase();
    if (/cost|capex|summary|intro|pricing/i.test(lower)) {
      const s = parseSummarySheet(sheet);
      // Merge non-null values
      if (s.supply_cost && !summary.supply_cost) summary.supply_cost = s.supply_cost;
      if (s.installation_cost && !summary.installation_cost) summary.installation_cost = s.installation_cost;
      if (s.gst_supply && !summary.gst_supply) summary.gst_supply = s.gst_supply;
      if (s.gst_installation && !summary.gst_installation) summary.gst_installation = s.gst_installation;
      if (s.total_cost && !summary.total_cost) summary.total_cost = s.total_cost;
    }
  }

  // If no total from summary, calculate from BOM lines
  if (!summary.total_cost && bestLines.length > 0) {
    summary.total_cost = bestLines.reduce((sum, l) => sum + l.total_price, 0);
  }

  // SANITY CHECK — see docs/superpowers/plans/2026-04-30-proposal-corruption-implementation.md
  // Real Shiroi installs cap out around ₹2L/kWp (premium hybrid + battery).
  // ₹5L/kWp is already implausible. Reject anything beyond as a wrong-file extraction
  // (capex summary mistaken for BOM, multi-project pricing matrix, etc.).
  const MAX_PLAUSIBLE_PER_KWP = 500_000;
  if (systemSize && systemSize > 0 && summary.total_cost) {
    const perKwp = summary.total_cost / systemSize;
    if (perKwp > MAX_PLAUSIBLE_PER_KWP) {
      console.warn(
        `[excel-parser] Rejecting summary: ₹${summary.total_cost} for ${systemSize} kWp ` +
        `= ₹${Math.round(perKwp)}/kWp > ₹${MAX_PLAUSIBLE_PER_KWP}/kWp ceiling. Likely wrong file.`,
      );
      summary.supply_cost = null;
      summary.installation_cost = null;
      summary.gst_supply = null;
      summary.gst_installation = null;
      summary.total_cost = null;
      bestLines = []; // discard the contaminating lines too
      bestSheetName = '';
    }
  }

  // Determine parse quality
  let quality: ParsedBOM['parse_quality'] = 'empty';
  if (bestLines.length >= 5 && systemSize) quality = 'high';
  else if (bestLines.length >= 3) quality = 'medium';
  else if (bestLines.length > 0 || summary.total_cost) quality = 'low';

  return {
    system_size_kwp: systemSize,
    bom_lines: bestLines,
    summary,
    sheets_parsed: bestSheetName ? [bestSheetName] : [],
    parse_quality: quality,
  };
}
