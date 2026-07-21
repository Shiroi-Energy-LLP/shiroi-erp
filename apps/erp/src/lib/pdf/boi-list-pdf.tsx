// apps/erp/src/lib/pdf/boi-list-pdf.tsx
// BOI filtered-list export PDF (spec §10) — A4 LANDSCAPE, company-purple
// styling to match boi-po-pdf.tsx (same sheet-app family).
//
// Two column sets:
// - without price: S.No · Project · Category · Item · Make · Qty · Units ·
//   Status · Vendor
// - with price adds: Rate · Amount · GST % · Total Amount (+ GRAND TOTAL
//   footer row = Σ Total Amount of the exported rows)
//
// Header: single-project exports show the project name + stat boxes (only
// "Bill of Items Total" — System Size / Total Budget are not available
// client-side in the workspace; deliberate minor delta from spec §10).
// Multi-project exports show the generated title ("Bill of Items — <active
// filter parts>"). Rows arrive display-ready (status labels already folded
// via displayBoiStatus, category labels resolved) — no DB calls, no
// computation here beyond formatting. Rendered client-side via
// pdf(...).toBlob() from components/purchase-flow/boi-export.tsx.

import React from 'react';
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import { BRAND } from './pdf-styles';

const PURPLE = '#5B21B6';
const PURPLE_DARK = '#4C1D95';

/**
 * en-IN grouping, up to 2 decimals. "Rs." not "₹": react-pdf's builtin
 * Helvetica has no U+20B9 glyph (renders as a superscript "1") — same
 * convention as boi-po-pdf.tsx.
 */
function fmtINR(n: number): string {
  return (
    'Rs. ' + n.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
  );
}

/** One display-ready export row (prepared by boi-export.tsx). */
export interface BoiListPdfRow {
  slNo: number;
  project: string;
  category: string;
  item: string;
  make: string;
  qty: number;
  units: string;
  /** Display label (already folded via displayBoiStatus). */
  status: string;
  vendor: string;
  rate: number;
  /** GST-exclusive qty × rate. */
  amount: number;
  gst: number;
  /** GST-inclusive line total (server-computed total_price). */
  total: number;
}

export interface BoiListPdfProps {
  /** Set when exactly one project is filtered → project-name header mode. */
  projectName: string | null;
  /** Generated title used when projectName is null. */
  title: string;
  withPrice: boolean;
  rows: BoiListPdfRow[];
  /** Σ total of the exported rows (display-only, computed with decimal.js). */
  grandTotal: number;
  /** ISO timestamp. */
  generatedAt: string;
}

const s = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 8,
    color: BRAND.black,
    paddingTop: 36,
    paddingBottom: 40,
    paddingLeft: 36,
    paddingRight: 36,
  },
  topBar: { height: 4, backgroundColor: PURPLE, marginBottom: 14 },
  heading: {
    fontSize: 16,
    fontFamily: 'Helvetica-Bold',
    color: PURPLE_DARK,
    marginBottom: 2,
  },
  subheading: { fontSize: 8, color: BRAND.gray500, marginBottom: 10 },
  statRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  statBox: {
    borderWidth: 1,
    borderColor: BRAND.gray300,
    borderRadius: 4,
    paddingVertical: 6,
    paddingHorizontal: 12,
    minWidth: 130,
  },
  statLabel: {
    fontSize: 6.5,
    fontFamily: 'Helvetica-Bold',
    color: BRAND.gray500,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  statValue: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: PURPLE_DARK },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: PURPLE,
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  tableHeaderText: { fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: BRAND.white },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 4,
    paddingHorizontal: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: BRAND.gray300,
  },
  tableRowAlt: {
    flexDirection: 'row',
    paddingVertical: 4,
    paddingHorizontal: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: BRAND.gray300,
    backgroundColor: BRAND.gray50,
  },
  tableCell: { fontSize: 7.5, color: BRAND.black, paddingRight: 3 },
  grandRow: {
    flexDirection: 'row',
    paddingVertical: 6,
    paddingHorizontal: 4,
    backgroundColor: PURPLE,
  },
  grandLabel: { fontSize: 8.5, fontFamily: 'Helvetica-Bold', color: BRAND.white },
  grandValue: {
    fontSize: 8.5,
    fontFamily: 'Helvetica-Bold',
    color: BRAND.white,
    textAlign: 'right' as const,
    paddingRight: 3,
  },
  footer: {
    position: 'absolute' as const,
    bottom: 20,
    left: 36,
    right: 36,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  footerText: { fontSize: 7, color: BRAND.gray500 },
});

interface ColDef {
  key: keyof BoiListPdfRow;
  label: string;
  width: string;
  align?: 'right';
  fmt?: (row: BoiListPdfRow) => string;
}

