// apps/erp/src/lib/pdf/survey-report-pdf.tsx
// Site Survey Report PDF — Shiroi Energy LLP format per Manivel's spec
import React from 'react';
import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer';
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
  reportTitle: {
    fontSize: 16,
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
  // ── Info grid ──
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
    textTransform: 'uppercase' as const,
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
  // ── Section ──
  sectionHeading: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: BRAND.green,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    marginBottom: 6,
    marginTop: 12,
  },
  sectionBox: {
    borderWidth: 0.5,
    borderColor: BRAND.gray300,
    borderRadius: 3,
    padding: 10,
    marginBottom: 8,
  },
  // ── Field rows ──
  fieldRow: {
    flexDirection: 'row',
    marginBottom: 5,
  },
  fieldCol: {
    flex: 1,
    paddingRight: 8,
  },
  fieldLabel: {
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    color: BRAND.gray500,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.4,
    marginBottom: 1,
  },
  fieldValue: {
    fontSize: 8.5,
    color: BRAND.black,
  },
  fieldValueBold: {
    fontSize: 8.5,
    fontFamily: 'Helvetica-Bold',
    color: BRAND.black,
  },
  fieldValueMissing: {
    fontSize: 8.5,
    color: BRAND.gray500,
    fontStyle: 'italic' as const,
  },
  // ── Photo ──
  photoBlock: {
    marginTop: 8,
    marginBottom: 4,
  },
  photoLabel: {
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    color: BRAND.gray500,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.4,
    marginBottom: 3,
  },
  photoImage: {
    maxWidth: 200,
    maxHeight: 150,
    objectFit: 'contain' as const,
  },
  photoMissing: {
    fontSize: 8,
    color: BRAND.gray500,
    fontStyle: 'italic' as const,
  },
  // ── Equipment grid ──
  equipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap' as const,
    gap: 8,
  },
  equipItem: {
    width: '48%',
    marginBottom: 8,
  },
  // ── Shade row ──
  shadeRow: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 5,
  },
  shadeItem: {
    flexDirection: 'row',
    alignItems: 'center' as const,
    gap: 4,
  },
  shadeBadge: {
    fontSize: 7.5,
    fontFamily: 'Helvetica-Bold',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 2,
  },
  shadeBadgeYes: {
    backgroundColor: BRAND.amber,
    color: BRAND.white,
  },
  shadeBadgeNo: {
    backgroundColor: BRAND.green,
    color: BRAND.white,
  },
  // ── Signature ──
  signatureRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 20,
    paddingHorizontal: 20,
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
    height: 50,
  },
  signatureImage: {
    width: '100%',
    height: 50,
    objectFit: 'contain' as const,
  },
  signatureLabel: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: BRAND.gray500,
    textAlign: 'center' as const,
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
    alignItems: 'center' as const,
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

export interface SurveyReportPdfData {
  // Project
  projectNumber: string;
  customerName: string;
  siteAddress: string;
  surveyDate: string | null;
  surveyorName: string | null;
  // Section 1 — Project Details
  gpsLat: number | null;
  gpsLng: number | null;
  contactPersonName: string | null;
  contactPhone: string | null;
  siteAccessNotes: string | null;
  surveyStatus: string | null;
  // Section 2 — Roof & Mounting
  roofType: string | null;
  roofCondition: string | null;
  roofAgeYears: number | null;
  roofOrientation: string | null;
  roofTiltDegrees: number | null;
  roofAreaSqft: number | null;
  usableAreaSqft: number | null;
  structureType: string | null;
  mountingFeasibilityChecked: boolean | null;
  // Section 3 — Electrical
  existingLoadKw: number | null;
  sanctionedLoadKw: number | null;
  meterType: string | null;
  supplyVoltage: string | null;
  discomName: string | null;
  earthingType: string | null;
  earthingCondition: string | null;
  netMeteringEligible: boolean | null;
  // Section 4 — Equipment Finalization (inverter location text)
  inverterLocation: string | null;
  dcRouting: string | null;
  // Section 5 — Shading
  shadeSources: string[] | null;
  morningShade: boolean | null;
  afternoonShade: boolean | null;
  shadingNotes: string | null;
  // Section 6 — Recommendations
  recommendedSizeKwp: number | null;
  recommendedSystemType: string | null;
  estimatedGenerationKwhYear: number | null;
  panelPlacementNotes: string | null;
  cableRoutingNotes: string | null;
  // Section 7 — Additional Items
  additionalPanelsRequired: boolean | null;
  additionalPanelsRemarks: string | null;
  additionalInverterRequired: boolean | null;
  additionalInverterRemarks: string | null;
  routingChanges: string | null;
  cableSizeChanges: string | null;
  otherSpecialRequests: string | null;
  // Section 8 — Notes
  notes: string | null;
  // Photos: keyed by photo field name → Buffer or null
  photos: Record<string, Buffer | null>;
  // Signatures: keyed by 'surveyor' | 'customer' → Buffer or null
  signatures: Record<string, Buffer | null>;
}

