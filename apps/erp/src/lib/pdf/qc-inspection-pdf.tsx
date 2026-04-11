// apps/erp/src/lib/pdf/qc-inspection-pdf.tsx
// QC Inspection Report PDF — Shiroi Energy LLP format per Manivel's spec
import React from 'react';
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import { BRAND } from './pdf-styles';

export interface QcPdfSection {
  id: string;
  name: string;
  items: Array<{ item: string; passed: boolean | null; remarks: string }>;
}

export interface QcInspectionPdfData {
  projectNumber: string;
  customerName: string;
  systemSize: string;
  systemType: string;
  inspectionDate: string;
  inspectorName: string;
  approverName: string | null;
  approvedDate: string | null;
  sections: QcPdfSection[];
  remarks: string;
  overallResult: string; // 'approved' | 'rework_required'
}

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
  // Header
  headerBar: { height: 3, backgroundColor: BRAND.green, marginBottom: 12 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  companyName: { fontSize: 16, fontFamily: 'Helvetica-Bold', color: BRAND.green },
  companyAddress: { fontSize: 7.5, color: BRAND.gray500, marginTop: 1, lineHeight: 1.4 },
  gstLine: { fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: BRAND.gray700, marginTop: 2 },
  contactLine: { fontSize: 7.5, color: BRAND.gray500, marginTop: 1 },
  title: {
    fontSize: 14,
    fontFamily: 'Helvetica-Bold',
    color: BRAND.black,
    textAlign: 'center' as const,
    marginTop: 8,
    marginBottom: 10,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  // Info grid
  infoGrid: {
    flexDirection: 'row',
    borderWidth: 0.5,
    borderColor: BRAND.gray300,
    marginBottom: 12,
  },
  infoCell: {
    flex: 1,
    padding: 6,
    borderRightWidth: 0.5,
    borderRightColor: BRAND.gray300,
  },
  infoCellLast: { flex: 1, padding: 6 },
  infoLabel: { fontSize: 7, color: BRAND.gray500, marginBottom: 2 },
  infoValue: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: BRAND.black },
  // Section
  sectionHeader: {
    backgroundColor: BRAND.green,
    paddingVertical: 4,
    paddingHorizontal: 8,
    marginTop: 8,
    marginBottom: 0,
  },
  sectionHeaderText: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: BRAND.white },
  // Table
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: BRAND.gray100,
    borderBottomWidth: 0.5,
    borderBottomColor: BRAND.gray300,
    borderLeftWidth: 0.5,
    borderRightWidth: 0.5,
    borderLeftColor: BRAND.gray300,
    borderRightColor: BRAND.gray300,
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: BRAND.gray300,
    borderLeftWidth: 0.5,
    borderRightWidth: 0.5,
    borderLeftColor: BRAND.gray300,
    borderRightColor: BRAND.gray300,
    minHeight: 18,
  },
  tableRowAlt: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: BRAND.gray300,
    borderLeftWidth: 0.5,
    borderRightWidth: 0.5,
    borderLeftColor: BRAND.gray300,
    borderRightColor: BRAND.gray300,
    minHeight: 18,
    backgroundColor: BRAND.gray50,
  },
  thItem: { width: '50%', fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: BRAND.gray700, paddingVertical: 4, paddingHorizontal: 6 },
  thResult: { width: '15%', fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: BRAND.gray700, paddingVertical: 4, paddingHorizontal: 6, textAlign: 'center' as const },
  thRemarks: { width: '35%', fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: BRAND.gray700, paddingVertical: 4, paddingHorizontal: 6 },
  tdItem: { width: '50%', fontSize: 8.5, color: BRAND.black, paddingVertical: 4, paddingHorizontal: 6 },
  tdResult: { width: '15%', fontSize: 8.5, paddingVertical: 4, paddingHorizontal: 6, textAlign: 'center' as const },
  tdRemarks: { width: '35%', fontSize: 8, color: BRAND.gray700, paddingVertical: 4, paddingHorizontal: 6 },
  passText: { color: '#065F46', fontFamily: 'Helvetica-Bold' },
  failText: { color: '#991B1B', fontFamily: 'Helvetica-Bold' },
  // Remarks
  remarksBox: {
    marginTop: 12,
    borderWidth: 0.5,
    borderColor: BRAND.gray300,
    padding: 8,
    minHeight: 40,
  },
  remarksLabel: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: BRAND.gray700, marginBottom: 4 },
  remarksText: { fontSize: 8.5, color: BRAND.black, lineHeight: 1.4 },
  // Verdict
  verdictBox: {
    marginTop: 12,
    padding: 10,
    borderWidth: 1,
    borderRadius: 4,
  },
  verdictApproved: { borderColor: '#065F46', backgroundColor: '#ECFDF5' },
  verdictRework: { borderColor: '#991B1B', backgroundColor: '#FEF2F2' },
  verdictLabel: { fontSize: 8, color: BRAND.gray500, marginBottom: 2 },
  verdictText: { fontSize: 14, fontFamily: 'Helvetica-Bold' },
  verdictApprovedText: { color: '#065F46' },
  verdictReworkText: { color: '#991B1B' },
  // Signatures
  signatureRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 40 },
  signatureBlock: { width: '40%' },
  signatureLine: { borderBottomWidth: 1, borderBottomColor: BRAND.gray300, marginBottom: 4 },
  signatureLabel: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: BRAND.gray700 },
  signatureName: { fontSize: 7.5, color: BRAND.gray500, marginTop: 2 },
  // Footer
  footer: {
    position: 'absolute' as const,
    bottom: 20,
    left: 40,
    right: 40,
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 0.5,
    borderTopColor: BRAND.gray300,
    paddingTop: 6,
  },
  footerText: { fontSize: 7, color: BRAND.gray500 },
});

