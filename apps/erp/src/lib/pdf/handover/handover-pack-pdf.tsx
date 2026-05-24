// apps/erp/src/lib/pdf/handover/handover-pack-pdf.tsx
// Role: Handover & Commissioning Certificate PDF (C11).
// Rendered server-side via @react-pdf/renderer → renderToBuffer.
import React from 'react';
import { Document, Page, View, Text } from '@react-pdf/renderer';
import { BRAND, styles } from '../pdf-styles';
import {
  SHIROI_CONTACT,
  WARRANTY_TERMS,
  OM_INSTRUCTIONS,
  DOCUMENTS_CHECKLIST,
  CHENNAI_YIELD_KWH_PER_KWP,
  ELECTRICITY_RATE_PER_UNIT,
} from './handover-constants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HandoverPdfData {
  // Project
  projectNumber: string;
  customerName: string;
  siteAddress: string;
  systemSizeKwp: number;
  systemType: string;
  commissionedDate: string;         // 'YYYY-MM-DD' or ISO
  projectManagerName: string | null;

  // System
  panelBrand: string | null;
  panelModel: string | null;
  panelCount: number | null;
  panelWattage: number | null;
  inverterBrand: string | null;
  inverterModel: string | null;
  structureType: string | null;

  // Performance
  annualGenerationKwh?: number;     // from PVWatts if available
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toISTDate(value: string): string {
  const d = new Date(value.length === 10 ? value + 'T00:00:00+05:30' : value);
  return d.toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit', month: 'long', year: 'numeric',
  });
}

function SectionTitle({ children }: { children: string }) {
  return (
    <View style={{ marginTop: 18, marginBottom: 8 }}>
      <Text style={{ fontSize: 11, fontFamily: 'Helvetica-Bold', color: BRAND.green }}>
        {children.toUpperCase()}
      </Text>
      <View style={{ height: 1, backgroundColor: BRAND.green, marginTop: 3 }} />
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', marginBottom: 4 }}>
      <Text style={{ fontSize: 9, color: BRAND.gray500, width: 130 }}>{label}</Text>
      <Text style={{ fontSize: 9, color: BRAND.gray700, flex: 1 }}>{value}</Text>
    </View>
  );
}

function BulletRow({ text, checked }: { text: string; checked?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 4 }}>
      <Text style={{ fontSize: 9, color: checked ? BRAND.green : BRAND.gray700, width: 14 }}>
        {checked ? '✓' : '•'}
      </Text>
      <Text style={{ fontSize: 9, color: BRAND.gray700, flex: 1, lineHeight: 1.5 }}>{text}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

function CoverPage({ data }: { data: HandoverPdfData }) {
  return (
    <Page size="A4" style={{ fontFamily: 'Helvetica', padding: 0 }}>
      {/* Green stripe */}
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 17, backgroundColor: BRAND.green }} />

      <View style={{ flex: 1, paddingTop: 60, paddingHorizontal: 60, paddingBottom: 80 }}>
        {/* Logotype */}
        <Text style={{ fontSize: 34, fontFamily: 'Helvetica-Bold', color: BRAND.green, marginBottom: 2 }}>
          SHIROI
        </Text>
        <Text style={{ fontSize: 11, color: BRAND.gray500, letterSpacing: 3, marginBottom: 50 }}>
          ENERGY LLP
        </Text>

        {/* Title */}
        <Text style={{ fontSize: 20, fontFamily: 'Helvetica-Bold', color: BRAND.black, textAlign: 'center', marginBottom: 6 }}>
          Handover &amp; Commissioning Certificate
        </Text>
        <Text style={{ fontSize: 11, color: BRAND.gray500, textAlign: 'center', marginBottom: 40 }}>
          Rooftop Solar PV System
        </Text>

        {/* Client block */}
        <View style={{ backgroundColor: BRAND.gray50, borderRadius: 6, padding: 20, marginBottom: 30 }}>
          <Text style={{ fontSize: 9, color: BRAND.gray500, letterSpacing: 2, marginBottom: 6 }}>
            PREPARED FOR
          </Text>
          <Text style={{ fontSize: 16, fontFamily: 'Helvetica-Bold', color: BRAND.black, marginBottom: 4 }}>
            {data.customerName}
          </Text>
          <Text style={{ fontSize: 10, color: BRAND.gray700, lineHeight: 1.5 }}>
            {data.siteAddress}
          </Text>
        </View>

        {/* Project reference */}
        <View style={{ flexDirection: 'row', gap: 24 }}>
          <View>
            <Text style={{ fontSize: 8, color: BRAND.gray500 }}>PROJECT NUMBER</Text>
            <Text style={{ fontSize: 13, fontFamily: 'Helvetica-Bold', color: BRAND.black }}>
              {data.projectNumber}
            </Text>
          </View>
          <View>
            <Text style={{ fontSize: 8, color: BRAND.gray500 }}>SYSTEM SIZE</Text>
            <Text style={{ fontSize: 13, fontFamily: 'Helvetica-Bold', color: BRAND.black }}>
              {data.systemSizeKwp} kWp
            </Text>
          </View>
          <View>
            <Text style={{ fontSize: 8, color: BRAND.gray500 }}>COMMISSIONED</Text>
            <Text style={{ fontSize: 13, fontFamily: 'Helvetica-Bold', color: BRAND.black }}>
              {toISTDate(data.commissionedDate)}
            </Text>
          </View>
        </View>
      </View>

      {/* Footer */}
      <View style={styles.footer}>
        <Text>{SHIROI_CONTACT.company}</Text>
        <Text>{SHIROI_CONTACT.phone}</Text>
        <Text>{SHIROI_CONTACT.email}</Text>
      </View>
    </Page>
  );
}