// Column order mirrors the on-screen table (spec §5): Vendor last, price
// columns between Status and Vendor.
const COLS_NO_PRICE: ColDef[] = [
  { key: 'slNo', label: 'S.No', width: '4%' },
  { key: 'project', label: 'Project', width: '16%' },
  { key: 'category', label: 'Category', width: '12%' },
  { key: 'item', label: 'Item', width: '25%' },
  { key: 'make', label: 'Make', width: '11%' },
  { key: 'qty', label: 'Qty', width: '6%', align: 'right' },
  { key: 'units', label: 'Units', width: '6%' },
  { key: 'status', label: 'Status', width: '10%' },
  { key: 'vendor', label: 'Vendor', width: '10%' },
];

const COLS_WITH_PRICE: ColDef[] = [
  { key: 'slNo', label: 'S.No', width: '3%' },
  { key: 'project', label: 'Project', width: '11%' },
  { key: 'category', label: 'Category', width: '8%' },
  { key: 'item', label: 'Item', width: '16%' },
  { key: 'make', label: 'Make', width: '8%' },
  { key: 'qty', label: 'Qty', width: '4%', align: 'right' },
  { key: 'units', label: 'Units', width: '4%' },
  { key: 'status', label: 'Status', width: '8%' },
  { key: 'rate', label: 'Rate', width: '8%', align: 'right', fmt: (r) => fmtINR(r.rate) },
  { key: 'amount', label: 'Amount', width: '9%', align: 'right', fmt: (r) => fmtINR(r.amount) },
  { key: 'gst', label: 'GST %', width: '4%', align: 'right', fmt: (r) => `${r.gst}%` },
  {
    key: 'total',
    label: 'Total Amount',
    width: '9%',
    align: 'right',
    fmt: (r) => fmtINR(r.total),
  },
  { key: 'vendor', label: 'Vendor', width: '8%' },
];

function cellText(col: ColDef, row: BoiListPdfRow): string {
  if (col.fmt) return col.fmt(row);
  const v = row[col.key];
  return typeof v === 'number' ? String(v) : v;
}

export function BoiListPdf({
  projectName,
  title,
  withPrice,
  rows,
  grandTotal,
  generatedAt,
}: BoiListPdfProps) {
  const cols = withPrice ? COLS_WITH_PRICE : COLS_NO_PRICE;
  const dateStr = new Date(generatedAt).toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  // GRAND TOTAL footer: label spans every column before "Total Amount"
  // (100 − 9 − 8 = 83%), then the value under Total Amount, blank Vendor.
  return (
    <Document>
      <Page size="A4" orientation="landscape" style={s.page}>
        <View style={s.topBar} />
        <Text style={s.heading}>{projectName ?? title}</Text>
        <Text style={s.subheading}>
          {projectName ? 'Bill of Items — ' : ''}
          {rows.length} line{rows.length === 1 ? '' : 's'} · Generated {dateStr}
        </Text>

        {projectName && withPrice && (
          <View style={s.statRow}>
            <View style={s.statBox}>
              <Text style={s.statLabel}>Bill of Items Total</Text>
              <Text style={s.statValue}>{fmtINR(grandTotal)}</Text>
            </View>
          </View>
        )}

        <View style={s.tableHeader}>
          {cols.map((c) => (
            <Text
              key={c.key}
              style={[
                s.tableHeaderText,
                { width: c.width },
                ...(c.align ? [{ textAlign: c.align, paddingRight: 3 }] : []),
              ]}
            >
              {c.label}
            </Text>
          ))}
        </View>
        {rows.map((row, idx) => (
          <View key={row.slNo} style={idx % 2 === 0 ? s.tableRow : s.tableRowAlt} wrap={false}>
            {cols.map((c) => (
              <Text
                key={c.key}
                style={[
                  s.tableCell,
                  { width: c.width },
                  ...(c.align ? [{ textAlign: c.align }] : []),
                ]}
              >
                {cellText(c, row)}
              </Text>
            ))}
          </View>
        ))}

        {withPrice && (
          <View style={s.grandRow} wrap={false}>
            <Text style={[s.grandLabel, { width: '83%' }]}>GRAND TOTAL</Text>
            <Text style={[s.grandValue, { width: '9%' }]}>{fmtINR(grandTotal)}</Text>
            <Text style={{ width: '8%' }} />
          </View>
        )}

        <View style={s.footer} fixed>
          <Text style={s.footerText}>Shiroi Energy LLP — Bill of Items</Text>
          <Text
            style={s.footerText}
            render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
          />
        </View>
      </Page>
    </Document>
  );
}
