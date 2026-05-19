// apps/erp/src/lib/pdf/budgetary-quote-pdf.tsx
// 8-page budgetary Quick Quote — shares AboutShiroi, Warranty, WhyShiroi with DetailedProposalPDF.
// Stays "budgetary" throughout: disclaimer on cover + investment summary footer.
import React from 'react';
import { Document, Page, Text, View } from '@react-pdf/renderer';
import Decimal from 'decimal.js';
import { styles, BRAND } from './pdf-styles';
import { formatINR } from './proposal-pdf-data';
import { SavingsPage } from './savings-page';
import { PageFooter, AboutShiroiPage, WarrantyAndTermsPage, WhyShiroiPage } from './shared-pages';
import type { ProposalPDFData } from './proposal-pdf-data';

const TOTAL_PAGES = 8;

// ─── Helpers ──────────────────────────────────────────────────────────

function toIST(utcTimestamp: string): string {
  return new Date(utcTimestamp).toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function systemTypeLabel(st: string): string {
  return ({ on_grid: 'On Grid', hybrid: 'Hybrid', off_grid: 'Off Grid' } as Record<string, string>)[st] ?? st;
}

function structureLabel(st: string | null): string {
  if (!st) return 'Flush Mount';
  return ({ flush_mount: 'Flush Mount', elevated: 'Elevated', high_rise: 'High Rise' } as Record<string, string>)[st] ?? st;
}

// ═══════════════════════════════════════════════════════════════════════
// PAGE 1 — COVER (budgetary variant)
// ═══════════════════════════════════════════════════════════════════════

function CoverPage({ data }: { data: ProposalPDFData }) {
  return (
    <Page size="A4" style={styles.coverPage}>
      {/* Brand bar */}
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 6, backgroundColor: BRAND.green }} />

      {/* Logotype */}
      <Text style={{ fontSize: 36, fontFamily: 'Helvetica-Bold', color: BRAND.green, marginBottom: 4 }}>
        SHIROI
      </Text>
      <Text style={{ fontSize: 12, color: BRAND.gray500, marginBottom: 50, letterSpacing: 3 }}>
        ENERGY PRIVATE LIMITED
      </Text>

      {/* Title + disclaimer */}
      <Text style={{ fontSize: 22, fontFamily: 'Helvetica-Bold', color: BRAND.black, marginBottom: 6, textAlign: 'center' }}>
        Budgetary Proposal
      </Text>
      <View style={{ backgroundColor: BRAND.gray100, paddingHorizontal: 16, paddingVertical: 6, borderRadius: 4, marginBottom: 10 }}>
        <Text style={{ fontSize: 9, color: BRAND.gray700, textAlign: 'center', fontFamily: 'Helvetica-Oblique' }}>
          Budgetary Estimate — subject to site survey
        </Text>
      </View>
      <Text style={{ fontSize: 14, color: BRAND.gray700, marginBottom: 30, textAlign: 'center' }}>
        {data.systemSizeKwp} kWp {systemTypeLabel(data.systemType)} Rooftop Solar
      </Text>

      {/* Customer card */}
      <View style={{ backgroundColor: BRAND.gray50, padding: 20, borderRadius: 4, width: '80%', marginBottom: 30 }}>
        <Text style={{ fontSize: 10, color: BRAND.gray500, marginBottom: 4 }}>Prepared for</Text>
        <Text style={{ fontSize: 18, fontFamily: 'Helvetica-Bold', color: BRAND.green }}>{data.customerName}</Text>
        {data.customerCity && (
          <Text style={{ fontSize: 11, color: BRAND.gray500, marginTop: 2 }}>{data.customerCity}</Text>
        )}
        {data.customerPhone && (
          <Text style={{ fontSize: 10, color: BRAND.gray500, marginTop: 2 }}>{data.customerPhone}</Text>
        )}
      </View>

      {/* Meta row */}
      <View style={{ flexDirection: 'row', gap: 40, marginBottom: 20 }}>
        <View>
          <Text style={{ fontSize: 8, color: BRAND.gray500 }}>Proposal No.</Text>
          <Text style={{ fontSize: 11, fontFamily: 'Helvetica-Bold' }}>{data.proposalNumber}</Text>
        </View>
        <View>
          <Text style={{ fontSize: 8, color: BRAND.gray500 }}>Date</Text>
          <Text style={{ fontSize: 11 }}>{toIST(data.createdAt)}</Text>
        </View>
        <View>
          <Text style={{ fontSize: 8, color: BRAND.gray500 }}>Valid Until</Text>
          <Text style={{ fontSize: 11 }}>{data.validUntil}</Text>
        </View>
      </View>

      {/* Bottom bar */}
      <View style={{ position: 'absolute', bottom: 30, left: 50, right: 50, borderTopWidth: 1, borderTopColor: BRAND.gray300, paddingTop: 8 }}>
        <Text style={{ fontSize: 8, color: BRAND.gray500, textAlign: 'center' }}>
          Shiroi Energy LLP | Chennai, Tamil Nadu | www.shiroienergy.com
        </Text>
      </View>
    </Page>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// PAGE 3 — SYSTEM OVERVIEW
// ═══════════════════════════════════════════════════════════════════════

function SystemOverviewPage({ data }: { data: ProposalPDFData }) {
  // Expected generation: use simulation if available, else indicative CUF stand-in
  const hasSimulation = !!data.simulation;
  const annualKwh = data.simulation
    ? data.simulation.annualKwh
    : data.systemSizeKwp * 1500; // indicative: ~1500 kWh/kWp/year (Chennai CUF)

  return (
    <Page size="A4" style={styles.page}>
      <View style={styles.brandBar} />
      <Text style={styles.h1}>System Overview</Text>

      {/* KPI cards */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 12, marginBottom: 16 }}>
        <View style={[styles.kpiCard, { width: '30%' }]}>
          <Text style={styles.kpiValue}>{data.systemSizeKwp} kWp</Text>
          <Text style={styles.kpiLabel}>System Size</Text>
        </View>
        <View style={[styles.kpiCard, { width: '30%' }]}>
          <Text style={[styles.kpiValue, { fontSize: 14 }]}>{systemTypeLabel(data.systemType)}</Text>
          <Text style={styles.kpiLabel}>System Type</Text>
        </View>
        <View style={[styles.kpiCard, { width: '30%' }]}>
          <Text style={[styles.kpiValue, { fontSize: 14 }]}>{structureLabel(data.structureType)}</Text>
          <Text style={styles.kpiLabel}>Structure Type</Text>
        </View>
      </View>

      {/* Expected generation */}
      <View style={{ backgroundColor: BRAND.greenLight, padding: 14, borderRadius: 4, marginBottom: 16 }}>
        <Text style={{ fontSize: 10, color: BRAND.gray500, marginBottom: 4 }}>Expected Annual Generation</Text>
        <Text style={{ fontSize: 22, fontFamily: 'Helvetica-Bold', color: BRAND.green }}>
          {Math.round(annualKwh).toLocaleString()} kWh / year
        </Text>
        {!hasSimulation && (
          <Text style={{ fontSize: 8, color: BRAND.gray500, marginTop: 4, fontFamily: 'Helvetica-Oblique' }}>
            Indicative — actual depends on site survey, shading, and panel orientation.
          </Text>
        )}
      </View>

      {/* Component details */}
      <Text style={styles.h2}>Proposed Components</Text>

      {/* Panels */}
      <View style={{ backgroundColor: BRAND.gray50, padding: 12, borderRadius: 4, marginTop: 8 }}>
        <Text style={{ fontSize: 11, fontFamily: 'Helvetica-Bold', marginBottom: 4 }}>Solar Panels</Text>
        <View style={{ flexDirection: 'row', gap: 20 }}>
          <View>
            <Text style={styles.caption}>Brand & Model</Text>
            <Text style={styles.body}>{data.panelBrand ?? '—'} {data.panelModel ?? ''}</Text>
          </View>
          <View>
            <Text style={styles.caption}>Wattage</Text>
            <Text style={styles.body}>{data.panelWattage ? `${data.panelWattage}Wp` : '—'}</Text>
          </View>
          <View>
            <Text style={styles.caption}>Quantity</Text>
            <Text style={styles.body}>{data.panelCount ? `${data.panelCount} Nos` : '—'}</Text>
          </View>
        </View>
      </View>

      {/* Inverter */}
      <View style={{ backgroundColor: BRAND.gray50, padding: 12, borderRadius: 4, marginTop: 8 }}>
        <Text style={{ fontSize: 11, fontFamily: 'Helvetica-Bold', marginBottom: 4 }}>Inverter</Text>
        <View style={{ flexDirection: 'row', gap: 20 }}>
          <View>
            <Text style={styles.caption}>Brand & Model</Text>
            <Text style={styles.body}>{data.inverterBrand ?? '—'} {data.inverterModel ?? ''}</Text>
          </View>
          <View>
            <Text style={styles.caption}>Capacity</Text>
            <Text style={styles.body}>{data.inverterCapacityKw ? `${data.inverterCapacityKw} kW` : '—'}</Text>
          </View>
          <View>
            <Text style={styles.caption}>Type</Text>
            <Text style={styles.body}>{systemTypeLabel(data.systemType)}</Text>
          </View>
        </View>
      </View>

      {/* Battery (if hybrid/off_grid) */}
      {data.batteryBrand && (
        <View style={{ backgroundColor: BRAND.gray50, padding: 12, borderRadius: 4, marginTop: 8 }}>
          <Text style={{ fontSize: 11, fontFamily: 'Helvetica-Bold', marginBottom: 4 }}>Battery Storage</Text>
          <View style={{ flexDirection: 'row', gap: 20 }}>
            <View>
              <Text style={styles.caption}>Brand & Model</Text>
              <Text style={styles.body}>{data.batteryBrand} {data.batteryModel ?? ''}</Text>
            </View>
            <View>
              <Text style={styles.caption}>Capacity</Text>
              <Text style={styles.body}>{data.batteryCapacityKwh ? `${data.batteryCapacityKwh} kWh` : '—'}</Text>
            </View>
          </View>
        </View>
      )}

      {/* Mounting */}
      <View style={{ backgroundColor: BRAND.gray50, padding: 12, borderRadius: 4, marginTop: 8 }}>
        <Text style={{ fontSize: 11, fontFamily: 'Helvetica-Bold', marginBottom: 4 }}>Mounting Structure</Text>
        <Text style={styles.body}>
          {structureLabel(data.structureType)} — Hot-dip galvanized steel (IS 2062 Grade E250), designed for wind speed up to 150 km/h.
          Corrosion-resistant with 25-year structural warranty.
        </Text>
      </View>

      <PageFooter proposalNumber={data.proposalNumber} pageNum={3} totalPages={TOTAL_PAGES} />
    </Page>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// PAGE 4 — SAVINGS (reuses shared SavingsPage component)
// ═══════════════════════════════════════════════════════════════════════

function SavingsROIPage({ data }: { data: ProposalPDFData }) {
  return (
    <Page size="A4" style={styles.page}>
      <View style={styles.brandBar} />
      <Text style={styles.h1}>Savings & Return on Investment</Text>
      <View style={{ marginTop: 12 }}>
        <SavingsPage data={data} />
      </View>
      <PageFooter proposalNumber={data.proposalNumber} pageNum={4} totalPages={TOTAL_PAGES} />
    </Page>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// PAGE 5 — INVESTMENT SUMMARY (high-level buckets, not line items)
// ═══════════════════════════════════════════════════════════════════════

// Category → display bucket mapping
const CATEGORY_BUCKET: Record<string, string> = {
  panel: 'Solar Panels',
  inverter: 'Inverter',
  battery: 'Inverter', // merge battery into inverter bucket for budgetary simplicity
  structure: 'Balance of System',
  dc_cable: 'Balance of System',
  ac_cable: 'Balance of System',
  conduit: 'Balance of System',
  earthing: 'Balance of System',
  acdb: 'Balance of System',
  dcdb: 'Balance of System',
  installation_labour: 'Installation & Commissioning',
  transport: 'Installation & Commissioning',
  net_meter: 'Liaison / Net Metering',
  civil_work: 'Civil Works',
  other: 'Balance of System',
};

interface BucketRow {
  label: string;
  subtotal: Decimal;
  gst: Decimal;
}

function buildBuckets(bomLines: ProposalPDFData['bomLines']): BucketRow[] {
  const bucketMap = new Map<string, { subtotal: Decimal; gst: Decimal }>();

  for (const line of bomLines) {
    const bucket = CATEGORY_BUCKET[line.category] ?? 'Balance of System';
    const existing = bucketMap.get(bucket) ?? { subtotal: new Decimal(0), gst: new Decimal(0) };
    bucketMap.set(bucket, {
      subtotal: existing.subtotal.plus(new Decimal(line.totalPrice)),
      gst: existing.gst.plus(new Decimal(line.gstAmount)),
    });
  }

  // Preserve display order
  const order = [
    'Solar Panels',
    'Inverter',
    'Balance of System',
    'Installation & Commissioning',
    'Liaison / Net Metering',
    'Civil Works',
  ];

  const rows: BucketRow[] = [];
  for (const label of order) {
    const entry = bucketMap.get(label);
    if (entry && entry.subtotal.gt(0)) {
      rows.push({ label, subtotal: entry.subtotal, gst: entry.gst });
    }
  }
  return rows;
}

function InvestmentSummaryPage({ data }: { data: ProposalPDFData }) {
  const buckets = buildBuckets(data.bomLines);

  const subtotalBeforeGst = buckets.reduce(
    (acc, r) => acc.plus(r.subtotal),
    new Decimal(0)
  );
  const totalGst = buckets.reduce(
    (acc, r) => acc.plus(r.gst),
    new Decimal(0)
  );
  const totalAfterGst = subtotalBeforeGst.plus(totalGst);
  const discount = new Decimal(data.discountAmount);
  const finalTotal = totalAfterGst.minus(discount);

  return (
    <Page size="A4" style={styles.page}>
      <View style={styles.brandBar} />
      <Text style={styles.h1}>Investment Summary</Text>

      <Text style={[styles.body, { marginTop: 8, marginBottom: 12 }]}>
        High-level cost breakdown for the proposed {data.systemSizeKwp} kWp {systemTypeLabel(data.systemType)} system.
        Line-item detail will be provided in the final proposal post site survey.
      </Text>

      {/* Bucket table header */}
      <View style={styles.tableHeader}>
        <Text style={[styles.tableCellBold, { width: '55%' }]}>Category</Text>
        <Text style={[styles.tableCellBold, { width: '20%', textAlign: 'right' }]}>Subtotal (excl. GST)</Text>
        <Text style={[styles.tableCellBold, { width: '25%', textAlign: 'right' }]}>GST</Text>
      </View>

      {buckets.map((row, i) => (
        <View key={i} style={styles.tableRow}>
          <Text style={[styles.tableCell, { width: '55%' }]}>{row.label}</Text>
          <Text style={[styles.tableCellRight, { width: '20%' }]}>{formatINR(row.subtotal.toNumber())}</Text>
          <Text style={[styles.tableCellRight, { width: '25%' }]}>{formatINR(row.gst.toNumber())}</Text>
        </View>
      ))}

      {/* Totals block */}
      <View style={styles.divider} />
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
        <View style={{ width: '50%' }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 }}>
            <Text style={styles.body}>Subtotal (excl. GST)</Text>
            <Text style={styles.body}>{formatINR(subtotalBeforeGst.toNumber())}</Text>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 }}>
            <Text style={styles.body}>GST (5% supply / 18% works)</Text>
            <Text style={styles.body}>{formatINR(totalGst.toNumber())}</Text>
          </View>
          {discount.gt(0) && (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 }}>
              <Text style={[styles.body, { color: BRAND.green }]}>Discount</Text>
              <Text style={[styles.body, { color: BRAND.green }]}>-{formatINR(discount.toNumber())}</Text>
            </View>
          )}
          <View style={{ borderTopWidth: 2, borderTopColor: BRAND.black, paddingTop: 4, marginTop: 4 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 13, fontFamily: 'Helvetica-Bold' }}>Total Budgetary Estimate</Text>
              <Text style={{ fontSize: 13, fontFamily: 'Helvetica-Bold', color: BRAND.green }}>
                {formatINR(finalTotal.toNumber())}
              </Text>
            </View>
          </View>
        </View>
      </View>

      {/* Disclaimer footer */}
      <View style={{ backgroundColor: BRAND.gray100, padding: 10, borderRadius: 4, marginTop: 20 }}>
        <Text style={{ fontSize: 8, color: BRAND.gray700, fontFamily: 'Helvetica-Oblique' }}>
          Final pricing confirmed post site survey and BOM finalisation. Prices are indicative and subject to change
          based on actual site conditions, material availability, and applicable tax rates at the time of order.
        </Text>
      </View>

      <PageFooter proposalNumber={data.proposalNumber} pageNum={5} totalPages={TOTAL_PAGES} />
    </Page>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// PAGE 6 — PAYMENT SCHEDULE STUB (standard tranches, no dates)
// ═══════════════════════════════════════════════════════════════════════

const STANDARD_TRANCHES = [
  { order: 1, name: 'Advance', percentage: 30, trigger: 'Order Confirmation' },
  { order: 2, name: 'Material Dispatch', percentage: 40, trigger: 'Material Dispatch' },
  { order: 3, name: 'Installation', percentage: 20, trigger: 'Installation Complete' },
  { order: 4, name: 'Commissioning', percentage: 10, trigger: 'Commissioning & Handover' },
];

function PaymentScheduleStubPage({ data }: { data: ProposalPDFData }) {
  const total = new Decimal(data.totalAfterDiscount);

  return (
    <Page size="A4" style={styles.page}>
      <View style={styles.brandBar} />
      <Text style={styles.h1}>Payment Schedule</Text>

      <Text style={[styles.body, { marginTop: 8, marginBottom: 12 }]}>
        Payment is structured around project milestones. Exact due dates will be confirmed in the final
        proposal after site survey and order confirmation.
      </Text>

      {/* Milestone progress bar */}
      <View style={{ flexDirection: 'row', height: 8, marginBottom: 16, borderRadius: 4, overflow: 'hidden' }}>
        {STANDARD_TRANCHES.map((t, i) => (
          <View key={i} style={{
            width: `${t.percentage}%`,
            backgroundColor: i === 0 ? BRAND.green : i === 1 ? BRAND.greenDark : i === 2 ? '#047857' : '#065f46',
            height: 8,
          }} />
        ))}
      </View>

      {/* Table */}
      <View style={styles.tableHeader}>
        <Text style={[styles.tableCellBold, { width: '5%' }]}>#</Text>
        <Text style={[styles.tableCellBold, { width: '30%' }]}>Milestone</Text>
        <Text style={[styles.tableCellBold, { width: '15%', textAlign: 'right' }]}>%</Text>
        <Text style={[styles.tableCellBold, { width: '25%', textAlign: 'right' }]}>Indicative Amount</Text>
        <Text style={[styles.tableCellBold, { width: '25%' }]}>Due</Text>
      </View>
      {STANDARD_TRANCHES.map(t => {
        const amount = total.mul(t.percentage).div(100);
        return (
          <View key={t.order} style={styles.tableRow}>
            <Text style={[styles.tableCell, { width: '5%' }]}>{t.order}</Text>
            <Text style={[styles.tableCell, { width: '30%' }]}>{t.name}</Text>
            <Text style={[styles.tableCellRight, { width: '15%' }]}>{t.percentage}%</Text>
            <Text style={[styles.tableCellRight, { width: '25%', fontFamily: 'Helvetica-Bold' }]}>
              {formatINR(amount.toDecimalPlaces(0).toNumber())}
            </Text>
            <Text style={[styles.tableCell, { width: '25%' }]}>{t.trigger}</Text>
          </View>
        );
      })}

      {/* Total row */}
      <View style={[styles.tableRow, { backgroundColor: BRAND.gray100 }]}>
        <Text style={[styles.tableCellBold, { width: '5%' }]} />
        <Text style={[styles.tableCellBold, { width: '30%' }]}>Total</Text>
        <Text style={[styles.tableCellBold, { width: '15%', textAlign: 'right' }]}>100%</Text>
        <Text style={[styles.tableCellBold, { width: '25%', textAlign: 'right', color: BRAND.green }]}>
          {formatINR(total.toNumber())}
        </Text>
        <Text style={[styles.tableCell, { width: '25%' }]} />
      </View>

      <Text style={[styles.body, { marginTop: 16 }]}>
        All payments to be made via bank transfer (NEFT/RTGS/UPI) to Shiroi Energy LLP.
        Proforma invoices will be raised at each milestone. GST invoices will be issued upon receipt of payment.
      </Text>

      <PageFooter proposalNumber={data.proposalNumber} pageNum={6} totalPages={TOTAL_PAGES} />
    </Page>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// MAIN DOCUMENT — 8 pages
// ═══════════════════════════════════════════════════════════════════════

export function BudgetaryQuotePDF({ data }: { data: ProposalPDFData }) {
  return (
    <Document
      title={`Budgetary Proposal — ${data.customerName} — ${data.systemSizeKwp}kWp`}
      author="Shiroi Energy LLP"
      subject={`Proposal ${data.proposalNumber}`}
    >
      {/* Page 1: Cover */}
      <CoverPage data={data} />
      {/* Page 2: About Shiroi */}
      <AboutShiroiPage data={data} pageNum={2} totalPages={TOTAL_PAGES} />
      {/* Page 3: System Overview */}
      <SystemOverviewPage data={data} />
      {/* Page 4: Savings & ROI */}
      <SavingsROIPage data={data} />
      {/* Page 5: Investment Summary */}
      <InvestmentSummaryPage data={data} />
      {/* Page 6: Payment Schedule Stub */}
      <PaymentScheduleStubPage data={data} />
      {/* Page 7: Warranty & After-Sales */}
      <WarrantyAndTermsPage data={data} pageNum={7} totalPages={TOTAL_PAGES} />
      {/* Page 8: Why Shiroi / Recent Projects */}
      <WhyShiroiPage data={data} pageNum={8} totalPages={TOTAL_PAGES} />
    </Document>
  );
}
