// apps/erp/src/lib/pdf/purchase-order-pdf.tsx
// Purchase Order PDF — Shiroi Energy LLP format per Manivel's spec
import React from 'react';
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import { BRAND } from './pdf-styles';

function fmtINR(n: number): string {
  return '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const s = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 9,
    color: BRAND.black,
    paddingTop: 30,
    paddingBottom: 90,
    paddingLeft: 40,
    paddingRight: 40,
  },

  // ── Header ──
  headerBar: {
    height: 3,
    backgroundColor: BRAND.green,
    marginBottom: 12,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  companyName: {
    fontSize: 16,
    fontFamily: 'Helvetica-Bold',
    color: BRAND.green,
  },
  companyAddress: {
    fontSize: 7.5,
    color: BRAND.gray500,
    marginTop: 1,
    lineHeight: 1.4,
  },
  gstLine: {
    fontSize: 7.5,
    fontFamily: 'Helvetica-Bold',
    color: BRAND.gray700,
    marginTop: 2,
  },
  contactLine: {
    fontSize: 7.5,
    color: BRAND.gray500,
    marginTop: 1,
  },
  poTitle: {
    fontSize: 18,
    fontFamily: 'Helvetica-Bold',
    color: BRAND.black,
    textAlign: 'center' as const,
    marginTop: 8,
    marginBottom: 10,
    textTransform: 'uppercase' as const,
    letterSpacing: 1,
  },
  divider: {
    borderBottomWidth: 0.5,
    borderBottomColor: BRAND.gray300,
    marginVertical: 4,
  },
  sectionHeading: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: BRAND.green,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    marginBottom: 6,
  },

  // ── PO info row (horizontal strip) ──
  infoStrip: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: BRAND.gray300,
    borderRadius: 4,
    padding: 8,
    marginBottom: 10,
    gap: 8,
  },
  infoStripCell: {
    flex: 1,
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
    fontSize: 8.5,
    color: BRAND.black,
  },
  infoValueBold: {
    fontSize: 8.5,
    fontFamily: 'Helvetica-Bold',
    color: BRAND.black,
  },

  // ── Two-column party block ──
  partyRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  partyBox: {
    flex: 1,
    borderWidth: 1,
    borderColor: BRAND.gray300,
    borderRadius: 4,
    padding: 10,
  },
  partyTitle: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: BRAND.white,
    backgroundColor: BRAND.green,
    paddingVertical: 3,
    paddingHorizontal: 6,
    marginBottom: 6,
    borderRadius: 2,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  partyName: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: BRAND.black,
    marginBottom: 2,
  },
  partyLine: {
    fontSize: 8,
    color: BRAND.gray700,
    lineHeight: 1.4,
    marginBottom: 1,
  },
  partyGstin: {
    fontSize: 7.5,
    fontFamily: 'Helvetica-Bold',
    color: BRAND.gray700,
    marginTop: 3,
  },

  // ── Items table ──
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: BRAND.green,
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
    fontSize: 8,
    color: BRAND.black,
  },
  tableCellBold: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: BRAND.black,
  },

  // ── Bottom section: notes (left) + totals (right) ──
  bottomRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
  },
  notesBox: {
    flex: 1,
    borderWidth: 1,
    borderColor: BRAND.gray300,
    borderRadius: 4,
    padding: 10,
  },
  notesText: {
    fontSize: 8,
    color: BRAND.gray700,
    lineHeight: 1.5,
    marginBottom: 8,
  },
  tcText: {
    fontSize: 7.5,
    color: BRAND.gray700,
    lineHeight: 1.5,
    fontStyle: 'italic',
  },
  totalsBox: {
    width: '38%',
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
    fontSize: 8,
    color: BRAND.gray700,
  },
  totalsValue: {
    fontSize: 8,
    color: BRAND.black,
    textAlign: 'right' as const,
  },
  grandTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 7,
    paddingHorizontal: 10,
    backgroundColor: BRAND.green,
  },
  grandTotalLabel: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: BRAND.white,
  },
  grandTotalValue: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: BRAND.white,
    textAlign: 'right' as const,
  },

  // ── Signatures ──
  signatureRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 24,
    paddingHorizontal: 0,
  },
  signatureBlock: {
    width: '40%',
    alignItems: 'center' as const,
  },
  signatureLine: {
    borderBottomWidth: 1,
    borderBottomColor: BRAND.black,
    width: '100%',
    marginBottom: 4,
    height: 36,
  },
  signatureLabel: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: BRAND.gray500,
    textAlign: 'center' as const,
  },
  signatureName: {
    fontSize: 7,
    color: BRAND.gray500,
    textAlign: 'center' as const,
    marginTop: 2,
  },

  // ── Footer ──
  footer: {
    position: 'absolute',
    bottom: 20,
    left: 40,
    right: 40,
    borderTopWidth: 0.5,
    borderTopColor: BRAND.gray300,
    paddingTop: 6,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  footerText: {
    fontSize: 7,
    color: BRAND.gray500,
  },
  footerBrand: {
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    color: BRAND.green,
  },
});

