'use client';

// =============================================================================
// BOI export buttons (spec §10) — "Download CSV" + "Download PDF" in the
// workspace filter row. Each button opens a chooser dropdown:
//   💰 With Price   (Rate · Amount · GST % · Total Amount + GRAND TOTAL row)
//                   — rendered ONLY for price-visible viewers
//   📄 Without Price (Project · Category · Item · Make · Qty · Units · Status ·
//                   Vendor only)
// Exports cover EXACTLY the currently filtered rows in their current order.
//
// Spreadsheet note: the spec asks for .xlsx, but neither `xlsx` (SheetJS) nor
// `exceljs` is declared in apps/erp's dependencies (both live in the ROOT
// package.json for scripts/ use only), and adding a client bundle dependency
// was out of scope — so the spreadsheet export ships as CSV (UTF-8 BOM, opens
// directly in Excel) with the same columns and GRAND TOTAL row.
//
// PDF renders client-side via pdf(...).toBlob() (dynamic import — same pattern
// as components/procurement/boq-download-button.tsx). Money is display-only
// aggregation: Amount = qty × rate and GRAND TOTAL = Σ total_price, both
// computed with decimal.js (money of record stays server-side).
//
// Filenames (spec §10): <base>_BOI.pdf / <base>_BOI_noprice.pdf (and .csv),
// base = sanitized project name when a single project is filtered, else
// 'Bill_of_Items'.
// =============================================================================

import * as React from 'react';
import Decimal from 'decimal.js';
import { FileSpreadsheet, FileText } from 'lucide-react';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  useToast,
} from '@repo/ui';
import {
  BOI_STATUS_LABELS,
  displayBoiStatus,
  type BoiLineRow,
} from '@/lib/purchase-flow-constants';
import type { BoiListPdfRow } from '@/lib/pdf/boi-list-pdf';

interface BoiExportButtonsProps {
  /** The currently filtered rows, in current display order. */
  rows: BoiLineRow[];
  /** Viewer may see money (PRICE_VISIBLE_ROLES) — gates the With Price option. */
  showPrices: boolean;
  /** Category value → display label map (item_categories master). */
  categoryLabels: Record<string, string>;
  /** Display name of the single filtered project, or null. */
  projectName: string | null;
  /** Active-filter display parts for the generated multi-project title. */
  statusLabel: string | null;
  categoryLabel: string | null;
  vendorLabel: string | null;
}

/** "Bill of Items — <status> — <category> — <vendor>" (active parts only). */
function buildTitle(
  statusLabel: string | null,
  categoryLabel: string | null,
  vendorLabel: string | null,
): string {
  return ['Bill of Items', statusLabel, categoryLabel, vendorLabel]
    .filter((p): p is string => !!p)
    .join(' — ');
}

/** Filesystem-safe filename base (spaces → _, strip everything exotic). */
function sanitizeFileBase(name: string): string {
  const cleaned = name
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^A-Za-z0-9_-]/g, '');
  return cleaned || 'Bill_of_Items';
}

/** Display-ready export rows shared by the CSV and PDF paths. */
function buildExportRows(
  rows: BoiLineRow[],
  categoryLabels: Record<string, string>,
): BoiListPdfRow[] {
  return rows.map((row, idx) => ({
    slNo: idx + 1,
    project: row.project_display_name,
    category: categoryLabels[row.item_category] ?? row.item_category,
    item: row.item_description,
    make: [row.brand, row.model].filter(Boolean).join(' '),
    qty: row.quantity,
    units: row.unit,
    status: BOI_STATUS_LABELS[displayBoiStatus(row.procurement_status)],
    vendor: row.vendor_name ?? '',
    rate: row.unit_price,
    amount: new Decimal(row.quantity).mul(row.unit_price).toNumber(),
    gst: row.gst_rate,
    total: row.total_price,
  }));
}

/** Σ total_price — display-only, decimal.js (NEVER-DO #12 exemption: UI sum). */
function computeGrandTotal(rows: BoiLineRow[]): number {
  return rows
    .reduce((acc, r) => acc.plus(r.total_price ?? 0), new Decimal(0))
    .toNumber();
}