// ── Helpers ──

function val(v: string | number | null | undefined, fallback = '\u2014'): string {
  if (v === null || v === undefined || v === '') return fallback;
  return String(v);
}

function yesNo(v: boolean | null): string {
  if (v === null || v === undefined) return '\u2014';
  return v ? 'Yes' : 'No';
}

function PhotoOrMissing({ photo, label }: { photo: Buffer | null; label: string }) {
  return (
    <View style={s.photoBlock}>
      <Text style={s.photoLabel}>{label}</Text>
      {photo ? (
        <Image src={photo} style={s.photoImage} />
      ) : (
        <Text style={s.photoMissing}>Not captured</Text>
      )}
    </View>
  );
}

function FieldPair({
  label1, value1, label2, value2, bold1, bold2,
}: {
  label1: string;
  value1: string | null | undefined;
  label2?: string;
  value2?: string | null | undefined;
  bold1?: boolean;
  bold2?: boolean;
}) {
  return (
    <View style={s.fieldRow}>
      <View style={s.fieldCol}>
        <Text style={s.fieldLabel}>{label1}</Text>
        <Text style={bold1 ? s.fieldValueBold : s.fieldValue}>{val(value1)}</Text>
      </View>
      {label2 !== undefined && (
        <View style={s.fieldCol}>
          <Text style={s.fieldLabel}>{label2}</Text>
          <Text style={bold2 ? s.fieldValueBold : s.fieldValue}>{val(value2)}</Text>
        </View>
      )}
    </View>
  );
}

// ── Main PDF Component ──

