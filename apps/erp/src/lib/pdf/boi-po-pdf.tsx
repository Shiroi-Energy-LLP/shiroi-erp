// apps/erp/src/lib/pdf/boi-po-pdf.tsx
// BOI quick-PO PDF (spec §6.2.4 — DELIBERATELY minimal).
//
// A4 portrait, company-purple styling. Title "PURCHASE ORDER" + PO number,
// info grid (Project | Payment Terms // Vendor | Transport // Delivery Date |
// Delivery Place, "-" when blank), "MATERIAL SPECIFICATION & COST BREAKDOWN"
// table (S.No · `Item — Make` · `qty unit` · Unit Price · Total, ₹ whole
// rupees en-IN), right-aligned totals box Subtotal / GST(x% when uniform,
// else "GST") / **Net Amount** bold.
//
// NO company letterhead/address/GSTIN, no signature block, no per-line GST
// column, no vendor address — that is the point (do NOT "improve" this with
// the letterhead purchase-order-pdf.tsx template). Data comes in as a typed
// props object — no DB calls inside the component (assembled by
// purchase-flow-pdf.tsx).

import React from 'react';
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import { BRAND } from './pdf-styles';

// Company-purple accent of the original "Bill of Items Manager" sheet app
// (dark-purple sidebar, purple table headers). pdf-styles' BRAND palette is
// gold-centric, so the purple lives here — neutrals still come from BRAND.
const PURPLE = '#5B21B6';
const PURPLE_DARK = '#4C1D95';

/**
 * Whole rupees, en-IN grouping (spec §6.2.4 / §12 money formatting).
 * "Rs." not "₹": react-pdf's builtin Helvetica has no U+20B9 glyph — the
 * rupee sign silently renders as a superscript "1" (verified 2026-07-20;
 * the letterhead purchase-order-pdf.tsx has the same latent bug). Switch to
 * "₹" only once a Unicode font is registered repo-wide.
 */
function fmtINR(n: number): string {
  return 'Rs. ' + Math.round(n).toLocaleString('en-IN');
}

export interface BoiPoPdfItem {
  slNo: number;
  /** `Item — Make` (make omitted when blank). */
  description: string;
  /** `qty unit`, e.g. "12 Nos". */
  qtyWithUnit: string;
  unitPrice: number;
  /** GST-EXCLUSIVE line total (qty × rate) — GST appears only in the totals box. */
  total: number;
}

export interface BoiPoPdfData {
  poNumber: string;
  projectName: string | null;
  vendorName: string | null;
  /** 'YYYY-MM-DD' (date-only TEXT convention) or null. */
  deliveryDate: string | null;
  paymentTerms: string | null;
  transport: string | null;
  deliveryPlace: string | null;
  items: BoiPoPdfItem[];
  subtotal: number;
  /** "GST (18%)" when every line shares one rate, else "GST" (spec §6.2.2). */
  gstLabel: string;
  gstAmount: number;
  netAmount: number;
}

const s = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 9,
    color: BRAND.black,
    paddingTop: 44,
    paddingBottom: 50,
    paddingLeft: 44,
    paddingRight: 44,
  },
  topBar: {
    height: 4,
    backgroundColor: PURPLE,
    marginBottom: 18,
  },
  title: {
    fontSize: 20,
    fontFamily: 'Helvetica-Bold',
    color: PURPLE_DARK,
    textAlign: 'center' as const,
    letterSpacing: 2,
    textTransform: 'uppercase' as const,
  },
  subtitle: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    color: BRAND.gray700,
    textAlign: 'center' as const,
    marginTop: 4,
    marginBottom: 18,
  },
  // Info grid: 3 rows × 2 cells
  infoGrid: {
    borderWidth: 1,
    borderColor: BRAND.gray300,
    borderRadius: 4,
    marginBottom: 16,
  },
  infoRow: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: BRAND.gray300,
  },
  infoRowLast: {
    flexDirection: 'row',
  },
  infoCell: {
    flex: 1,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  infoLabel: {
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    color: BRAND.gray500,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  infoValue: {
    fontSize: 9,
    color: BRAND.black,
  },
  sectionHeading: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: PURPLE_DARK,
    letterSpacing: 0.8,
    textTransform: 'uppercase' as const,
    marginBottom: 6,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: PURPLE,
    paddingVertical: 5,
    paddingHorizontal: 6,
  },
  tableHeaderText: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: BRAND.white,
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 5,
    paddingHorizontal: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: BRAND.gray300,
  },
  tableRowAlt: {
    flexDirection: 'row',
    paddingVertical: 5,
    paddingHorizontal: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: BRAND.gray300,
    backgroundColor: BRAND.gray50,
  },
  tableCell: {
    fontSize: 8.5,
    color: BRAND.black,
  },
  // Totals box (right-aligned)
  totalsWrap: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 12,
  },
  totalsBox: {
    width: '42%',
    borderWidth: 1,
    borderColor: BRAND.gray300,
    borderRadius: 4,
    overflow: 'hidden',
  },
  totalsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: BRAND.gray300,
  },
  totalsLabel: {
    fontSize: 8.5,
    color: BRAND.gray700,
  },
  totalsValue: {
    fontSize: 8.5,
    color: BRAND.black,
    textAlign: 'right' as const,
  },
  netRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 7,
    paddingHorizontal: 10,
    backgroundColor: PURPLE,
  },
  netLabel: {
    fontSize: 9.5,
    fontFamily: 'Helvetica-Bold',
    color: BRAND.white,
  },
  netValue: {
    fontSize: 9.5,
    fontFamily: 'Helvetica-Bold',
    color: BRAND.white,
    textAlign: 'right' as const,
  },
});