function SystemPage({ data }: { data: HandoverPdfData }) {
  const annualKwh = data.annualGenerationKwh ?? Math.round(data.systemSizeKwp * CHENNAI_YIELD_KWH_PER_KWP);
  const annualSavings = Math.round(annualKwh * ELECTRICITY_RATE_PER_UNIT);
  const monthlyKwh = Math.round(annualKwh / 12);

  return (
    <Page size="A4" style={styles.page}>
      {/* Brand bar */}
      <View style={styles.brandBar} />

      <SectionTitle>System Summary</SectionTitle>
      <InfoRow label="System Capacity"    value={`${data.systemSizeKwp} kWp (${data.systemType.replace(/_/g, ' ')})`} />
      <InfoRow label="Panel Brand"        value={data.panelBrand ?? '—'} />
      <InfoRow label="Panel Model"        value={data.panelModel ?? '—'} />
      <InfoRow label="Panel Count"        value={data.panelCount ? `${data.panelCount} modules (${data.panelWattage ?? '—'} Wp each)` : '—'} />
      <InfoRow label="Inverter Brand"     value={data.inverterBrand ?? '—'} />
      <InfoRow label="Inverter Model"     value={data.inverterModel ?? '—'} />
      <InfoRow label="Mounting Structure" value={data.structureType ? data.structureType.replace(/_/g, ' ') : '—'} />
      <InfoRow label="Installation Site"  value={data.siteAddress} />

      <SectionTitle>Performance Estimate</SectionTitle>
      <View style={{ flexDirection: 'row', gap: 12, marginBottom: 12 }}>
        {[
          { label: 'Annual Generation', value: `${annualKwh.toLocaleString('en-IN')} kWh` },
          { label: 'Monthly Average',   value: `${monthlyKwh.toLocaleString('en-IN')} kWh` },
          { label: 'Annual Savings',    value: `₹${annualSavings.toLocaleString('en-IN')}` },
        ].map((kpi) => (
          <View key={kpi.label} style={{ ...styles.kpiCard, width: '31%' }}>
            <Text style={styles.kpiValue}>{kpi.value}</Text>
            <Text style={styles.kpiLabel}>{kpi.label}</Text>
          </View>
        ))}
      </View>
      <Text style={{ fontSize: 8, color: BRAND.gray500 }}>
        {data.annualGenerationKwh
          ? 'Generation figure sourced from PVWatts simulation for this project.'
          : `Estimate based on Chennai average yield of ${CHENNAI_YIELD_KWH_PER_KWP} kWh/kWp/year. Actual generation varies with local shading and weather.`}
        {` Savings calculated at ₹${ELECTRICITY_RATE_PER_UNIT}/unit (generic TN residential rate).`}
      </Text>

      <SectionTitle>Warranty Summary</SectionTitle>
      <View style={{ ...styles.table }}>
        <View style={styles.tableHeader}>
          <Text style={{ ...styles.tableCellBold, width: '55%' }}>Item</Text>
          <Text style={{ ...styles.tableCellBold, flex: 1 }}>Term</Text>
        </View>
        {WARRANTY_TERMS.map((w) => (
          <View key={w.item} style={styles.tableRow}>
            <Text style={{ ...styles.tableCell, width: '55%' }}>{w.item}</Text>
            <Text style={{ ...styles.tableCell, flex: 1 }}>{w.term}</Text>
          </View>
        ))}
      </View>

      {/* Footer */}
      <View style={styles.footer}>
        <Text>{data.projectNumber} — Handover Pack</Text>
        <Text>Page 2</Text>
      </View>
    </Page>
  );
}

