// apps/erp/src/lib/pdf/commissioning-report-pdf.tsx
// Commissioning Report PDF — Shiroi Energy LLP format per Manivel's spec
import React from 'react';
import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer';
import { BRAND } from './pdf-styles';

export interface StringTestRow {
  inverter_no: string;
  string_no: string;
  vmp: string | number;
  isc: string | number;
  polarity_ok: boolean;
}

export interface CommissioningPdfData {
  projectNumber: string;
  customerName: string;
  siteAddress: string;
  commissioningDate: string;
  systemSize: string;
  systemType: string;
  panelCount: number;
  inverterSerial: string;
  initialReading: string;
  // System-level readings
  dcVoltage: string;
  dcCurrent: string;
  acVoltage: string;
  acFrequency: string;
  earthResistance: string;
  insulationResistance: string;
  irLow: boolean;
  // String tests
  stringTests: StringTestRow[];
  // Monitoring
  monitoringLink: string;
  monitoringLogin: string;
  monitoringPassword: string;
  // Performance
  performanceRatio: string;
  // Handover
  generationConfirmed: boolean;
  customerExplained: boolean;
  appAssisted: boolean;
  // Notes
  notes: string;
  // People
  preparedByName: string;
  status: string;
  // Signatures (optional — only present when finalized)
  engineerSignature?: Buffer | null;
  customerSignature?: Buffer | null;
}

const s = StyleSheet.create({
  page: { fontFamily: 'Helvetica', fontSize: 9, color: BRAND.black, paddingTop: 30, paddingBottom: 80, paddingLeft: 40, paddingRight: 40 },
  headerBar: { height: 3, backgroundColor: BRAND.green, marginBottom: 12 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  companyName: { fontSize: 16, fontFamily: 'Helvetica-Bold', color: BRAND.green },
  companyAddr: { fontSize: 7.5, color: BRAND.gray500, marginTop: 1, lineHeight: 1.4 },
  gstLine: { fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: BRAND.gray700, marginTop: 2 },
  contactLine: { fontSize: 7.5, color: BRAND.gray500, marginTop: 1 },
  title: { fontSize: 14, fontFamily: 'Helvetica-Bold', color: BRAND.black, textAlign: 'center' as const, marginTop: 8, marginBottom: 10, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  // Info grid
  infoGrid: { flexDirection: 'row', borderWidth: 0.5, borderColor: BRAND.gray300, marginBottom: 10 },
  infoCell: { flex: 1, padding: 6, borderRightWidth: 0.5, borderRightColor: BRAND.gray300 },
  infoCellLast: { flex: 1, padding: 6 },
  infoLabel: { fontSize: 7, color: BRAND.gray500, marginBottom: 2 },
  infoValue: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: BRAND.black },
  // Section
  sectionTitle: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: BRAND.green, marginTop: 10, marginBottom: 4, borderBottomWidth: 0.5, borderBottomColor: BRAND.green, paddingBottom: 2 },
  // Key-value row
  kvRow: { flexDirection: 'row', paddingVertical: 2 },
  kvLabel: { width: '45%', fontSize: 8.5, color: BRAND.gray500 },
  kvValue: { width: '55%', fontSize: 8.5, color: BRAND.black, fontFamily: 'Helvetica-Bold' },
  // Table
  tableHeader: { flexDirection: 'row', backgroundColor: BRAND.green, paddingVertical: 4, paddingHorizontal: 4 },
  thText: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: BRAND.white },
  tableRow: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: BRAND.gray300, paddingVertical: 3, paddingHorizontal: 4 },
  tableRowAlt: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: BRAND.gray300, paddingVertical: 3, paddingHorizontal: 4, backgroundColor: BRAND.gray50 },
  tdText: { fontSize: 8.5, color: BRAND.black },
  tdMono: { fontSize: 8.5, color: BRAND.black, fontFamily: 'Helvetica-Bold' },
  passText: { fontSize: 8.5, color: '#065F46', fontFamily: 'Helvetica-Bold' },
  failText: { fontSize: 8.5, color: '#991B1B', fontFamily: 'Helvetica-Bold' },
  // IR warning
  irWarning: { backgroundColor: '#FEF2F2', borderWidth: 0.5, borderColor: '#991B1B', padding: 6, borderRadius: 3, marginTop: 4 },
  irWarningText: { fontSize: 8, color: '#991B1B', fontFamily: 'Helvetica-Bold' },
  // Handover
  checkRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 2, gap: 4 },
  checkIcon: { fontSize: 10, fontFamily: 'Helvetica-Bold' },
  checkLabel: { fontSize: 8.5, color: BRAND.black },
  // Notes box
  notesBox: { borderWidth: 0.5, borderColor: BRAND.gray300, padding: 8, marginTop: 6, minHeight: 30 },
  notesLabel: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: BRAND.gray700, marginBottom: 3 },
  notesText: { fontSize: 8.5, color: BRAND.black, lineHeight: 1.4 },
  // Signatures
  sigRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 40 },
  sigBlock: { width: '40%' },
  sigLine: { borderBottomWidth: 1, borderBottomColor: BRAND.gray300, marginBottom: 4 },
  sigLabel: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: BRAND.gray700 },
  sigName: { fontSize: 7.5, color: BRAND.gray500, marginTop: 2 },
  sigImage: { width: 120, height: 60, marginBottom: 4 },
  // Footer
  footer: { position: 'absolute' as const, bottom: 20, left: 40, right: 40, flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 0.5, borderTopColor: BRAND.gray300, paddingTop: 6 },
  footerText: { fontSize: 7, color: BRAND.gray500 },
});