function csvEscape(value: string): string {
  // Neutralize spreadsheet formula injection: prefix ' when a cell leads with
  // =, +, @ (or a non-numeric -), so Excel treats it as text, not a formula.
  const risky =
    /^[=+@]/.test(value) || (value.startsWith('-') && !/^-\d+(\.\d+)?$/.test(value));
  const safe = risky ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function buildCsv(
  exportRows: BoiListPdfRow[],
  withPrice: boolean,
  heading: string,
  grandTotal: number,
): string {
  const header = withPrice
    ? ['Project', 'Category', 'Item', 'Make', 'Qty', 'Units', 'Status', 'Rate', 'Amount', 'GST %', 'Total Amount', 'Vendor']
    : ['Project', 'Category', 'Item', 'Make', 'Qty', 'Units', 'Status', 'Vendor'];
  const lines: string[][] = [
    [heading],
    [`Generated ${new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}`],
    [],
    header,
  ];
  for (const r of exportRows) {
    const base = [r.project, r.category, r.item, r.make, String(r.qty), r.units, r.status];
    lines.push(
      withPrice
        ? [...base, r.rate.toFixed(2), r.amount.toFixed(2), String(r.gst), r.total.toFixed(2), r.vendor]
        : [...base, r.vendor],
    );
  }
  if (withPrice) {
    lines.push(['GRAND TOTAL', '', '', '', '', '', '', '', '', '', grandTotal.toFixed(2), '']);
  }
  return lines.map((cells) => cells.map(csvEscape).join(',')).join('\r\n');
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function BoiExportButtons({
  rows,
  showPrices,
  categoryLabels,
  projectName,
  statusLabel,
  categoryLabel,
  vendorLabel,
}: BoiExportButtonsProps) {
  const { addToast } = useToast();
  const [busy, setBusy] = React.useState(false);

  const disabled = busy || rows.length === 0;
  const fileBase = projectName ? sanitizeFileBase(projectName) : 'Bill_of_Items';

  function handleCsv(withPrice: boolean) {
    const op = '[BoiExportButtons.handleCsv]';
    try {
      const exportRows = buildExportRows(rows, categoryLabels);
      const heading = projectName ?? buildTitle(statusLabel, categoryLabel, vendorLabel);
      const csv = buildCsv(exportRows, withPrice, heading, computeGrandTotal(rows));
      // UTF-8 BOM (U+FEFF) so Excel opens the file with correct encoding.
      const bom = String.fromCharCode(0xfeff);
      const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8' });
      triggerDownload(blob, `${fileBase}_BOI${withPrice ? '' : '_noprice'}.csv`);
    } catch (error) {
      console.error(`${op} CSV generation failed`, { error, timestamp: new Date().toISOString() });
      addToast({ variant: 'destructive', title: 'CSV export failed' });
    }
  }

  async function handlePdf(withPrice: boolean) {
    const op = '[BoiExportButtons.handlePdf]';
    setBusy(true);
    try {
      // Dynamic imports keep @react-pdf/renderer out of the initial bundle
      // (same pattern as boq-download-button.tsx).
      const { pdf } = await import('@react-pdf/renderer');
      const { BoiListPdf } = await import('@/lib/pdf/boi-list-pdf');
      const blob = await pdf(
        <BoiListPdf
          projectName={projectName}
          title={buildTitle(statusLabel, categoryLabel, vendorLabel)}
          withPrice={withPrice}
          rows={buildExportRows(rows, categoryLabels)}
          grandTotal={computeGrandTotal(rows)}
          generatedAt={new Date().toISOString()}
        />,
      ).toBlob();
      triggerDownload(blob, `${fileBase}_BOI${withPrice ? '' : '_noprice'}.pdf`);
    } catch (error) {
      console.error(`${op} PDF generation failed`, { error, timestamp: new Date().toISOString() });
      addToast({ variant: 'destructive', title: 'PDF export failed' });
    } finally {
      setBusy(false);
    }
  }

  // The chooser: With Price is NOT RENDERED (not just disabled) for
  // non-price-visible viewers (spec §10 / §1).
  function chooser(onPick: (withPrice: boolean) => void) {
    return (
      <DropdownMenuContent align="end">
        {showPrices && (
          <DropdownMenuItem className="text-xs" onSelect={() => onPick(true)}>
            💰 With Price
          </DropdownMenuItem>
        )}
        <DropdownMenuItem className="text-xs" onSelect={() => onPick(false)}>
          📄 Without Price
        </DropdownMenuItem>
      </DropdownMenuContent>
    );
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-xs"
            disabled={disabled}
            title="Download the filtered rows as a spreadsheet (CSV)"
          >
            <FileSpreadsheet className="h-3.5 w-3.5" /> Download CSV
          </Button>
        </DropdownMenuTrigger>
        {chooser(handleCsv)}
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-xs"
            disabled={disabled}
            title="Download the filtered rows as a PDF"
          >
            <FileText className="h-3.5 w-3.5" /> Download PDF
          </Button>
        </DropdownMenuTrigger>
        {chooser((withPrice) => void handlePdf(withPrice))}
      </DropdownMenu>
    </>
  );
}
