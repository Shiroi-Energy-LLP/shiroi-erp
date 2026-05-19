// apps/erp/src/lib/pdf/shared-pages.tsx
// Shared page components used by BOTH BudgetaryQuotePDF and DetailedProposalPDF.
// Pull these from here — do NOT duplicate in either PDF file.
import React from 'react';
import { Page, Text, View } from '@react-pdf/renderer';
import { styles, BRAND } from './pdf-styles';
import type { ProposalPDFData } from './proposal-pdf-data';

// ─── Page Footer (shared) ─────────────────────────────────────────────

export function PageFooter({
  proposalNumber,
  pageNum,
  totalPages,
}: {
  proposalNumber: string;
  pageNum: number;
  totalPages: number;
}) {
  return (
    <View style={styles.footer}>
      <Text>{proposalNumber}</Text>
      <Text>Shiroi Energy LLP</Text>
      <Text>Page {pageNum} of {totalPages}</Text>
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// ABOUT SHIROI PAGE
// ═══════════════════════════════════════════════════════════════════════

export function AboutShiroiPage({
  data,
  pageNum,
  totalPages,
}: {
  data: ProposalPDFData;
  pageNum: number;
  totalPages: number;
}) {
  return (
    <Page size="A4" style={styles.page}>
      <View style={styles.brandBar} />
      <Text style={styles.h1}>About Shiroi Energy</Text>

      <Text style={[styles.body, { marginTop: 12 }]}>
        Shiroi Energy LLP is a Chennai-based solar EPC company specializing in the design, engineering,
        procurement, and installation of rooftop solar power systems. Since our founding, we have completed over
        500 solar installations across Tamil Nadu, serving residential, commercial, and industrial customers.
      </Text>

      <Text style={[styles.body, { marginTop: 8 }]}>
        Our team of experienced engineers and project managers ensures every installation meets the highest standards
        of quality, safety, and performance. We handle the complete project lifecycle — from initial site survey and
        system design through procurement, installation, commissioning, and post-installation support.
      </Text>

      <Text style={[styles.h3, { marginTop: 16 }]}>Why Shiroi?</Text>
      <View style={{ marginTop: 8 }}>
        {[
          { title: '500+ Installations', desc: 'Proven track record across residential, commercial, and industrial segments in Tamil Nadu.' },
          { title: 'End-to-End Service', desc: 'Design, procurement, installation, TNEB liaison, commissioning, and O&M — all under one roof.' },
          { title: 'Quality First', desc: 'Tier-1 panels and inverters only. Every installation uses hot-dip galvanized structures and UV-resistant cabling.' },
          { title: 'TNEB Liaison Expertise', desc: 'Complete net metering support including CEIG clearance, meter installation, and TNEB approvals.' },
          { title: 'Transparent Pricing', desc: 'Detailed category-wise pricing with no hidden charges. Pay as milestones are completed.' },
          { title: 'After-Sales Support', desc: 'Dedicated O&M team with Annual Maintenance Contracts. Remote monitoring via Sungrow/Growatt portals.' },
        ].map((item, i) => (
          <View key={i} style={{ flexDirection: 'row', marginBottom: 6 }}>
            <Text style={{ fontSize: 10, color: BRAND.green, marginRight: 6 }}>●</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 10, fontFamily: 'Helvetica-Bold' }}>{item.title}</Text>
              <Text style={[styles.body, { fontSize: 9 }]}>{item.desc}</Text>
            </View>
          </View>
        ))}
      </View>

      <Text style={[styles.h3, { marginTop: 16 }]}>Certifications & Registrations</Text>
      <Text style={[styles.body, { marginTop: 4 }]}>
        MSME Registered | TEDA Empanelled | MNRE Channel Partner | Licensed Electrical Contractor (Tamil Nadu)
      </Text>

      <PageFooter proposalNumber={data.proposalNumber} pageNum={pageNum} totalPages={totalPages} />
    </Page>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// WARRANTY & AFTER-SALES PAGE
// ═══════════════════════════════════════════════════════════════════════

export function WarrantyAndTermsPage({
  data,
  pageNum,
  totalPages,
}: {
  data: ProposalPDFData;
  pageNum: number;
  totalPages: number;
}) {
  return (
    <Page size="A4" style={styles.page}>
      <View style={styles.brandBar} />
      <Text style={styles.h1}>Warranty & After-Sales Support</Text>

      {/* Warranty table */}
      <Text style={[styles.h2, { marginTop: 12 }]}>Product Warranties</Text>
      <View style={styles.tableHeader}>
        <Text style={[styles.tableCellBold, { width: '30%' }]}>Component</Text>
        <Text style={[styles.tableCellBold, { width: '25%' }]}>Product Warranty</Text>
        <Text style={[styles.tableCellBold, { width: '25%' }]}>Performance Warranty</Text>
        <Text style={[styles.tableCellBold, { width: '20%' }]}>Manufacturer</Text>
      </View>
      {[
        { comp: 'Solar Panels', product: '12 years', performance: '25 years (≥80% output)', mfr: data.panelBrand ?? '—' },
        { comp: 'Inverter', product: '5 years (extendable to 10)', performance: '—', mfr: data.inverterBrand ?? '—' },
        { comp: 'Battery', product: '10 years', performance: '70% capacity at 6000 cycles', mfr: data.batteryBrand ?? 'N/A' },
        { comp: 'Mounting Structure', product: '10 years', performance: '25-year structural integrity', mfr: 'Shiroi' },
        { comp: 'Cabling & Accessories', product: '5 years', performance: '—', mfr: 'Polycab / Havells' },
      ].map((row, i) => (
        <View key={i} style={styles.tableRow}>
          <Text style={[styles.tableCell, { width: '30%' }]}>{row.comp}</Text>
          <Text style={[styles.tableCell, { width: '25%' }]}>{row.product}</Text>
          <Text style={[styles.tableCell, { width: '25%' }]}>{row.performance}</Text>
          <Text style={[styles.tableCell, { width: '20%' }]}>{row.mfr}</Text>
        </View>
      ))}

      {/* Workmanship warranty */}
      <Text style={[styles.h2, { marginTop: 16 }]}>Shiroi Workmanship Warranty</Text>
      <Text style={[styles.body, { marginTop: 4 }]}>
        Shiroi Energy provides a 5-year workmanship warranty covering installation defects, wiring issues,
        and structural mounting. This is in addition to the manufacturer warranties listed above.
      </Text>

      {/* AMC */}
      <Text style={[styles.h2, { marginTop: 16 }]}>Annual Maintenance Contract (AMC)</Text>
      <Text style={[styles.body, { marginTop: 4 }]}>
        We offer comprehensive AMC plans starting from the 2nd year onwards:
      </Text>
      <View style={{ marginTop: 8 }}>
        {[
          { plan: 'Basic AMC', desc: '2 visits/year: visual inspection, cleaning, generation check, tightening.' },
          { plan: 'Comprehensive AMC', desc: '4 visits/year: all Basic services + thermal imaging, I-V curve testing, inverter diagnostics.' },
          { plan: 'Premium AMC', desc: 'All Comprehensive services + remote monitoring setup, priority response (4-hour SLA), annual panel deep-clean.' },
        ].map((item, i) => (
          <View key={i} style={{ flexDirection: 'row', marginBottom: 6 }}>
            <Text style={{ fontSize: 10, color: BRAND.green, marginRight: 6 }}>●</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 10, fontFamily: 'Helvetica-Bold' }}>{item.plan}</Text>
              <Text style={[styles.body, { fontSize: 9 }]}>{item.desc}</Text>
            </View>
          </View>
        ))}
      </View>

      <PageFooter proposalNumber={data.proposalNumber} pageNum={pageNum} totalPages={totalPages} />
    </Page>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// WHY SHIROI / RECENT PROJECTS PAGE
// ═══════════════════════════════════════════════════════════════════════

export function WhyShiroiPage({
  data,
  pageNum,
  totalPages,
}: {
  data: ProposalPDFData;
  pageNum: number;
  totalPages: number;
}) {
  const references = [
    { name: 'Residential — 10 kWp On Grid', location: 'ECR, Chennai', size: '10 kWp', year: '2025', desc: 'Flush mount on RCC terrace. Sungrow 10kW inverter. Commissioned in 3 weeks.' },
    { name: 'Commercial — 50 kWp On Grid', location: 'Ambattur Industrial Estate', size: '50 kWp', year: '2025', desc: 'Elevated structure on factory shed. 2x Sungrow 25kW inverters. Net metering approved.' },
    { name: 'Residential — 5 kWp Hybrid', location: 'Adyar, Chennai', size: '5 kWp + 10kWh', year: '2025', desc: 'Hybrid system with Sungrow battery. Full backup for essential loads during outages.' },
    { name: 'Industrial — 100 kWp On Grid', location: 'Sriperumbudur', size: '100 kWp', year: '2024', desc: 'Multi-roof installation across 3 buildings. 4x Sungrow 25kW inverters. ₹8L+ annual savings.' },
    { name: 'Residential — 3 kWp On Grid', location: 'T.Nagar, Chennai', size: '3 kWp', year: '2025', desc: 'Compact flush mount installation. Growatt inverter. TNEB net metering active.' },
    { name: 'Commercial — 25 kWp On Grid', location: 'OMR, Chennai', size: '25 kWp', year: '2024', desc: 'Office building rooftop. Sungrow 25kW inverter. ROI achieved in 3.5 years.' },
  ];

  return (
    <Page size="A4" style={styles.page}>
      <View style={styles.brandBar} />
      <Text style={styles.h1}>Our Recent Projects</Text>
      <Text style={[styles.body, { marginTop: 4, marginBottom: 12 }]}>
        A selection of our recently completed installations across Tamil Nadu.
      </Text>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        {references.map((ref, i) => (
          <View key={i} style={{ width: '47%', backgroundColor: BRAND.gray50, padding: 12, borderRadius: 4, borderLeftWidth: 3, borderLeftColor: BRAND.green }}>
            <Text style={{ fontSize: 10, fontFamily: 'Helvetica-Bold', marginBottom: 2 }}>{ref.name}</Text>
            <Text style={{ fontSize: 8, color: BRAND.gray500, marginBottom: 4 }}>{ref.location} | {ref.size} | {ref.year}</Text>
            <Text style={{ fontSize: 8, color: BRAND.gray700, lineHeight: 1.3 }}>{ref.desc}</Text>
          </View>
        ))}
      </View>

      {/* CTA */}
      <View style={{ marginTop: 24, backgroundColor: BRAND.greenLight, padding: 16, borderRadius: 4, textAlign: 'center' }}>
        <Text style={{ fontSize: 14, fontFamily: 'Helvetica-Bold', color: BRAND.greenDark }}>
          Ready to go solar?
        </Text>
        <Text style={{ fontSize: 10, color: BRAND.gray700, marginTop: 4 }}>
          Contact us to schedule your free site survey and get started.
        </Text>
        <Text style={{ fontSize: 11, fontFamily: 'Helvetica-Bold', color: BRAND.green, marginTop: 8 }}>
          www.shiroienergy.com
        </Text>
      </View>

      <PageFooter proposalNumber={data.proposalNumber} pageNum={pageNum} totalPages={totalPages} />
    </Page>
  );
}