export function CommissioningReportPDF({ data }: { data: CommissioningPdfData }) {
  return (
    <Document>
      <Page size="A4" style={s.page}>
        <View style={s.headerBar} />

        {/* Company header */}
        <View style={s.headerRow}>
          <View>
            <Text style={s.companyName}>SHIROI ENERGY LLP</Text>
            <Text style={s.companyAddr}>
              Solar EPC Solutions{'\n'}No. 75/34, Third Main Road, Kasturbai Nagar,{'\n'}Adyar, Chennai — 600020
            </Text>
            <Text style={s.gstLine}>GSTIN: 33ACPFS4398J1ZE</Text>
            <Text style={s.contactLine}>Contact: 9486801859</Text>
          </View>
        </View>

        <Text style={s.title}>Commissioning Report</Text>

        {/* Project info */}
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
            <Text style={s.infoValue}>{data.systemSize} kWp — {data.systemType}</Text>
          </View>
          <View style={s.infoCellLast}>
            <Text style={s.infoLabel}>Commissioning Date</Text>
            <Text style={s.infoValue}>{data.commissioningDate}</Text>
          </View>
        </View>

        {/* System Overview */}
        <Text style={s.sectionTitle}>System Overview</Text>
        <View style={s.kvRow}>
          <Text style={s.kvLabel}>Panels Installed</Text>
          <Text style={s.kvValue}>{data.panelCount}</Text>
        </View>
        <View style={s.kvRow}>
          <Text style={s.kvLabel}>Inverter Serial No.</Text>
          <Text style={s.kvValue}>{data.inverterSerial || '—'}</Text>
        </View>
        <View style={s.kvRow}>
          <Text style={s.kvLabel}>Initial Meter Reading</Text>
          <Text style={s.kvValue}>{data.initialReading} kWh</Text>
        </View>
        {data.performanceRatio && (
          <View style={s.kvRow}>
            <Text style={s.kvLabel}>Performance Ratio</Text>
            <Text style={s.kvValue}>{data.performanceRatio}%</Text>
          </View>
        )}

        {/* String-Level Tests */}
        {data.stringTests.length > 0 && (
          <View wrap={false}>
            <Text style={s.sectionTitle}>String-Level Electrical Tests</Text>
            <View style={s.tableHeader}>
              <Text style={[s.thText, { width: '15%' }]}>Inv. No.</Text>
              <Text style={[s.thText, { width: '15%' }]}>String No.</Text>
              <Text style={[s.thText, { width: '25%' }]}>Vmp (V)</Text>
              <Text style={[s.thText, { width: '25%' }]}>Isc (A)</Text>
              <Text style={[s.thText, { width: '20%', textAlign: 'center' as const }]}>Polarity</Text>
            </View>
            {data.stringTests.map((row, idx) => (
              <View key={idx} style={idx % 2 === 0 ? s.tableRow : s.tableRowAlt}>
                <Text style={[s.tdText, { width: '15%' }]}>{row.inverter_no}</Text>
                <Text style={[s.tdText, { width: '15%' }]}>{row.string_no}</Text>
                <Text style={[s.tdMono, { width: '25%' }]}>{row.vmp || '—'}</Text>
                <Text style={[s.tdMono, { width: '25%' }]}>{row.isc || '—'}</Text>
                <Text style={[row.polarity_ok ? s.passText : s.failText, { width: '20%', textAlign: 'center' as const }]}>
                  {row.polarity_ok ? 'OK' : 'FAIL'}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* System-Level Readings */}
        <Text style={s.sectionTitle}>System-Level Electrical Readings</Text>
        <View style={{ flexDirection: 'row' }}>
          <View style={{ width: '50%' }}>
            <View style={s.kvRow}><Text style={s.kvLabel}>DC Voltage</Text><Text style={s.kvValue}>{data.dcVoltage || '—'} V</Text></View>
            <View style={s.kvRow}><Text style={s.kvLabel}>DC Current</Text><Text style={s.kvValue}>{data.dcCurrent || '—'} A</Text></View>
            <View style={s.kvRow}><Text style={s.kvLabel}>AC Voltage</Text><Text style={s.kvValue}>{data.acVoltage || '—'} V</Text></View>
          </View>
          <View style={{ width: '50%' }}>
            <View style={s.kvRow}><Text style={s.kvLabel}>AC Frequency</Text><Text style={s.kvValue}>{data.acFrequency || '—'} Hz</Text></View>
            <View style={s.kvRow}><Text style={s.kvLabel}>Earth Resistance</Text><Text style={s.kvValue}>{data.earthResistance || '—'} Ω</Text></View>
            <View style={s.kvRow}><Text style={s.kvLabel}>Insulation Resistance</Text><Text style={s.kvValue}>{data.insulationResistance || '—'} MΩ</Text></View>
          </View>
        </View>

        {data.irLow && (
          <View style={s.irWarning}>
            <Text style={s.irWarningText}>⚠ IR reading below 0.5 MΩ — Critical service ticket created (4h SLA)</Text>
          </View>
        )}

        {/* Monitoring Details */}
        {(data.monitoringLink || data.monitoringLogin) && (
          <View wrap={false}>
            <Text style={s.sectionTitle}>Monitoring Details</Text>
            {data.monitoringLink && (
              <View style={s.kvRow}><Text style={s.kvLabel}>Portal Link</Text><Text style={s.kvValue}>{data.monitoringLink}</Text></View>
            )}
            {data.monitoringLogin && (
              <View style={s.kvRow}><Text style={s.kvLabel}>Login</Text><Text style={s.kvValue}>{data.monitoringLogin}</Text></View>
            )}
            {data.monitoringPassword && (
              <View style={s.kvRow}><Text style={s.kvLabel}>Password</Text><Text style={s.kvValue}>{data.monitoringPassword}</Text></View>
            )}
          </View>
        )}

        {/* Customer Handover */}
        <Text style={s.sectionTitle}>Customer Handover</Text>
        <View style={s.checkRow}>
          <Text style={[s.checkIcon, { color: data.generationConfirmed ? '#065F46' : '#991B1B' }]}>
            {data.generationConfirmed ? '✓' : '✗'}
          </Text>
          <Text style={s.checkLabel}>Generation confirmed with customer on-site</Text>
        </View>
        <View style={s.checkRow}>
          <Text style={[s.checkIcon, { color: data.customerExplained ? '#065F46' : '#991B1B' }]}>
            {data.customerExplained ? '✓' : '✗'}
          </Text>
          <Text style={s.checkLabel}>System operation explained to customer</Text>
        </View>
        <View style={s.checkRow}>
          <Text style={[s.checkIcon, { color: data.appAssisted ? '#065F46' : '#991B1B' }]}>
            {data.appAssisted ? '✓' : '✗'}
          </Text>
          <Text style={s.checkLabel}>Monitoring app download assisted</Text>
        </View>

        {/* Notes */}
        {data.notes && (
          <View style={s.notesBox}>
            <Text style={s.notesLabel}>Notes</Text>
            <Text style={s.notesText}>{data.notes}</Text>
          </View>
        )}

        {/* Signatures */}
        <View style={s.sigRow}>
          <View style={s.sigBlock}>
            {data.engineerSignature ? (
              <Image
                src={data.engineerSignature}
                style={s.sigImage}
              />
            ) : (
              <View style={s.sigLine} />
            )}
            <Text style={s.sigLabel}>Prepared By</Text>
            <Text style={s.sigName}>{data.preparedByName}</Text>
          </View>
          <View style={s.sigBlock}>
            {data.customerSignature ? (
              <Image
                src={data.customerSignature}
                style={s.sigImage}
              />
            ) : (
              <View style={s.sigLine} />
            )}
            <Text style={s.sigLabel}>Customer Signature</Text>
          </View>
        </View>

        {/* Footer */}
        <View style={s.footer} fixed>
          <Text style={s.footerText}>Shiroi Energy LLP — Commissioning Report</Text>
          <Text style={s.footerText}>{data.projectNumber} — {data.customerName}</Text>
          <Text style={s.footerText} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
