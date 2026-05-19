// apps/erp/src/lib/pdf/detailed-proposal-pdf.tsx
// 10-page branded proposal: Cover, About, System, Savings, BOM, Scope, Payment, Warranty, T&C, References
import React from 'react';
import { Document, Page, Text, View } from '@react-pdf/renderer';
import { styles, BRAND } from './pdf-styles';
import { formatINR } from './proposal-pdf-data';
import { SavingsPage } from './savings-page';
import { PageFooter, AboutShiroiPage, WarrantyAndTermsPage, WhyShiroiPage } from './shared-pages';
import type { ProposalPDFData } from './proposal-pdf-data';

function toIST(utcTimestamp: string): string {
  return new Date(utcTimestamp).toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function systemTypeLabel(st: string): string {
  return { on_grid: 'On Grid', hybrid: 'Hybrid', off_grid: 'Off Grid' }[st] ?? st;
}

function structureLabel(st: string | null): string {
  if (!st) return 'Flush Mount';
  return { flush_mount: 'Flush Mount', elevated: 'Elevated', high_rise: 'High Rise' }[st] ?? st;
}

function triggerLabel(trigger: string): string {
  return trigger.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function categoryLabel(cat: string): string {
  const map: Record<string, string> = {
    panel: 'Solar Panels', inverter: 'Inverter', battery: 'Battery Storage',
    structure: 'Mounting Structure', dc_cable: 'DC Cabling', ac_cable: 'AC Cabling',
    conduit: 'Conduit & Tray', earthing: 'Earthing & LA', acdb: 'ACDB',
    dcdb: 'DCDB', net_meter: 'Net Metering & Liaison', civil_work: 'Civil Works',
    installation_labour: 'Installation Labour', transport: 'Transport', other: 'Other',
  };
  return map[cat] ?? cat;
}

// ═══════════════════════════════════════════════════════════════════════
// PAGE 1 — COVER
// ═══════════════════════════════════════════════════════════════════════

function CoverPage({ data }: { data: ProposalPDFData }) {
  return (
    <Page size="A4" style={styles.coverPage}>
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 6, backgroundColor: BRAND.green }} />

      <Text style={{ fontSize: 36, fontFamily: 'Helvetica-Bold', color: BRAND.green, marginBottom: 4 }}>
        SHIROI
      </Text>
      <Text style={{ fontSize: 12, color: BRAND.gray500, marginBottom: 50, letterSpacing: 3 }}>
        ENERGY PRIVATE LIMITED
      </Text>

      <Text style={{ fontSize: 22, fontFamily: 'Helvetica-Bold', color: BRAND.black, marginBottom: 8, textAlign: 'center' }}>
        Solar System Proposal
      </Text>
      <Text style={{ fontSize: 16, color: BRAND.gray700, marginBottom: 30, textAlign: 'center' }}>
        {data.systemSizeKwp} kWp {systemTypeLabel(data.systemType)} Rooftop Solar
      </Text>

      <View style={{ backgroundColor: BRAND.gray50, padding: 20, borderRadius: 4, width: '80%', marginBottom: 30 }}>
        <Text style={{ fontSize: 10, color: BRAND.gray500, marginBottom: 4 }}>Prepared for</Text>
        <Text style={{ fontSize: 18, fontFamily: 'Helvetica-Bold', color: BRAND.green }}>{data.customerName}</Text>
        {data.customerCity && <Text style={{ fontSize: 11, color: BRAND.gray500, marginTop: 2 }}>{data.customerCity}</Text>}
        {data.customerPhone && <Text style={{ fontSize: 10, color: BRAND.gray500, marginTop: 2 }}>{data.customerPhone}</Text>}
      </View>

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

      <View style={{ position: 'absolute', bottom: 30, left: 50, right: 50, borderTopWidth: 1, borderTopColor: BRAND.gray300, paddingTop: 8 }}>
        <Text style={{ fontSize: 8, color: BRAND.gray500, textAlign: 'center' }}>
          Shiroi Energy LLP | Chennai, Tamil Nadu | www.shiroienergy.com
        </Text>
      </View>
    </Page>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// PAGE 2 — ABOUT SHIROI  (rendered via shared AboutShiroiPage)

// ═══════════════════════════════════════════════════════════════════════
// PAGE 3 — SYSTEM DESIGN
// ═══════════════════════════════════════════════════════════════════════

function SystemDesignPage({ data }: { data: ProposalPDFData }) {
  return (
    <Page size="A4" style={styles.page}>
      <View style={styles.brandBar} />
      <Text style={styles.h1}>System Design</Text>

      {/* System overview cards */}
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

      {/* Component details */}
      <Text style={styles.h2}>Components</Text>

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
            <Text style={styles.body}>{data.panelWattage ?? '—'}Wp</Text>
          </View>
          <View>
            <Text style={styles.caption}>Quantity</Text>
            <Text style={styles.body}>{data.panelCount ?? '—'} Nos</Text>
          </View>
          <View>
            <Text style={styles.caption}>Total Capacity</Text>
            <Text style={styles.body}>{data.panelWattage && data.panelCount ? ((data.panelWattage * data.panelCount) / 1000).toFixed(2) : '—'} kWp</Text>
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
            <Text style={styles.body}>{data.inverterCapacityKw ?? '—'} kW</Text>
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
              <Text style={styles.body}>{data.batteryCapacityKwh ?? '—'} kWh</Text>
            </View>
          </View>
        </View>
      )}

      {/* Structure details */}
      <View style={{ backgroundColor: BRAND.gray50, padding: 12, borderRadius: 4, marginTop: 8 }}>
        <Text style={{ fontSize: 11, fontFamily: 'Helvetica-Bold', marginBottom: 4 }}>Mounting Structure</Text>
        <Text style={styles.body}>
          {structureLabel(data.structureType)} — Hot-dip galvanized steel (IS 2062 Grade E250), designed for wind speed up to 150 km/h.
          Corrosion-resistant with 25-year structural warranty.
        </Text>
      </View>

      {/* Layout placeholder */}
      <View style={{ marginTop: 16, padding: 30, borderWidth: 1, borderColor: BRAND.gray300, borderRadius: 4, borderStyle: 'dashed', textAlign: 'center' }}>
        <Text style={{ fontSize: 10, color: BRAND.gray500 }}>System layout drawing will be provided after site survey</Text>
      </View>

      <PageFooter proposalNumber={data.proposalNumber} pageNum={3} totalPages={10} />
    </Page>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// PAGE 4 — SAVINGS & ROI (segment-adaptive)
// ═══════════════════════════════════════════════════════════════════════

function SavingsROIPage({ data }: { data: ProposalPDFData }) {
  return (
    <Page size="A4" style={styles.page}>
      <View style={styles.brandBar} />
      <Text style={styles.h1}>Savings & Return on Investment</Text>
      <View style={{ marginTop: 12 }}>
        <SavingsPage data={data} />
      </View>
      <PageFooter proposalNumber={data.proposalNumber} pageNum={4} totalPages={10} />
    </Page>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// PAGE 5 — BILL OF MATERIALS
// ═══════════════════════════════════════════════════════════════════════

function BOMPage({ data }: { data: ProposalPDFData }) {
  const supplyLines = data.bomLines.filter(l => l.gstType === 'supply');
  const worksLines = data.bomLines.filter(l => l.gstType === 'works_contract');

  return (
    <Page size="A4" style={styles.page}>
      <View style={styles.brandBar} />
      <Text style={styles.h1}>Bill of Materials</Text>

      {/* Table header */}
      <View style={[styles.tableHeader, { marginTop: 8 }]}>
        <Text style={[styles.tableCellBold, { width: '4%' }]}>#</Text>
        <Text style={[styles.tableCellBold, { width: '30%' }]}>Item</Text>
        <Text style={[styles.tableCellBold, { width: '10%' }]}>HSN</Text>
        <Text style={[styles.tableCellBold, { width: '8%', textAlign: 'right' }]}>Qty</Text>
        <Text style={[styles.tableCellBold, { width: '14%', textAlign: 'right' }]}>Rate</Text>
        <Text style={[styles.tableCellBold, { width: '14%', textAlign: 'right' }]}>Amount</Text>
        <Text style={[styles.tableCellBold, { width: '8%', textAlign: 'right' }]}>GST%</Text>
        <Text style={[styles.tableCellBold, { width: '12%', textAlign: 'right' }]}>GST</Text>
      </View>

      {/* Supply items */}
      {supplyLines.length > 0 && (
        <View style={{ paddingHorizontal: 8, paddingVertical: 3, backgroundColor: '#EFF6FF' }}>
          <Text style={{ fontSize: 7, fontFamily: 'Helvetica-Bold', color: '#2563EB' }}>SUPPLY OF GOODS</Text>
        </View>
      )}
      {supplyLines.map((line, idx) => (
        <View key={`s-${idx}`} style={styles.tableRow}>
          <Text style={[styles.tableCell, { width: '4%' }]}>{line.lineNumber}</Text>
          <Text style={[styles.tableCell, { width: '30%' }]}>
            {line.description}{line.brand ? ` (${line.brand})` : ''}
          </Text>
          <Text style={[styles.tableCell, { width: '10%', fontSize: 7 }]}>{line.hsnCode ?? '—'}</Text>
          <Text style={[styles.tableCellRight, { width: '8%' }]}>{line.quantity}</Text>
          <Text style={[styles.tableCellRight, { width: '14%' }]}>{formatINR(line.unitPrice)}</Text>
          <Text style={[styles.tableCellRight, { width: '14%' }]}>{formatINR(line.totalPrice)}</Text>
          <Text style={[styles.tableCellRight, { width: '8%' }]}>{line.gstRate}%</Text>
          <Text style={[styles.tableCellRight, { width: '12%' }]}>{formatINR(line.gstAmount)}</Text>
        </View>
      ))}

      {/* Works contract items */}
      {worksLines.length > 0 && (
        <View style={{ paddingHorizontal: 8, paddingVertical: 3, backgroundColor: '#FFF7ED', marginTop: 4 }}>
          <Text style={{ fontSize: 7, fontFamily: 'Helvetica-Bold', color: '#D97706' }}>WORKS CONTRACT</Text>
        </View>
      )}
      {worksLines.map((line, idx) => (
        <View key={`w-${idx}`} style={styles.tableRow}>
          <Text style={[styles.tableCell, { width: '4%' }]}>{line.lineNumber}</Text>
          <Text style={[styles.tableCell, { width: '30%' }]}>{line.description}</Text>
          <Text style={[styles.tableCell, { width: '10%', fontSize: 7 }]}>{line.hsnCode ?? '—'}</Text>
          <Text style={[styles.tableCellRight, { width: '8%' }]}>{line.quantity}</Text>
          <Text style={[styles.tableCellRight, { width: '14%' }]}>{formatINR(line.unitPrice)}</Text>
          <Text style={[styles.tableCellRight, { width: '14%' }]}>{formatINR(line.totalPrice)}</Text>
          <Text style={[styles.tableCellRight, { width: '8%' }]}>{line.gstRate}%</Text>
          <Text style={[styles.tableCellRight, { width: '12%' }]}>{formatINR(line.gstAmount)}</Text>
        </View>
      ))}

      {/* Totals */}
      <View style={[styles.divider]} />
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
        <View style={{ width: '40%' }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 }}>
            <Text style={styles.body}>Supply Subtotal</Text>
            <Text style={styles.body}>{formatINR(data.subtotalSupply)}</Text>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 }}>
            <Text style={styles.body}>GST on Supply</Text>
            <Text style={styles.body}>{formatINR(data.gstSupply)}</Text>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 }}>
            <Text style={styles.body}>Works Contract Subtotal</Text>
            <Text style={styles.body}>{formatINR(data.subtotalWorks)}</Text>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 }}>
            <Text style={styles.body}>GST on Works</Text>
            <Text style={styles.body}>{formatINR(data.gstWorks)}</Text>
          </View>
          {data.discountAmount > 0 && (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 }}>
              <Text style={[styles.body, { color: BRAND.green }]}>Discount</Text>
              <Text style={[styles.body, { color: BRAND.green }]}>-{formatINR(data.discountAmount)}</Text>
            </View>
          )}
          <View style={{ borderTopWidth: 2, borderTopColor: BRAND.black, paddingTop: 4, marginTop: 4 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 13, fontFamily: 'Helvetica-Bold' }}>Total</Text>
              <Text style={{ fontSize: 13, fontFamily: 'Helvetica-Bold', color: BRAND.green }}>{formatINR(data.totalAfterDiscount)}</Text>
            </View>
          </View>
        </View>
      </View>

      <PageFooter proposalNumber={data.proposalNumber} pageNum={5} totalPages={10} />
    </Page>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// PAGE 6 — SCOPE OF WORK
