// apps/erp/src/lib/pdf/project-report-pdf.tsx
import React from 'react';
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import { BRAND } from './pdf-styles';
import type { ProjectPdfData } from './project-pdf-data';

const s = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 9,
    color: BRAND.black,
    paddingTop: 35,
    paddingBottom: 35,
    paddingLeft: 45,
    paddingRight: 45,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: BRAND.green,
    paddingBottom: 8,
    marginBottom: 16,
  },
  companyName: {
    fontSize: 14,
    fontFamily: 'Helvetica-Bold',
    color: BRAND.green,
  },
  projectInfo: {
    fontSize: 8,
    color: BRAND.gray500,
    textAlign: 'right' as any,
  },
  title: {
    fontSize: 16,
    fontFamily: 'Helvetica-Bold',
    color: BRAND.black,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 12,
    fontFamily: 'Helvetica-Bold',
    color: BRAND.black,
    marginBottom: 8,
    marginTop: 16,
    borderBottomWidth: 1,
    borderBottomColor: BRAND.gray300,
    paddingBottom: 4,
  },
  subsection: {
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    color: BRAND.gray700,
    marginBottom: 4,
    marginTop: 8,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  label: {
    fontSize: 9,
    color: BRAND.gray500,
    width: '40%',
  },
  value: {
    fontSize: 9,
    color: BRAND.black,
    fontFamily: 'Helvetica-Bold',
    width: '60%',
    textAlign: 'right' as any,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: BRAND.gray100,
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderBottomWidth: 1,
    borderBottomColor: BRAND.gray300,
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 3,
    paddingHorizontal: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: BRAND.gray100,
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
  footer: {
    position: 'absolute',
    bottom: 20,
    left: 45,
    right: 45,
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: 7,
    color: BRAND.gray500,
    borderTopWidth: 0.5,
    borderTopColor: BRAND.gray300,
    paddingTop: 4,
  },
  badge: {
    fontSize: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: BRAND.gray100,
    color: BRAND.gray700,
  },
  badgeGreen: {
    backgroundColor: BRAND.greenLight,
    color: BRAND.green,
  },
});

function formatINR(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR',
    minimumFractionDigits: 0, maximumFractionDigits: 2,
  }).format(amount);
}

function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <View style={s.row}>
      <Text style={s.label}>{label}</Text>
      <Text style={s.value}>{value || '\u2014'}</Text>
    </View>
  );
}

interface ProjectReportPDFProps {
  data: ProjectPdfData;
  sections: string[];
}