export function SurveyReportPDF({ data }: { data: SurveyReportPdfData }) {
  const p = data;

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

        {/* Title */}
        <View style={s.divider} />
        <Text style={s.reportTitle}>Site Survey Report</Text>
        <View style={s.divider} />

        {/* Project Info Grid */}
        <View style={s.infoGrid}>
          <View style={s.infoColumn}>
            <Text style={s.infoLabel}>Project Number</Text>
            <Text style={s.infoValueBold}>{p.projectNumber}</Text>

            <Text style={s.infoLabel}>Customer Name</Text>
            <Text style={s.infoValue}>{p.customerName}</Text>

            <Text style={s.infoLabel}>Site Address</Text>
            <Text style={s.infoValue}>{p.siteAddress || '\u2014'}</Text>
          </View>
          <View style={s.infoColumn}>
            <Text style={s.infoLabel}>Survey Date</Text>
            <Text style={s.infoValue}>{p.surveyDate || '\u2014'}</Text>

            <Text style={s.infoLabel}>Surveyor</Text>
            <Text style={s.infoValue}>{p.surveyorName || '\u2014'}</Text>
          </View>
        </View>

        {/* Section 1 — Project Details */}
        <Text style={s.sectionHeading}>Section 1 — Project Details</Text>
        <View style={s.sectionBox}>
          <FieldPair
            label1="GPS Coordinates"
            value1={p.gpsLat != null && p.gpsLng != null ? `${p.gpsLat}, ${p.gpsLng}` : null}
            label2="Survey Status"
            value2={p.surveyStatus}
          />
          <FieldPair
            label1="Contact Person"
            value1={p.contactPersonName}
            label2="Contact Phone"
            value2={p.contactPhone}
          />
          <View style={s.fieldRow}>
            <View style={[s.fieldCol, { flex: 2 }]}>
              <Text style={s.fieldLabel}>Site Access Notes</Text>
              <Text style={s.fieldValue}>{val(p.siteAccessNotes)}</Text>
            </View>
          </View>
        </View>

        {/* Section 2 — Roof & Mounting */}
        <Text style={s.sectionHeading}>Section 2 — Roof & Mounting</Text>
        <View style={s.sectionBox}>
          <FieldPair label1="Roof Type" value1={p.roofType} label2="Roof Condition" value2={p.roofCondition} />
          <FieldPair
            label1="Roof Age (Years)"
            value1={p.roofAgeYears != null ? String(p.roofAgeYears) : null}
            label2="Orientation"
            value2={p.roofOrientation}
          />
          <FieldPair
            label1="Tilt Degrees"
            value1={p.roofTiltDegrees != null ? `${p.roofTiltDegrees}°` : null}
            label2="Structure Type"
            value2={p.structureType}
          />
          <FieldPair
            label1="Roof Area (sqft)"
            value1={p.roofAreaSqft != null ? String(p.roofAreaSqft) : null}
            label2="Usable Area (sqft)"
            value2={p.usableAreaSqft != null ? String(p.usableAreaSqft) : null}
          />
          <FieldPair
            label1="Mounting Feasibility Checked"
            value1={yesNo(p.mountingFeasibilityChecked)}
          />
          {/* Roof condition + shadow area photos inline */}
          <View style={{ flexDirection: 'row', gap: 12, marginTop: 6 }}>
            <View style={{ flex: 1 }}>
              <PhotoOrMissing photo={p.photos['roof_condition_photo_path'] ?? null} label="Roof Condition Photo" />
            </View>
            <View style={{ flex: 1 }}>
              <PhotoOrMissing photo={p.photos['shadow_area_photo_path'] ?? null} label="Shadow Area Photo" />
            </View>
          </View>
        </View>

        {/* Section 3 — Electrical */}
        <Text style={s.sectionHeading}>Section 3 — Electrical</Text>
        <View style={s.sectionBox}>
          <FieldPair
            label1="Existing Load (kW)"
            value1={p.existingLoadKw != null ? String(p.existingLoadKw) : null}
            label2="Sanctioned Load (kW)"
            value2={p.sanctionedLoadKw != null ? String(p.sanctionedLoadKw) : null}
          />
          <FieldPair label1="Meter Type" value1={p.meterType} label2="Supply Voltage" value2={p.supplyVoltage} />
          <FieldPair label1="DISCOM" value1={p.discomName} label2="Net Metering Eligible" value2={yesNo(p.netMeteringEligible)} />
          <FieldPair label1="Earthing Type" value1={p.earthingType} label2="Earthing Condition" value2={p.earthingCondition} />
        </View>

        {/* Section 4 — Equipment Finalization */}
        <Text style={s.sectionHeading}>Section 4 — Equipment Finalization</Text>
        <View style={s.sectionBox}>
          <View style={s.equipGrid}>
            {/* Inverter Location */}
            <View style={s.equipItem}>
              <Text style={s.fieldLabel}>Inverter Location</Text>
              <Text style={s.fieldValue}>{val(p.inverterLocation)}</Text>
              <PhotoOrMissing photo={p.photos['inverter_location_photo_path'] ?? null} label="Photo" />
            </View>
            {/* DC Routing */}
            <View style={s.equipItem}>
              <Text style={s.fieldLabel}>DC Routing</Text>
              <Text style={s.fieldValue}>{val(p.dcRouting)}</Text>
              <PhotoOrMissing photo={p.photos['dc_routing_photo_path'] ?? null} label="Photo" />
            </View>
            {/* Earthing Pit */}
            <View style={s.equipItem}>
              <Text style={s.fieldLabel}>Earthing Pit</Text>
              <PhotoOrMissing photo={p.photos['earthing_pit_photo_path'] ?? null} label="Photo" />
            </View>
            {/* LA Location */}
            <View style={s.equipItem}>
              <Text style={s.fieldLabel}>LA Location</Text>
              <PhotoOrMissing photo={p.photos['la_location_photo_path'] ?? null} label="Photo" />
            </View>
            {/* Termination Point */}
            <View style={s.equipItem}>
              <Text style={s.fieldLabel}>Termination Point</Text>
              <PhotoOrMissing photo={p.photos['termination_point_photo_path'] ?? null} label="Photo" />
            </View>
            {/* Spare Feeder */}
            <View style={s.equipItem}>
              <Text style={s.fieldLabel}>Spare Feeder</Text>
              <PhotoOrMissing photo={p.photos['spare_feeder_photo_path'] ?? null} label="Photo" />
              <PhotoOrMissing photo={p.photos['spare_feeder_rating_photo_path'] ?? null} label="Rating Photo" />
            </View>
            {/* DG/EB Check */}
            <View style={s.equipItem}>
              <Text style={s.fieldLabel}>DG / EB Check</Text>
              <PhotoOrMissing photo={p.photos['dg_eb_photo_path'] ?? null} label="Photo" />
            </View>
            {/* AC Routing */}
            <View style={s.equipItem}>
              <Text style={s.fieldLabel}>AC Routing</Text>
              <PhotoOrMissing photo={p.photos['ac_routing_photo_path'] ?? null} label="Photo" />
            </View>
          </View>
          {/* Additional overview photos */}
          <View style={{ flexDirection: 'row', gap: 12, marginTop: 6 }}>
            <View style={{ flex: 1 }}>
              <PhotoOrMissing photo={p.photos['roof_photo_path'] ?? null} label="Roof Photo" />
            </View>
            <View style={{ flex: 1 }}>
              <PhotoOrMissing photo={p.photos['site_overview_photo_path'] ?? null} label="Site Overview" />
            </View>
            <View style={{ flex: 1 }}>
              <PhotoOrMissing photo={p.photos['electrical_panel_photo_path'] ?? null} label="Electrical Panel" />
            </View>
            <View style={{ flex: 1 }}>
              <PhotoOrMissing photo={p.photos['meter_photo_path'] ?? null} label="Meter Photo" />
            </View>
          </View>
        </View>

        {/* Section 5 — Shading Assessment */}
        <Text style={s.sectionHeading}>Section 5 — Shading Assessment</Text>
        <View style={s.sectionBox}>
          <View style={s.fieldRow}>
            <View style={s.fieldCol}>
              <Text style={s.fieldLabel}>Shade Sources</Text>
              <Text style={s.fieldValue}>
                {p.shadeSources && p.shadeSources.length > 0
                  ? p.shadeSources.join(', ')
                  : '\u2014'}
              </Text>
            </View>
          </View>
          <View style={s.shadeRow}>
            <View style={s.shadeItem}>
              <Text style={s.fieldLabel}>Morning Shade:</Text>
              <Text
                style={[
                  s.shadeBadge,
                  p.morningShade ? s.shadeBadgeYes : s.shadeBadgeNo,
                ]}
              >
                {yesNo(p.morningShade)}
              </Text>
            </View>
            <View style={s.shadeItem}>
              <Text style={s.fieldLabel}>Afternoon Shade:</Text>
              <Text
                style={[
                  s.shadeBadge,
                  p.afternoonShade ? s.shadeBadgeYes : s.shadeBadgeNo,
                ]}
              >
                {yesNo(p.afternoonShade)}
              </Text>
            </View>
          </View>
          <View style={s.fieldRow}>
            <View style={[s.fieldCol, { flex: 2 }]}>
              <Text style={s.fieldLabel}>Shading Notes</Text>
              <Text style={s.fieldValue}>{val(p.shadingNotes)}</Text>
            </View>
          </View>
        </View>

        {/* Section 6 — Recommendations */}
        <Text style={s.sectionHeading}>Section 6 — Recommendations</Text>
        <View style={s.sectionBox}>
          <FieldPair
            label1="Recommended Size (kWp)"
            value1={p.recommendedSizeKwp != null ? String(p.recommendedSizeKwp) : null}
            bold1
            label2="Recommended System Type"
            value2={p.recommendedSystemType}
            bold2
          />
          <FieldPair
            label1="Estimated Generation (kWh/year)"
            value1={p.estimatedGenerationKwhYear != null ? String(p.estimatedGenerationKwhYear) : null}
          />
          <View style={s.fieldRow}>
            <View style={[s.fieldCol, { flex: 2 }]}>
              <Text style={s.fieldLabel}>Panel Placement Notes</Text>
              <Text style={s.fieldValue}>{val(p.panelPlacementNotes)}</Text>
            </View>
          </View>
          <View style={s.fieldRow}>
            <View style={[s.fieldCol, { flex: 2 }]}>
              <Text style={s.fieldLabel}>Cable Routing Notes</Text>
              <Text style={s.fieldValue}>{val(p.cableRoutingNotes)}</Text>
            </View>
          </View>
        </View>

        {/* Section 7 — Additional Items */}
        <Text style={s.sectionHeading}>Section 7 — Additional Items</Text>
        <View style={s.sectionBox}>
          <FieldPair
            label1="Additional Panels Required"
            value1={yesNo(p.additionalPanelsRequired)}
            label2="Remarks"
            value2={p.additionalPanelsRemarks}
          />
          <FieldPair
            label1="Additional Inverter Required"
            value1={yesNo(p.additionalInverterRequired)}
            label2="Remarks"
            value2={p.additionalInverterRemarks}
          />
          <FieldPair label1="Routing Changes" value1={p.routingChanges} />
          <FieldPair label1="Cable Size Changes" value1={p.cableSizeChanges} />
          <View style={s.fieldRow}>
            <View style={[s.fieldCol, { flex: 2 }]}>
              <Text style={s.fieldLabel}>Other Special Requests</Text>
              <Text style={s.fieldValue}>{val(p.otherSpecialRequests)}</Text>
            </View>
          </View>
        </View>

        {/* Section 8 — Notes & Signatures */}
        <Text style={s.sectionHeading}>Section 8 — Notes & Signatures</Text>
        <View style={s.sectionBox}>
          <View style={s.fieldRow}>
            <View style={[s.fieldCol, { flex: 2 }]}>
              <Text style={s.fieldLabel}>Notes</Text>
              <Text style={s.fieldValue}>{val(p.notes)}</Text>
            </View>
          </View>

          <View style={s.signatureRow}>
            {/* Surveyor Signature */}
            <View style={s.signatureBlock}>
              {p.signatures['surveyor'] ? (
                <Image src={p.signatures['surveyor']} style={s.signatureImage} />
              ) : (
                <View style={s.signatureLine} />
              )}
              <Text style={s.signatureLabel}>Surveyor Signature</Text>
              {p.surveyorName && (
                <Text style={[s.signatureLabel, { fontFamily: 'Helvetica', marginTop: 2 }]}>
                  {p.surveyorName}
                </Text>
              )}
            </View>
            {/* Customer Signature */}
            <View style={s.signatureBlock}>
              {p.signatures['customer'] ? (
                <Image src={p.signatures['customer']} style={s.signatureImage} />
              ) : (
                <View style={s.signatureLine} />
              )}
              <Text style={s.signatureLabel}>Customer Signature</Text>
              <Text style={[s.signatureLabel, { fontFamily: 'Helvetica', marginTop: 2 }]}>
                {p.customerName}
              </Text>
            </View>
          </View>
        </View>

        {/* Footer */}
        <View style={s.footer} fixed>
          <Text style={s.footerBrand}>Shiroi Energy LLP</Text>
          <Text style={s.footerText}>SITE SURVEY REPORT | {p.projectNumber}</Text>
          <Text
            style={s.footerText}
            render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
          />
        </View>
      </Page>
    </Document>
  );
}