// ═══════════════════════════════════════════════════════════════════════

function ScopePage({ data }: { data: ProposalPDFData }) {
  const shiroiItems = data.bomLines.filter(l => l.scopeOwner === 'shiroi');
  const clientItems = data.bomLines.filter(l => l.scopeOwner === 'client');

  return (
    <Page size="A4" style={styles.page}>
      <View style={styles.brandBar} />
      <Text style={styles.h1}>Scope of Work</Text>

      {/* Shiroi Scope */}
      <Text style={[styles.h2, { color: BRAND.green }]}>Shiroi Scope</Text>
      <View style={{ marginTop: 4 }}>
        {shiroiItems.map((item, i) => (
          <View key={i} style={{ flexDirection: 'row', marginBottom: 3 }}>
            <Text style={{ fontSize: 10, color: BRAND.green, marginRight: 6 }}>✓</Text>
            <Text style={styles.body}>{categoryLabel(item.category)}: {item.description}</Text>
          </View>
        ))}
        {/* Standard inclusions */}
        <View style={{ flexDirection: 'row', marginBottom: 3 }}>
          <Text style={{ fontSize: 10, color: BRAND.green, marginRight: 6 }}>✓</Text>
          <Text style={styles.body}>System design and engineering</Text>
        </View>
        <View style={{ flexDirection: 'row', marginBottom: 3 }}>
          <Text style={{ fontSize: 10, color: BRAND.green, marginRight: 6 }}>✓</Text>
          <Text style={styles.body}>Quality inspection and testing at each milestone</Text>
        </View>
        <View style={{ flexDirection: 'row', marginBottom: 3 }}>
          <Text style={{ fontSize: 10, color: BRAND.green, marginRight: 6 }}>✓</Text>
          <Text style={styles.body}>System commissioning and handover documentation</Text>
        </View>
      </View>

      {/* Customer Scope */}
      {clientItems.length > 0 && (
        <>
          <Text style={[styles.h2, { color: BRAND.amber }]}>Customer Scope</Text>
          <View style={{ marginTop: 4 }}>
            {clientItems.map((item, i) => (
              <View key={i} style={{ flexDirection: 'row', marginBottom: 3 }}>
                <Text style={{ fontSize: 10, color: BRAND.amber, marginRight: 6 }}>●</Text>
                <Text style={styles.body}>{categoryLabel(item.category)}: {item.description}</Text>
              </View>
            ))}
          </View>
        </>
      )}

      {/* Excluded items */}
      <Text style={[styles.h2, { color: BRAND.gray500 }]}>Excluded from Scope</Text>
      <View style={{ marginTop: 4 }}>
        {[
          'Structural strengthening of existing roof (if required)',
          'Electrical panel upgrade or main switchgear replacement',
          'Tree cutting or removal of obstructions',
          'Generator integration or load management systems',
          'External painting or aesthetic finishing after installation',
        ].map((item, i) => (
          <View key={i} style={{ flexDirection: 'row', marginBottom: 3 }}>
            <Text style={{ fontSize: 10, color: BRAND.gray500, marginRight: 6 }}>✕</Text>
            <Text style={[styles.body, { color: BRAND.gray500 }]}>{item}</Text>
          </View>
        ))}
      </View>

      <PageFooter proposalNumber={data.proposalNumber} pageNum={6} totalPages={10} />
    </Page>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// PAGE 7 — PAYMENT SCHEDULE
// ═══════════════════════════════════════════════════════════════════════

function PaymentPage({ data }: { data: ProposalPDFData }) {
  return (
    <Page size="A4" style={styles.page}>
      <View style={styles.brandBar} />
      <Text style={styles.h1}>Payment Schedule</Text>

      <Text style={[styles.body, { marginTop: 8, marginBottom: 12 }]}>
        Payment is structured around project milestones. Each payment is triggered upon completion of the corresponding milestone.
      </Text>

      {/* Visual milestone bars */}
      <View style={{ flexDirection: 'row', height: 8, marginBottom: 16, borderRadius: 4, overflow: 'hidden' }}>
        {data.milestones.map((m, i) => (
          <View key={i} style={{
            width: `${m.percentage}%`,
            backgroundColor: i === 0 ? BRAND.green : i === 1 ? BRAND.greenDark : '#047857',
            height: 8,
          }} />
        ))}
      </View>

      {/* Table */}
      <View style={styles.tableHeader}>
        <Text style={[styles.tableCellBold, { width: '5%' }]}>#</Text>
        <Text style={[styles.tableCellBold, { width: '30%' }]}>Milestone</Text>
        <Text style={[styles.tableCellBold, { width: '15%', textAlign: 'right' }]}>%</Text>
        <Text style={[styles.tableCellBold, { width: '25%', textAlign: 'right' }]}>Amount</Text>
        <Text style={[styles.tableCellBold, { width: '25%' }]}>Trigger</Text>
      </View>
      {data.milestones.map(m => (
        <View key={m.order} style={styles.tableRow}>
          <Text style={[styles.tableCell, { width: '5%' }]}>{m.order}</Text>
          <Text style={[styles.tableCell, { width: '30%' }]}>{m.name}</Text>
          <Text style={[styles.tableCellRight, { width: '15%' }]}>{m.percentage}%</Text>
          <Text style={[styles.tableCellRight, { width: '25%', fontFamily: 'Helvetica-Bold' }]}>{formatINR(m.amount)}</Text>
          <Text style={[styles.tableCell, { width: '25%' }]}>{triggerLabel(m.trigger)}</Text>
        </View>
      ))}

      {/* Total row */}
      <View style={[styles.tableRow, { backgroundColor: BRAND.gray100 }]}>
        <Text style={[styles.tableCellBold, { width: '5%' }]} />
        <Text style={[styles.tableCellBold, { width: '30%' }]}>Total</Text>
        <Text style={[styles.tableCellBold, { width: '15%', textAlign: 'right' }]}>100%</Text>
        <Text style={[styles.tableCellBold, { width: '25%', textAlign: 'right', color: BRAND.green }]}>{formatINR(data.totalAfterDiscount)}</Text>
        <Text style={[styles.tableCell, { width: '25%' }]} />
      </View>

      <Text style={[styles.body, { marginTop: 16 }]}>
        All payments to be made via bank transfer (NEFT/RTGS/UPI) to Shiroi Energy LLP.
        Proforma invoices will be raised at each milestone. GST invoices will be issued upon receipt of payment.
      </Text>

      <PageFooter proposalNumber={data.proposalNumber} pageNum={7} totalPages={10} />
    </Page>
  );
}

// PAGE 8 — WARRANTY & AMC  (rendered via shared WarrantyAndTermsPage)

// ═══════════════════════════════════════════════════════════════════════
// PAGE 9 — TERMS & CONDITIONS
// ═══════════════════════════════════════════════════════════════════════

function TermsPage({ data }: { data: ProposalPDFData }) {
  return (
    <Page size="A4" style={styles.page}>
      <View style={styles.brandBar} />
      <Text style={styles.h1}>Terms & Conditions</Text>

      {[
        { title: '1. Proposal Validity', body: `This proposal is valid until ${data.validUntil}. Prices are subject to change after the validity period due to market fluctuations in material costs.` },
        { title: '2. Taxes & Duties', body: 'All prices are exclusive of GST unless explicitly stated otherwise. Supply items attract 12% GST (with ITC benefit). Works contract items attract 18% GST. Any change in tax rates by the government will be passed through at actuals.' },
        { title: '3. Site Readiness', body: 'The customer shall ensure the installation site is accessible, structurally sound, and free from obstructions. Any additional civil work required due to unforeseen site conditions will be quoted separately.' },
        { title: '4. Timeline', body: 'Standard project timeline is 3-4 weeks from advance payment for residential (up to 10kWp) and 6-8 weeks for commercial (above 10kWp). Timelines are subject to TNEB and CEIG processing times which are outside Shiroi\'s control.' },
        { title: '5. TNEB & Regulatory', body: 'Net metering application, CEIG clearance, and TNEB meter installation are included in Shiroi scope (unless explicitly excluded). Processing times vary from 4-12 weeks depending on TNEB office workload.' },
        { title: '6. Payment Terms', body: 'Payment milestones as per the payment schedule on page 7. Delay in payment beyond 7 days of milestone completion may result in project timeline extension.' },
        { title: '7. Cancellation', body: 'Cancellation before material procurement: full refund minus 5% processing fee. After material procurement: refund minus actual material costs and 10% processing fee. After installation begins: no refund.' },
        { title: '8. Force Majeure', body: 'Neither party shall be liable for delays caused by events beyond reasonable control including natural disasters, government actions, pandemic restrictions, or supply chain disruptions.' },
        { title: '9. Limitation of Liability', body: 'Shiroi Energy\'s total liability under this agreement shall not exceed the total contract value. Shiroi is not liable for indirect, consequential, or incidental damages.' },
        { title: '10. Dispute Resolution', body: 'Any disputes shall be resolved through mutual discussion. Failing resolution, disputes shall be referred to arbitration under the Arbitration and Conciliation Act, 1996. Jurisdiction: Chennai, Tamil Nadu.' },
      ].map((item, i) => (
        <View key={i} style={{ marginTop: i === 0 ? 8 : 6 }}>
          <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold' }}>{item.title}</Text>
          <Text style={{ fontSize: 8, lineHeight: 1.4, color: BRAND.gray700, marginTop: 1 }}>{item.body}</Text>
        </View>
      ))}

      <PageFooter proposalNumber={data.proposalNumber} pageNum={9} totalPages={10} />
    </Page>
  );
}

// PAGE 10 — PROJECT REFERENCES  (rendered via shared WhyShiroiPage)

// ═══════════════════════════════════════════════════════════════════════
// MAIN DOCUMENT
// ═══════════════════════════════════════════════════════════════════════

export function DetailedProposalPDF({ data }: { data: ProposalPDFData }) {
  return (
    <Document
      title={`Solar Proposal — ${data.customerName} — ${data.systemSizeKwp}kWp`}
      author="Shiroi Energy LLP"
      subject={`Proposal ${data.proposalNumber}`}
    >
      <CoverPage data={data} />
      <AboutShiroiPage data={data} pageNum={2} totalPages={10} />
      <SystemDesignPage data={data} />
      <SavingsROIPage data={data} />
      <BOMPage data={data} />
      <ScopePage data={data} />
      <PaymentPage data={data} />
      <WarrantyAndTermsPage data={data} pageNum={8} totalPages={10} />
      <TermsPage data={data} />
      <WhyShiroiPage data={data} pageNum={10} totalPages={10} />
    </Document>
  );
}