export interface PurchaseOrderPdfData {
  poNumber: string;
  poDate: string;
  paymentTerms: string;
  projectName: string;
  placeOfSupply: string;
  // Vendor
  vendorName: string;
  vendorAddress: string;
  vendorGstin: string;
  vendorContact: string;
  // Ship To
  shipToAddress: string;
  shipToContact: string;
  shipToPhone: string;
  // Items
  items: {
    slNo: number;
    description: string;
    hsnCode: string;
    quantity: number;
    unit: string;
    rate: number;
    amount: number;
  }[];
  // Totals
  subtotal: number;
  gstBreakdown: { label: string; amount: number }[];
  roundOff: number;
  grandTotal: number;
  // Notes
  notes: string;
  generatedAt: string;
}

export function PurchaseOrderPDF({ data }: { data: PurchaseOrderPdfData }) {
  const totalGst = data.gstBreakdown.reduce((sum, g) => sum + g.amount, 0);

  return (
    <Document>
      <Page size="A4" style={s.page}>
        {/* Green top bar */}
        <View style={s.headerBar} />

        {/* Company Header */}
        <View style={s.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.companyName}>Shiroi Energy LLP</Text>
            <Text style={s.companyAddress}>
              No. 75/34, Third Main Road{'\n'}
              Kasturbai Nagar, Adyar{'\n'}
              Chennai, Tamil Nadu – 600020, India
            </Text>
            <Text style={s.gstLine}>GSTIN: 33ACPFS4398J1ZE</Text>
            <Text style={s.contactLine}>Contact: 9486801859</Text>
          </View>
        </View>

        {/* PO Title */}
        <View style={s.divider} />
        <Text style={s.poTitle}>Purchase Order</Text>
        <View style={s.divider} />

        {/* PO Info Strip */}
        <View style={s.infoStrip}>
          <View style={s.infoStripCell}>
            <Text style={s.infoLabel}>PO Number</Text>
            <Text style={s.infoValueBold}>{data.poNumber || '\u2014'}</Text>
          </View>
          <View style={s.infoStripCell}>
            <Text style={s.infoLabel}>PO Date</Text>
            <Text style={s.infoValue}>{data.poDate || '\u2014'}</Text>
          </View>
          <View style={s.infoStripCell}>
            <Text style={s.infoLabel}>Payment Terms</Text>
            <Text style={s.infoValue}>{data.paymentTerms || '\u2014'}</Text>
          </View>
          <View style={s.infoStripCell}>
            <Text style={s.infoLabel}>Project</Text>
            <Text style={s.infoValue}>{data.projectName || '\u2014'}</Text>
          </View>
          <View style={s.infoStripCell}>
            <Text style={s.infoLabel}>Place of Supply</Text>
            <Text style={s.infoValue}>{data.placeOfSupply || '\u2014'}</Text>
          </View>
        </View>

        {/* Two-column: Vendor Details | Ship To */}
        <View style={s.partyRow}>
          {/* Vendor Details */}
          <View style={s.partyBox}>
            <Text style={s.partyTitle}>Vendor Details</Text>
            <Text style={s.partyName}>{data.vendorName || '\u2014'}</Text>
            <Text style={s.partyLine}>{data.vendorAddress || '\u2014'}</Text>
            {data.vendorGstin && data.vendorGstin !== '\u2014' && (
              <Text style={s.partyGstin}>GSTIN: {data.vendorGstin}</Text>
            )}
            {data.vendorContact && data.vendorContact !== '\u2014' && (
              <Text style={[s.partyLine, { marginTop: 3 }]}>Contact: {data.vendorContact}</Text>
            )}
          </View>

          {/* Ship To */}
          <View style={s.partyBox}>
            <Text style={s.partyTitle}>Ship To</Text>
            {data.shipToContact && (
              <Text style={s.partyName}>{data.shipToContact}</Text>
            )}
            <Text style={s.partyLine}>{data.shipToAddress || '\u2014'}</Text>
            {data.shipToPhone && (
              <Text style={[s.partyLine, { marginTop: 3 }]}>Phone: {data.shipToPhone}</Text>
            )}
          </View>
        </View>

        {/* Items Table */}
        <View>
          <Text style={[s.sectionHeading, { marginBottom: 4 }]}>Item Details</Text>

          <View style={s.tableHeader}>
            <Text style={[s.tableHeaderText, { width: '5%' }]}>#</Text>
            <Text style={[s.tableHeaderText, { width: '38%' }]}>Item Description</Text>
            <Text style={[s.tableHeaderText, { width: '14%' }]}>HSN</Text>
            <Text style={[s.tableHeaderText, { width: '10%', textAlign: 'right' as const }]}>Qty</Text>
            <Text style={[s.tableHeaderText, { width: '8%' }]}>Unit</Text>
            <Text style={[s.tableHeaderText, { width: '12%', textAlign: 'right' as const }]}>Rate</Text>
            <Text style={[s.tableHeaderText, { width: '13%', textAlign: 'right' as const }]}>Amount</Text>
          </View>

          {data.items.length === 0 ? (
            <View style={s.tableRow}>
              <Text style={[s.tableCell, { width: '100%', textAlign: 'center' as const }]}>No items</Text>
            </View>
          ) : (
            data.items.map((item, idx) => (
              <View key={idx} style={idx % 2 === 0 ? s.tableRow : s.tableRowAlt}>
                <Text style={[s.tableCellBold, { width: '5%' }]}>{item.slNo}</Text>
                <Text style={[s.tableCell, { width: '38%' }]}>{item.description}</Text>
                <Text style={[s.tableCell, { width: '14%' }]}>{item.hsnCode || '\u2014'}</Text>
                <Text style={[s.tableCellBold, { width: '10%', textAlign: 'right' as const }]}>{item.quantity}</Text>
                <Text style={[s.tableCell, { width: '8%' }]}>{item.unit}</Text>
                <Text style={[s.tableCell, { width: '12%', textAlign: 'right' as const }]}>{fmtINR(item.rate)}</Text>
                <Text style={[s.tableCellBold, { width: '13%', textAlign: 'right' as const }]}>{fmtINR(item.amount)}</Text>
              </View>
            ))
          )}

          {/* Items count row */}
          <View style={[s.tableRow, { backgroundColor: BRAND.gray100, borderTopWidth: 1, borderTopColor: BRAND.gray300 }]}>
            <Text style={[s.tableCellBold, { width: '100%' }]}>
              Total Items: {data.items.length}
            </Text>
          </View>
        </View>

        {/* Bottom section: Notes (left) + Totals (right) */}
        <View style={s.bottomRow}>
          {/* Notes + T&C */}
          <View style={s.notesBox}>
            {data.notes ? (
              <>
                <Text style={[s.sectionHeading, { marginBottom: 4 }]}>Notes</Text>
                <Text style={s.notesText}>{data.notes}</Text>
              </>
            ) : null}
            <Text style={[s.sectionHeading, { marginBottom: 4 }]}>Terms & Conditions</Text>
            <Text style={s.tcText}>
              1. Goods will be inspected upon delivery. Any damaged or incorrect items must be
              reported within 48 hours of receipt.{'\n'}
              2. Payment will be processed as per agreed payment terms from the date of delivery and
              acceptance of invoice.{'\n'}
              3. Supplier must provide a valid GST invoice along with delivery.
            </Text>
          </View>

          {/* Totals */}
          <View style={s.totalsBox}>
            <View style={s.totalsRow}>
              <Text style={s.totalsLabel}>Subtotal (excl. GST)</Text>
              <Text style={s.totalsValue}>{fmtINR(data.subtotal)}</Text>
            </View>
            {data.gstBreakdown.map((g, idx) => (
              <View key={idx} style={s.totalsRow}>
                <Text style={s.totalsLabel}>{g.label}</Text>
                <Text style={s.totalsValue}>{fmtINR(g.amount)}</Text>
              </View>
            ))}
            {data.gstBreakdown.length === 0 && (
              <View style={s.totalsRow}>
                <Text style={s.totalsLabel}>GST</Text>
                <Text style={s.totalsValue}>{fmtINR(0)}</Text>
              </View>
            )}
            <View style={s.totalsRow}>
              <Text style={s.totalsLabel}>Total GST</Text>
              <Text style={[s.totalsValue, { fontFamily: 'Helvetica-Bold' }]}>{fmtINR(totalGst)}</Text>
            </View>
            {data.roundOff !== 0 && (
              <View style={s.totalsRow}>
                <Text style={s.totalsLabel}>Round Off</Text>
                <Text style={s.totalsValue}>{data.roundOff >= 0 ? '+' : ''}{fmtINR(data.roundOff)}</Text>
              </View>
            )}
            <View style={s.grandTotalRow}>
              <Text style={s.grandTotalLabel}>GRAND TOTAL</Text>
              <Text style={s.grandTotalValue}>{fmtINR(data.grandTotal)}</Text>
            </View>
          </View>
        </View>

        {/* Authorized Signature */}
        <View style={s.signatureRow}>
          <View style={s.signatureBlock}>
            <View style={s.signatureLine} />
            <Text style={s.signatureLabel}>Authorized Signature</Text>
            <Text style={s.signatureName}>Shiroi Energy LLP</Text>
          </View>
        </View>

        {/* Footer */}
        <View style={s.footer} fixed>
          <Text style={s.footerBrand}>Shiroi Energy LLP</Text>
          <Text style={s.footerText}>{data.poNumber} | {data.poDate} | Generated: {data.generatedAt}</Text>
          <Text style={s.footerText} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
