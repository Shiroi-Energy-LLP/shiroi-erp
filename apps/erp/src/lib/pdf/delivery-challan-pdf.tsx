// apps/erp/src/lib/pdf/delivery-challan-pdf.tsx
// Delivery Challan PDF — Shiroi Energy LLP format per Manivel's spec
import React from 'react';
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import { BRAND } from './pdf-styles';

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
  dcTitle: {
    fontSize: 18,
    fontFamily: 'Helvetica-Bold',
    color: BRAND.black,
    textAlign: 'center' as any,
    marginTop: 8,
    marginBottom: 10,
    textTransform: 'uppercase' as any,
    letterSpacing: 1,
  },

  // ── Info grid (2 columns) ──
  infoGrid: {
    flexDirection: 'row',
    gap: 16,
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
  divider: {
    borderBottomWidth: 0.5,
    borderBottomColor: BRAND.gray300,
    marginVertical: 4,
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

  // ── T&C section ──
  tcBox: {
    borderWidth: 1,
    borderColor: BRAND.gray300,
    borderRadius: 4,
    padding: 10,
    marginTop: 12,
    marginBottom: 12,
  },
  tcText: {
    fontSize: 7.5,
    color: BRAND.gray700,
    lineHeight: 1.5,
    fontStyle: 'italic',
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
  challanNumber: string; // DC-001, DC-002, etc.
  challanDate: string;
  placeOfSupply: string;
  deliverTo: string;
  projectName: string;
  customerName: string;
  items: {
    slNo: number;
    description: string;
    hsnCode: string | null;
    quantity: number;
    unit: string;
  }[];
  dispatchedByName: string | null;
  generatedAt: string;
}

export function DeliveryChallanPDF({ data }: { data: DeliveryChallanPdfData }) {
  const totalQty = data.items.reduce((sum, i) => sum + i.quantity, 0);

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

        {/* DC Title */}
        <View style={s.divider} />
        <Text style={s.dcTitle}>DELIVERY CHALLAN</Text>
        <View style={s.divider} />

        {/* DC Info Grid */}
        <View style={s.infoGrid}>
          {/* Left column */}
          <View style={s.infoColumn}>
            <Text style={s.infoLabel}>Challan Number</Text>
            <Text style={s.infoValueBold}>{data.challanNumber}</Text>

            <Text style={s.infoLabel}>Challan Date</Text>
            <Text style={s.infoValue}>{data.challanDate}</Text>

            <Text style={s.infoLabel}>Place of Supply</Text>
            <Text style={s.infoValue}>{data.placeOfSupply || '\u2014'}</Text>
          </View>

          {/* Right column */}
          <View style={s.infoColumn}>
            <Text style={s.infoLabel}>Deliver To</Text>
            <Text style={s.infoValue}>{data.deliverTo || '\u2014'}</Text>

            <Text style={s.infoLabel}>Project Name</Text>
            <Text style={s.infoValueBold}>{data.projectName}</Text>

            <Text style={s.infoLabel}>Client Name</Text>
            <Text style={s.infoValue}>{data.customerName}</Text>
          </View>
        </View>

        {/* Items Table */}
        <View>
          <Text style={[s.sectionHeading, { marginBottom: 4 }]}>Item Details</Text>

          <View style={s.tableHeader}>
            <Text style={[s.tableHeaderText, { width: '8%' }]}>S.No</Text>
            <Text style={[s.tableHeaderText, { width: '50%' }]}>Item Description</Text>
            <Text style={[s.tableHeaderText, { width: '22%' }]}>HSN Code</Text>
            <Text style={[s.tableHeaderText, { width: '20%', textAlign: 'right' as any }]}>Quantity</Text>
          </View>

          {data.items.map((item, idx) => (
            <View key={idx} style={idx % 2 === 0 ? s.tableRow : s.tableRowAlt}>
              <Text style={[s.tableCellBold, { width: '8%' }]}>{item.slNo}</Text>
              <Text style={[s.tableCell, { width: '50%' }]}>{item.description}</Text>
              <Text style={[s.tableCell, { width: '22%' }]}>{item.hsnCode || '\u2014'}</Text>
              <Text style={[s.tableCellBold, { width: '20%', textAlign: 'right' as any }]}>
                {item.quantity} {item.unit}
              </Text>
            </View>
          ))}

          {/* Total row */}
          <View style={[s.tableRow, { backgroundColor: BRAND.gray100, borderTopWidth: 1, borderTopColor: BRAND.gray300 }]}>
            <Text style={[s.tableCellBold, { width: '80%' }]}>
              Total Items: {data.items.length}
            </Text>
            <Text style={[s.tableCellBold, { width: '20%', textAlign: 'right' as any }]}>
              {totalQty} Nos
            </Text>
          </View>
        </View>

        {/* Terms & Conditions */}
        <View style={s.tcBox}>
          <Text style={s.sectionHeading}>Terms & Conditions</Text>
          <Text style={s.tcText}>
            Received the above goods in good condition. The consignee takes responsibility for the
            safety and security of the materials at the site until installation is carried out by
            Shiroi Energy LLP.
          </Text>
        </View>

        {/* Signature Section */}
        <View style={s.signatureRow}>
          <View style={s.signatureBlock}>
            <View style={s.signatureLine} />
            <Text style={s.signatureLabel}>Authorized Signature</Text>
            {data.dispatchedByName && (
              <Text style={s.signatureName}>{data.dispatchedByName}</Text>
            )}
            <Text style={s.signatureName}>Shiroi Energy LLP</Text>
          </View>
          <View style={s.signatureBlock}>
            <View style={s.signatureLine} />
            <Text style={s.signatureLabel}>Client / Receiver Acknowledgment</Text>
            <Text style={s.signatureName}>{data.customerName}</Text>
          </View>
        </View>

        {/* Footer */}
        <View style={s.footer} fixed>
          <Text style={s.footerBrand}>Shiroi Energy LLP</Text>
          <Text style={s.footerText}>{data.challanNumber} | {data.challanDate}</Text>
          <Text style={s.footerText} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