export function ProjectReportPDF({ data, sections }: ProjectReportPDFProps) {
  const { project } = data;

  return (
    <Document>
      <Page size="A4" style={s.page}>
        {/* Header */}
        <View style={s.header}>
          <Text style={s.companyName}>SHIROI ENERGY</Text>
          <View>
            <Text style={s.projectInfo}>{project.project_number}</Text>
            <Text style={s.projectInfo}>{project.customer_name}</Text>
            <Text style={s.projectInfo}>{project.system_size_kwp} kWp {project.system_type?.replace(/_/g, ' ')}</Text>
          </View>
        </View>

        <Text style={s.title}>Project Report</Text>

        <InfoRow label="Site Address" value={project.site_address} />
        <InfoRow label="Status" value={project.status?.replace(/_/g, ' ')} />
        <InfoRow label="Generated" value={data.generatedAt} />

        {/* Survey Section */}
        {sections.includes('survey') && data.survey && (
          <View>
            <Text style={s.sectionTitle}>Site Survey</Text>
            <InfoRow label="Survey Date" value={data.survey.survey_date} />
            <InfoRow label="Roof Type" value={data.survey.roof_type?.replace(/_/g, ' ')} />
            <InfoRow label="Roof Condition" value={data.survey.roof_condition} />
            <InfoRow label="Total Area" value={data.survey.roof_area_sqft ? `${data.survey.roof_area_sqft} sq.ft` : null} />
            <InfoRow label="Usable Area" value={data.survey.usable_area_sqft ? `${data.survey.usable_area_sqft} sq.ft` : null} />
            <InfoRow label="Structure Type" value={data.survey.structure_type?.replace(/_/g, ' ')} />
            <InfoRow label="Existing Load" value={data.survey.existing_load_kw ? `${data.survey.existing_load_kw} kW` : null} />
            <InfoRow label="Sanctioned Load" value={data.survey.sanctioned_load_kw ? `${data.survey.sanctioned_load_kw} kW` : null} />
            <InfoRow label="Shading" value={data.survey.shading_assessment?.replace(/_/g, ' ')} />
            <InfoRow label="Recommended Size" value={data.survey.recommended_size_kwp ? `${data.survey.recommended_size_kwp} kWp` : null} />
            {data.survey.notes && <InfoRow label="Notes" value={data.survey.notes} />}
          </View>
        )}

        {/* BOQ Section */}
        {sections.includes('boq') && data.boqItems && data.boqItems.length > 0 && (
          <View>
            <Text style={s.sectionTitle}>BOQ — Procurement Items</Text>
            <View style={s.tableHeader}>
              <Text style={[s.tableCellBold, { width: '5%' }]}>#</Text>
              <Text style={[s.tableCellBold, { width: '20%' }]}>Category</Text>
              <Text style={[s.tableCellBold, { width: '25%' }]}>Description</Text>
              <Text style={[s.tableCellBold, { width: '10%', textAlign: 'right' as any }]}>Qty</Text>
              <Text style={[s.tableCellBold, { width: '12%', textAlign: 'right' as any }]}>Rate</Text>
              <Text style={[s.tableCellBold, { width: '8%', textAlign: 'right' as any }]}>GST</Text>
              <Text style={[s.tableCellBold, { width: '12%', textAlign: 'right' as any }]}>Total</Text>
              <Text style={[s.tableCellBold, { width: '8%' }]}>Status</Text>
            </View>
            {data.boqItems.map((item: any, idx: number) => (
              <View key={idx} style={s.tableRow}>
                <Text style={[s.tableCell, { width: '5%' }]}>{item.line_number}</Text>
                <Text style={[s.tableCell, { width: '20%' }]}>{item.item_category}</Text>
                <Text style={[s.tableCell, { width: '25%' }]}>{item.item_description}</Text>
                <Text style={[s.tableCell, { width: '10%', textAlign: 'right' as any }]}>{item.quantity} {item.unit}</Text>
                <Text style={[s.tableCell, { width: '12%', textAlign: 'right' as any }]}>{formatINR(Number(item.unit_price))}</Text>
                <Text style={[s.tableCell, { width: '8%', textAlign: 'right' as any }]}>{item.gst_rate}%</Text>
                <Text style={[s.tableCell, { width: '12%', textAlign: 'right' as any }]}>{formatINR(Number(item.total_price))}</Text>
                <Text style={[s.tableCell, { width: '8%' }]}>{(item.procurement_status || '').replace(/_/g, ' ')}</Text>
              </View>
            ))}
            <View style={[s.tableRow, { borderTopWidth: 1, borderTopColor: BRAND.gray300 }]}>
              <Text style={[s.tableCellBold, { width: '80%', textAlign: 'right' as any }]}>Total</Text>
              <Text style={[s.tableCellBold, { width: '12%', textAlign: 'right' as any }]}>{formatINR(data.boqTotal ?? 0)}</Text>
              <Text style={[s.tableCell, { width: '8%' }]} />
            </View>
          </View>
        )}

        {/* QC Section */}
        {sections.includes('qc') && data.qcInspections && data.qcInspections.length > 0 && (
          <View>
            <Text style={s.sectionTitle}>QC Gate Inspections</Text>
            {data.qcInspections.map((insp: any, idx: number) => (
              <View key={idx} style={{ marginBottom: 8 }}>
                <Text style={s.subsection}>Gate {insp.gate_number}</Text>
                <InfoRow label="Date" value={insp.inspection_date} />
                <InfoRow label="Result" value={insp.overall_result?.replace(/_/g, ' ')} />
                <InfoRow label="Re-inspection Required" value={insp.requires_reinspection ? 'Yes' : 'No'} />
              </View>
            ))}
          </View>
        )}

        {/* Commissioning Section */}
        {sections.includes('commissioning') && data.commissioningReport && (
          <View>
            <Text style={s.sectionTitle}>Commissioning Report</Text>
            <InfoRow label="Date" value={data.commissioningReport.commissioning_date} />
            <InfoRow label="System Size" value={`${data.commissioningReport.system_size_kwp} kWp`} />
            <InfoRow label="Panels Installed" value={data.commissioningReport.panel_count_installed?.toString()} />
            <InfoRow label="Inverter S/N" value={data.commissioningReport.inverter_serial_number} />

            <Text style={s.subsection}>Electrical Readings</Text>
            <InfoRow label="DC Voltage" value={data.commissioningReport.dc_voltage_v ? `${data.commissioningReport.dc_voltage_v} V` : null} />
            <InfoRow label="DC Current" value={data.commissioningReport.dc_current_a ? `${data.commissioningReport.dc_current_a} A` : null} />
            <InfoRow label="AC Voltage" value={data.commissioningReport.ac_voltage_v ? `${data.commissioningReport.ac_voltage_v} V` : null} />
            <InfoRow label="AC Frequency" value={data.commissioningReport.ac_frequency_hz ? `${data.commissioningReport.ac_frequency_hz} Hz` : null} />
            <InfoRow label="Earth Resistance" value={data.commissioningReport.earth_resistance_ohm ? `${data.commissioningReport.earth_resistance_ohm} Ω` : null} />
            <InfoRow label="Insulation Resistance" value={data.commissioningReport.insulation_resistance_mohm ? `${data.commissioningReport.insulation_resistance_mohm} MΩ` : null} />
            <InfoRow label="Initial Reading" value={data.commissioningReport.initial_reading_kwh ? `${data.commissioningReport.initial_reading_kwh} kWh` : null} />

            <Text style={s.subsection}>Customer Handover</Text>
            <InfoRow label="Generation Confirmed" value={data.commissioningReport.generation_confirmed ? 'Yes' : 'No'} />
            <InfoRow label="Customer Explained" value={data.commissioningReport.customer_explained ? 'Yes' : 'No'} />
            <InfoRow label="App Download Assisted" value={data.commissioningReport.app_download_assisted ? 'Yes' : 'No'} />
          </View>
        )}

        {/* Delivery Challans Section */}
        {sections.includes('dc') && data.outgoingChallans && data.outgoingChallans.length > 0 && (
          <View>
            <Text style={s.sectionTitle}>Delivery Challans</Text>
            {data.outgoingChallans.map((dc: any, idx: number) => (
              <View key={idx} style={{ marginBottom: 8 }}>
                <Text style={s.subsection}>{dc.dc_number}</Text>
                <InfoRow label="Date" value={dc.dc_date} />
                <InfoRow label="Status" value={dc.status?.replace(/_/g, ' ')} />
                <InfoRow label="Vehicle" value={dc.vehicle_number} />
                <InfoRow label="Items" value={dc.delivery_challan_items?.length?.toString()} />
              </View>
            ))}
          </View>
        )}

        {/* Footer */}
        <View style={s.footer} fixed>
          <Text>Shiroi Energy Private Limited</Text>
          <Text>Generated: {data.generatedAt}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