function InstructionsPage({ data }: { data: HandoverPdfData }) {
  return (
    <Page size="A4" style={styles.page}>
      <View style={styles.brandBar} />

      <SectionTitle>O&amp;M Instructions</SectionTitle>
      <Text style={{ fontSize: 9, color: BRAND.gray500, marginBottom: 8 }}>
        Following these guidelines will keep your system performing optimally and preserve your warranties.
      </Text>
      {OM_INSTRUCTIONS.map((instruction, i) => (
        <BulletRow key={i} text={instruction} />
      ))}

      <SectionTitle>Emergency Contacts</SectionTitle>
      <InfoRow label="Company"       value={SHIROI_CONTACT.company} />
      <InfoRow label="Office Phone"  value={SHIROI_CONTACT.phone} />
      <InfoRow label="WhatsApp"      value={SHIROI_CONTACT.whatsapp} />
      <InfoRow label="Support Email" value={SHIROI_CONTACT.email} />
      <InfoRow label="Service Hours" value="Monday – Saturday, 9:00 AM – 6:00 PM IST" />

      <SectionTitle>Documents Checklist</SectionTitle>
      <Text style={{ fontSize: 9, color: BRAND.gray500, marginBottom: 8 }}>
        Please confirm the following documents have been received:
      </Text>
      {DOCUMENTS_CHECKLIST.map((item, i) => (
        <BulletRow key={i} text={item} />
      ))}

      <SectionTitle>Signature Block</SectionTitle>
      <View style={{ flexDirection: 'row', marginTop: 10, gap: 30 }}>
        {/* Customer signature */}
        <View style={{ flex: 1 }}>
          <View style={{ height: 40, borderBottomWidth: 1, borderBottomColor: BRAND.gray300 }} />
          <Text style={{ fontSize: 9, color: BRAND.gray700, marginTop: 4 }}>Customer Name &amp; Signature</Text>
          <Text style={{ fontSize: 8, color: BRAND.gray500, marginTop: 2 }}>{data.customerName}</Text>
        </View>
        {/* Shiroi representative */}
        <View style={{ flex: 1 }}>
          <View style={{ height: 40, borderBottomWidth: 1, borderBottomColor: BRAND.gray300 }} />
          <Text style={{ fontSize: 9, color: BRAND.gray700, marginTop: 4 }}>Shiroi Representative</Text>
          <Text style={{ fontSize: 8, color: BRAND.gray500, marginTop: 2 }}>{data.projectManagerName ?? 'Shiroi Energy LLP'}</Text>
        </View>
        {/* Date */}
        <View style={{ flex: 1 }}>
          <View style={{ height: 40, borderBottomWidth: 1, borderBottomColor: BRAND.gray300 }} />
          <Text style={{ fontSize: 9, color: BRAND.gray700, marginTop: 4 }}>Date</Text>
          <Text style={{ fontSize: 8, color: BRAND.gray500, marginTop: 2 }}>{toISTDate(data.commissionedDate)}</Text>
        </View>
      </View>

      <View style={{ marginTop: 24, backgroundColor: BRAND.gray50, borderRadius: 4, padding: 10 }}>
        <Text style={{ fontSize: 8, color: BRAND.gray500, lineHeight: 1.5 }}>
          This document certifies that the above solar PV system has been commissioned and handed over in good working condition.
          Shiroi Energy LLP warrants the workmanship for 1 year from the date above.
          Manufacturer warranties for panels and inverter are subject to their respective terms and conditions.
        </Text>
      </View>

      {/* Footer */}
      <View style={styles.footer}>
        <Text>{data.projectNumber} — Handover Pack</Text>
        <Text>Page 3</Text>
      </View>
    </Page>
  );
}

// ---------------------------------------------------------------------------
// Main document
// ---------------------------------------------------------------------------

export function HandoverPackPdf({ data }: { data: HandoverPdfData }) {
  return (
    <Document
      title={`Handover Pack — ${data.projectNumber}`}
      author={SHIROI_CONTACT.company}
      subject="Solar PV System Handover &amp; Commissioning Certificate"
    >
      <CoverPage data={data} />
      <SystemPage data={data} />
      <InstructionsPage data={data} />
    </Document>
  );
}
