// apps/erp/src/lib/pdf/delivery-challan-pdf.tsx
// Standalone Delivery Challan PDF — Shiroi Energy LLP format
import React from 'react';
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import { BRAND } from './pdf-styles';

const s = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 9,
    color: BRAND.black,
    paddingTop: 30,
    paddingBottom: 80,
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
    marginBottom: 8,
  },
  companyName: {
    fontSize: 16,
    fontFamily: 'Helvetica-Bold',
    color: BRAND.green,
  },
  companyTagline: {
    fontSize: 8,
    color: BRAND.gray500,
    marginTop: 2,
  },
  companyAddress: {
    fontSize: 7,
    color: BRAND.gray500,
    marginTop: 1,
  },
  dcTitle: {
    fontSize: 18,
    fontFamily: 'Helvetica-Bold',
    color: BRAND.black,
    textAlign: 'center' as any,
    marginTop: 10,
    marginBottom: 10,
  },
  dcSequential: {
    fontSize: 12,
    fontFamily: 'Helvetica-Bold',
    color: BRAND.green,
    textAlign: 'center' as any,
    marginBottom: 4,
  },

  // ── Info grid (2 columns) ──
  infoGrid: {
    flexDirection: 'row',
    gap: 20,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: BRAND.gray300,
    borderRadius: 4,
    padding: 10,
  },
  infoColumn: {
    flex: 1,
  },
  infoLabel: {
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    color: BRAND.gray500,
    textTransform: 'uppercase' as any,
    letterSpacing: 0.5,
    marginBottom: 2,
    marginTop: 6,
  },
  infoValue: {
    fontSize: 9,
    color: BRAND.black,
  },
  infoValueBold: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: BRAND.black,
  },
  sectionHeading: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: BRAND.green,
    textTransform: 'uppercase' as any,
    letterSpacing: 0.5,
    marginBottom: 6,
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

  // ── Transport section ──
  transportBox: {
    borderWidth: 1,
    borderColor: BRAND.gray300,
    borderRadius: 4,
    padding: 10,
    marginTop: 12,
    marginBottom: 12,
  },
  transportRow: {
    flexDirection: 'row',
    gap: 20,
    marginBottom: 4,
  },
  transportItem: {
    flex: 1,
    flexDirection: 'row',
    gap: 4,
  },

  // ── Notes ──
  notesBox: {
    borderWidth: 1,
    borderColor: BRAND.gray300,
    borderRadius: 4,
    padding: 10,
    marginBottom: 12,
    minHeight: 30,
  },

  // ── Signatures ──
  signatureRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 30,
    paddingHorizontal: 20,
  },
  signatureBlock: {
    width: '40%',
    alignItems: 'center' as any,
  },
  signatureLine: {
    borderBottomWidth: 1,
    borderBottomColor: BRAND.black,
    width: '100%',
    marginBottom: 4,
    height: 40,
  },
  signatureLabel: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: BRAND.gray500,
    textAlign: 'center' as any,
  },
  signatureName: {
    fontSize: 7,
    color: BRAND.gray500,
    textAlign: 'center' as any,
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

export interface DeliveryChallanPdfData {
  dcSequential: string; // DC1, DC2, etc.
  dcNumber: string; // SHIROI/DC/2025-26/0001
  dcDate: string;
  status: string;
  projectNumber: string;
  customerName: string;
  siteAddress: string;
  dispatchFrom: string | null;
  dispatchTo: string | null;
  vehicleNumber: string | null;
  driverName: string | null;
  driverPhone: string | null;
  notes: string | null;
  dispatchedByName: string | null;
  items: {
    slNo: number;
    description: string;
    category: string;
    quantity: number;
    unit: string;
  }[];
  generatedAt: string;
}

export function DeliveryChallanPDF({ data }: { data: DeliveryChallanPdfData }) {
  return (
    <Document>
      <Page size="A4" style={s.page}>
        {/* Green top bar */}
        <View style={s.headerBar} />

        {/* Company Header */}
        <View style={s.headerRow}>
          <View>
            <Text style={s.companyName}>SHIROI ENERGY LLP</Text>
            <Text style={s.companyTagline}>Solar EPC Solutions</Text>
            <Text style={s.companyAddress}>Chennai, Tamil Nadu, India</Text>
            <Text style={s.companyAddress}>GST: 33AAFFS4721L1ZQ</Text>
          </View>
          <View style={{ alignItems: 'flex-end' as any }}>
            <Text style={{ fontSize: 8, color: BRAND.gray500 }}>www.shiroienergy.com</Text>
            <Text style={{ fontSize: 8, color: BRAND.gray500 }}>info@shiroienergy.com</Text>
            <Text style={{ fontSize: 8, color: BRAND.gray500 }}>+91 72001 57787</Text>
          </View>
        </View>

        {/* DC Title */}
        <Text style={s.dcTitle}>DELIVERY CHALLAN</Text>
        <Text style={s.dcSequential}>{data.dcSequential}</Text>

        {/* DC Info Grid: From / To */}
        <View style={s.infoGrid}>
          {/* Left: DC Details */}
          <View style={s.infoColumn}>
            <Text style={s.sectionHeading}>Dispatch Details</Text>

            <Text style={s.infoLabel}>DC Number</Text>
            <Text style={s.infoValueBold}>{data.dcNumber}</Text>

            <Text style={s.infoLabel}>DC Date</Text>
            <Text style={s.infoValue}>{data.dcDate}</Text>

            <Text style={s.infoLabel}>Project</Text>
            <Text style={s.infoValue}>{data.projectNumber}</Text>

            <Text style={s.infoLabel}>Dispatch From</Text>
            <Text style={s.infoValue}>{data.dispatchFrom || 'Shiroi Energy Warehouse'}</Text>
          </View>

          {/* Right: Ship-To */}
          <View style={s.infoColumn}>
            <Text style={s.sectionHeading}>Ship To</Text>

            <Text style={s.infoLabel}>Customer</Text>
            <Text style={s.infoValueBold}>{data.customerName}</Text>

            <Text style={s.infoLabel}>Site Address</Text>
            <Text style={s.infoValue}>{data.dispatchTo || data.siteAddress || '\u2014'}</Text>

            <Text style={s.infoLabel}>Status</Text>
            <Text style={s.infoValue}>{(data.status || 'draft').replace(/_/g, ' ').toUpperCase()}</Text>
          </View>
        </View>

        {/* Items Table */}
        <View>
          <Text style={[s.sectionHeading, { marginBottom: 4 }]}>Items ({data.items.length})</Text>

          <View style={s.tableHeader}>
            <Text style={[s.tableHeaderText, { width: '8%' }]}>S.No</Text>
            <Text style={[s.tableHeaderText, { width: '22%' }]}>Category</Text>
            <Text style={[s.tableHeaderText, { width: '42%' }]}>Description</Text>
            <Text style={[s.tableHeaderText, { width: '14%', textAlign: 'right' as any }]}>Qty</Text>
            <Text style={[s.tableHeaderText, { width: '14%', textAlign: 'right' as any }]}>Unit</Text>
          </View>

          {data.items.map((item, idx) => (
            <View key={idx} style={idx % 2 === 0 ? s.tableRow : s.tableRowAlt}>
              <Text style={[s.tableCellBold, { width: '8%' }]}>{item.slNo}</Text>
              <Text style={[s.tableCell, { width: '22%' }]}>{item.category.replace(/_/g, ' ')}</Text>
              <Text style={[s.tableCell, { width: '42%' }]}>{item.description}</Text>
              <Text style={[s.tableCellBold, { width: '14%', textAlign: 'right' as any }]}>{item.quantity}</Text>
              <Text style={[s.tableCell, { width: '14%', textAlign: 'right' as any }]}>{item.unit}</Text>
            </View>
          ))}

          {/* Total row */}
          <View style={[s.tableRow, { backgroundColor: BRAND.gray100, borderTopWidth: 1, borderTopColor: BRAND.gray300 }]}>
            <Text style={[s.tableCellBold, { width: '72%' }]}>Total Items: {data.items.length}</Text>
            <Text style={[s.tableCellBold, { width: '14%', textAlign: 'right' as any }]}>
              {data.items.reduce((sum, i) => sum + i.quantity, 0)}
            </Text>
            <Text style={[s.tableCell, { width: '14%' }]} />
          </View>
        </View>

        {/* Transport Details */}
        {(data.vehicleNumber || data.driverName) && (
          <View style={s.transportBox}>
            <Text style={s.sectionHeading}>Transport Details</Text>
            <View style={s.transportRow}>
              <View style={s.transportItem}>
                <Text style={s.infoLabel}>Vehicle</Text>
                <Text style={s.infoValue}>{data.vehicleNumber || '\u2014'}</Text>
              </View>
              <View style={s.transportItem}>
                <Text style={s.infoLabel}>Driver</Text>
                <Text style={s.infoValue}>{data.driverName || '\u2014'}</Text>
              </View>
              <View style={s.transportItem}>
                <Text style={s.infoLabel}>Phone</Text>
                <Text style={s.infoValue}>{data.driverPhone || '\u2014'}</Text>
              </View>
            </View>
          </View>
        )}

        {/* Notes */}
        {data.notes && (
          <View style={s.notesBox}>
            <Text style={s.sectionHeading}>Notes / Special Instructions</Text>
            <Text style={s.infoValue}>{data.notes}</Text>
          </View>
        )}

        {/* Signature Section */}
        <View style={s.signatureRow}>
          <View style={s.signatureBlock}>
            <View style={s.signatureLine} />
            <Text style={s.signatureLabel}>Engineer Signature</Text>
            {data.dispatchedByName && (
              <Text style={s.signatureName}>{data.dispatchedByName}</Text>
            )}
          </View>
          <View style={s.signatureBlock}>
            <View style={s.signatureLine} />
            <Text style={s.signatureLabel}>Client Signature</Text>
            <Text style={s.signatureName}>{data.customerName}</Text>
          </View>
        </View>

        {/* Footer */}
        <View style={s.footer} fixed>
          <Text style={s.footerBrand}>Shiroi Energy LLP</Text>
          <Text style={s.footerText}>{data.dcNumber} | {data.dcDate}</Text>
          <Text style={s.footerText} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