export function QcInspectionPDF({ data }: { data: QcInspectionPdfData }) {
  const isApproved = data.overallResult === 'approved';

  return (
    <Document>
      <Page size="A4" style={s.page}>
        {/* Header bar */}
        <View style={s.headerBar} />

        {/* Company header */}
        <View style={s.headerRow}>
          <View>
            <Text style={s.companyName}>SHIROI ENERGY LLP</Text>
            <Text style={s.companyAddress}>
              Solar EPC Solutions{'\n'}
              No. 75/34, Third Main Road, Kasturbai Nagar,{'\n'}
              Adyar, Chennai — 600020
            </Text>
            <Text style={s.gstLine}>GSTIN: 33ACPFS4398J1ZE</Text>
            <Text style={s.contactLine}>Contact: 9486801859</Text>
          </View>
        </View>

        {/* Title */}
        <Text style={s.title}>Solar System Quality Check Report</Text>

        {/* Project info grid */}
        <View style={s.infoGrid}>
          <View style={s.infoCell}>
            <Text style={s.infoLabel}>Project No.</Text>
            <Text style={s.infoValue}>{data.projectNumber}</Text>
          </View>
          <View style={s.infoCell}>
            <Text style={s.infoLabel}>Customer</Text>
            <Text style={s.infoValue}>{data.customerName}</Text>
          </View>
          <View style={s.infoCell}>
            <Text style={s.infoLabel}>System</Text>
            <Text style={s.infoValue}>
              {data.systemSize} kWp — {data.systemType}
            </Text>
          </View>
          <View style={s.infoCellLast}>
            <Text style={s.infoLabel}>Inspection Date</Text>
            <Text style={s.infoValue}>{data.inspectionDate}</Text>
          </View>
        </View>

        {/* Sections */}
        {data.sections.map((section, sIdx) => (
          <View key={section.id} wrap={false}>
            <View style={s.sectionHeader}>
              <Text style={s.sectionHeaderText}>
                {sIdx + 1}. {section.name}
              </Text>
            </View>
            {/* Table header */}
            <View style={s.tableHeader}>
              <Text style={s.thItem}>Check Item</Text>
              <Text style={s.thResult}>Result</Text>
              <Text style={s.thRemarks}>Remarks</Text>
            </View>
            {/* Table rows */}
            {section.items.map((item, iIdx) => (
              <View key={iIdx} style={iIdx % 2 === 0 ? s.tableRow : s.tableRowAlt}>
                <Text style={s.tdItem}>{item.item}</Text>
                <Text style={[s.tdResult, item.passed ? s.passText : s.failText]}>
                  {item.passed ? 'YES' : 'NO'}
                </Text>
                <Text style={s.tdRemarks}>{item.remarks || '—'}</Text>
              </View>
            ))}
          </View>
        ))}

        {/* Remarks */}
        {data.remarks ? (
          <View style={s.remarksBox}>
            <Text style={s.remarksLabel}>Remarks</Text>
            <Text style={s.remarksText}>{data.remarks}</Text>
          </View>
        ) : null}

        {/* Final verdict */}
        <View style={[s.verdictBox, isApproved ? s.verdictApproved : s.verdictRework]}>
          <Text style={s.verdictLabel}>Final Approval</Text>
          <Text style={[s.verdictText, isApproved ? s.verdictApprovedText : s.verdictReworkText]}>
            {isApproved ? '✓  APPROVED' : '✗  REWORK REQUIRED'}
          </Text>
        </View>

        {/* Signatures */}
        <View style={s.signatureRow}>
          <View style={s.signatureBlock}>
            <View style={s.signatureLine} />
            <Text style={s.signatureLabel}>Inspector</Text>
            <Text style={s.signatureName}>{data.inspectorName}</Text>
          </View>
          <View style={s.signatureBlock}>
            <View style={s.signatureLine} />
            <Text style={s.signatureLabel}>Approved By</Text>
            <Text style={s.signatureName}>{data.approverName ?? '—'}</Text>
            {data.approvedDate && (
              <Text style={s.signatureName}>Date: {data.approvedDate}</Text>
            )}
          </View>
        </View>

        {/* Footer */}
        <View style={s.footer} fixed>
          <Text style={s.footerText}>Shiroi Energy LLP — QC Report</Text>
          <Text style={s.footerText}>
            {data.projectNumber} — {data.customerName}
          </Text>
          <Text
            style={s.footerText}
            render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
          />
        </View>
      </Page>
    </Document>
  );
}