const COL = {
  slNo: { width: '8%' },
  description: { width: '47%' },
  qty: { width: '15%', textAlign: 'right' as const },
  unitPrice: { width: '15%', textAlign: 'right' as const },
  total: { width: '15%', textAlign: 'right' as const },
};

function InfoCell({ label, value }: { label: string; value: string | null }) {
  return (
    <View style={s.infoCell}>
      <Text style={s.infoLabel}>{label}</Text>
      <Text style={s.infoValue}>{value && value.trim() ? value : '-'}</Text>
    </View>
  );
}

export function BoiPoPdf({ data }: { data: BoiPoPdfData }) {
  return (
    <Document>
      <Page size="A4" style={s.page}>
        <View style={s.topBar} />
        <Text style={s.title}>Purchase Order</Text>
        <Text style={s.subtitle}>{data.poNumber}</Text>

        {/* Info grid: Project | Payment Terms // Vendor | Transport //
            Delivery Date | Delivery Place ("-" when blank) */}
        <View style={s.infoGrid}>
          <View style={s.infoRow}>
            <InfoCell label="Project Name" value={data.projectName} />
            <InfoCell label="Payment Terms" value={data.paymentTerms} />
          </View>
          <View style={s.infoRow}>
            <InfoCell label="Vendor" value={data.vendorName} />
            <InfoCell label="Transport" value={data.transport} />
          </View>
          <View style={s.infoRowLast}>
            <InfoCell label="Delivery Date" value={data.deliveryDate} />
            <InfoCell label="Delivery Place" value={data.deliveryPlace} />
          </View>
        </View>

        {/* Items */}
        <Text style={s.sectionHeading}>Material Specification &amp; Cost Breakdown</Text>
        <View style={s.tableHeader}>
          <Text style={[s.tableHeaderText, COL.slNo]}>S.No</Text>
          <Text style={[s.tableHeaderText, COL.description]}>Description</Text>
          <Text style={[s.tableHeaderText, COL.qty]}>Qty</Text>
          <Text style={[s.tableHeaderText, COL.unitPrice]}>Unit Price</Text>
          <Text style={[s.tableHeaderText, COL.total]}>Total</Text>
        </View>
        {data.items.map((item, idx) => (
          <View key={item.slNo} style={idx % 2 === 0 ? s.tableRow : s.tableRowAlt} wrap={false}>
            <Text style={[s.tableCell, COL.slNo]}>{item.slNo}</Text>
            <Text style={[s.tableCell, COL.description]}>{item.description}</Text>
            <Text style={[s.tableCell, COL.qty]}>{item.qtyWithUnit}</Text>
            <Text style={[s.tableCell, COL.unitPrice]}>{fmtINR(item.unitPrice)}</Text>
            <Text style={[s.tableCell, COL.total]}>{fmtINR(item.total)}</Text>
          </View>
        ))}

        {/* Totals: Subtotal / GST(x%) / Net Amount (bold) */}
        <View style={s.totalsWrap}>
          <View style={s.totalsBox}>
            <View style={s.totalsRow}>
              <Text style={s.totalsLabel}>Subtotal</Text>
              <Text style={s.totalsValue}>{fmtINR(data.subtotal)}</Text>
            </View>
            <View style={s.totalsRow}>
              <Text style={s.totalsLabel}>{data.gstLabel}</Text>
              <Text style={s.totalsValue}>{fmtINR(data.gstAmount)}</Text>
            </View>
            <View style={s.netRow}>
              <Text style={s.netLabel}>Net Amount</Text>
              <Text style={s.netValue}>{fmtINR(data.netAmount)}</Text>
            </View>
          </View>
        </View>
      </Page>
    </Document>
  );
}
