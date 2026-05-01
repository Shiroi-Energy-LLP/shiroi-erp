// apps/erp/src/lib/pdf/budgetary-quote-pdf.tsx
import React from 'react';
import { Document, Page, Text, View } from '@react-pdf/renderer';
import { styles, BRAND } from './pdf-styles';
import { formatINR } from './proposal-pdf-data';
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
  const map: Record<string, string> = {
    on_grid: 'On Grid',
    hybrid: 'Hybrid',
    off_grid: 'Off Grid',
  };
  return map[st] ?? st;
}

function structureLabel(st: string | null): string {
  if (!st) return 'Flush Mount';
  const map: Record<string, string> = {
    flush_mount: 'Flush Mount',
    elevated: 'Elevated',
    high_rise: 'High Rise',
  };
  return map[st] ?? st;
}

// ─── Cover Page ───────────────────────────────────────────────────────

function CoverPage({ data }: { data: ProposalPDFData }) {
  return (
    <Page size="A4" style={styles.coverPage}>
      {/* Brand bar at top */}
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 6, backgroundColor: BRAND.green }} />

      {/* Logo placeholder — use company name */}
      <Text style={{ fontSize: 32, fontFamily: 'Helvetica-Bold', color: BRAND.green, marginBottom: 4 }}>
        SHIROI
      </Text>
      <Text style={{ fontSize: 12, color: BRAND.gray500, marginBottom: 40, letterSpacing: 3 }}>
        ENERGY PRIVATE LIMITED
      </Text>

      {/* Title */}
      <Text style={{ fontSize: 20, fontFamily: 'Helvetica-Bold', color: BRAND.black, marginBottom: 8, textAlign: 'center' }}>
        Budgetary Proposal
      </Text>
      <Text style={{ fontSize: 14, color: BRAND.gray700, marginBottom: 24, textAlign: 'center' }}>
        {data.systemSizeKwp} kWp {systemTypeLabel(data.systemType)} Solar System
      </Text>

      {/* Customer info */}
      <View style={{ backgroundColor: BRAND.gray50, padding: 16, borderRadius: 4, width: '80%', marginBottom: 24 }}>
        <Text style={{ fontSize: 12, fontFamily: 'Helvetica-Bold', marginBottom: 4 }}>
          Prepared for
        </Text>
        <Text style={{ fontSize: 14, fontFamily: 'Helvetica-Bold', color: BRAND.green }}>
          {data.customerName}
        </Text>
        {data.customerCity && (
          <Text style={{ fontSize: 10, color: BRAND.gray500, marginTop: 2 }}>{data.customerCity}</Text>
        )}
      </View>

      {/* Meta */}
      <View style={{ flexDirection: 'row', gap: 40 }}>
        <View>
          <Text style={{ fontSize: 8, color: BRAND.gray500 }}>Proposal No.</Text>
          <Text style={{ fontSize: 10, fontFamily: 'Helvetica-Bold' }}>{data.proposalNumber}</Text>
        </View>
        <View>
          <Text style={{ fontSize: 8, color: BRAND.gray500 }}>Date</Text>
          <Text style={{ fontSize: 10 }}>{toIST(data.createdAt)}</Text>
        </View>
        <View>
          <Text style={{ fontSize: 8, color: BRAND.gray500 }}>Valid Until</Text>
          <Text style={{ fontSize: 10 }}>{data.validUntil}</Text>
        </View>
      </View>

      {/* Footer */}
      <View style={{ position: 'absolute', bottom: 30, left: 50, right: 50 }}>
        <View style={{ borderTopWidth: 1, borderTopColor: BRAND.gray300, paddingTop: 8 }}>
          <Text style={{ fontSize: 8, color: BRAND.gray500, textAlign: 'center' }}>
            Shiroi Energy LLP | Chennai, Tamil Nadu | www.shiroienergy.com
          </Text>
        </View>
      </View>
    </Page>
  );
}

// ─── System + Pricing Page ────────────────────────────────────────────

function PricingPage({ data }: { data: ProposalPDFData }) {
  const supplyLines = data.bomLines.filter(l => l.gstType === 'supply');
  const worksLines = data.bomLines.filter(l => l.gstType === 'works_contract');

  return (
    <Page size="A4" style={styles.page}>
      <View style={styles.brandBar} />

      {/* System Configuration */}
      <Text style={styles.h2}>System Configuration</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16, marginTop: 8, marginBottom: 16 }}>
        <View style={{ width: '30%' }}>
          <Text style={styles.caption}>System Size</Text>
          <Text style={{ fontSize: 12, fontFamily: 'Helvetica-Bold' }}>{data.systemSizeKwp} kWp</Text>
        </View>
        <View style={{ width: '30%' }}>
          <Text style={styles.caption}>System Type</Text>
          <Text style={{ fontSize: 12 }}>{systemTypeLabel(data.systemType)}</Text>
        </View>
        <View style={{ width: '30%' }}>
          <Text style={styles.caption}>Structure</Text>
          <Text style={{ fontSize: 12 }}>{structureLabel(data.structureType)}</Text>
        </View>
        {data.panelBrand && (
          <View style={{ width: '30%' }}>
            <Text style={styles.caption}>Panel</Text>
            <Text style={{ fontSize: 10 }}>{data.panelBrand} {data.panelModel ?? ''} × {data.panelCount ?? '-'}</Text>
          </View>
        )}
        {data.inverterBrand && (
          <View style={{ width: '30%' }}>
            <Text style={styles.caption}>Inverter</Text>
            <Text style={{ fontSize: 10 }}>{data.inverterBrand} {data.inverterModel ?? ''}</Text>
          </View>
        )}
      </View>

      {/* Pricing Table */}
      <Text style={styles.h2}>Pricing Summary</Text>

      {/* Table header */}
      <View style={styles.tableHeader}>
        <Text style={[styles.tableCellBold, { width: '5%' }]}>#</Text>
        <Text style={[styles.tableCellBold, { width: '40%' }]}>Item</Text>
        <Text style={[styles.tableCellBold, { width: '10%', textAlign: 'right' }]}>Qty</Text>
        <Text style={[styles.tableCellBold, { width: '15%', textAlign: 'right' }]}>Rate</Text>
        <Text style={[styles.tableCellBold, { width: '15%', textAlign: 'right' }]}>Amount</Text>
        <Text style={[styles.tableCellBold, { width: '15%', textAlign: 'right' }]}>GST</Text>
      </View>

      {/* Supply items */}
      {supplyLines.length > 0 && (
        <View style={{ marginTop: 4, marginBottom: 4 }}>
          <Text style={{ fontSize: 8, fontFamily: 'Helvetica-Bold', color: BRAND.gray500, paddingLeft: 8 }}>
            Supply Items (GST 5%)
          </Text>
        </View>
      )}
      {supplyLines.map((line, idx) => (
        <View key={`s-${idx}`} style={styles.tableRow}>
          <Text style={[styles.tableCell, { width: '5%' }]}>{idx + 1}</Text>
          <Text style={[styles.tableCell, { width: '40%' }]}>
            {line.description}
            {line.brand ? ` (${line.brand})` : ''}
          </Text>
          <Text style={[styles.tableCellRight, { width: '10%' }]}>{line.quantity} {line.unit}</Text>
          <Text style={[styles.tableCellRight, { width: '15%' }]}>{formatINR(line.unitPrice)}</Text>
          <Text style={[styles.tableCellRight, { width: '15%' }]}>{formatINR(line.totalPrice)}</Text>
          <Text style={[styles.tableCellRight, { width: '15%' }]}>{formatINR(line.gstAmount)}</Text>
        </View>
      ))}

      {/* Works contract items */}
      {worksLines.length > 0 && (
        <View style={{ marginTop: 8, marginBottom: 4 }}>
          <Text style={{ fontSize: 8, fontFamily: 'Helvetica-Bold', color: BRAND.gray500, paddingLeft: 8 }}>
            Works Contract (GST 18%)
          </Text>
        </View>
      )}
      {worksLines.map((line, idx) => (
        <View key={`w-${idx}`} style={styles.tableRow}>
          <Text style={[styles.tableCell, { width: '5%' }]}>{supplyLines.length + idx + 1}</Text>
          <Text style={[styles.tableCell, { width: '40%' }]}>{line.description}</Text>
          <Text style={[styles.tableCellRight, { width: '10%' }]}>{line.quantity} {line.unit}</Text>
          <Text style={[styles.tableCellRight, { width: '15%' }]}>{formatINR(line.unitPrice)}</Text>
          <Text style={[styles.tableCellRight, { width: '15%' }]}>{formatINR(line.totalPrice)}</Text>
          <Text style={[styles.tableCellRight, { width: '15%' }]}>{formatINR(line.gstAmount)}</Text>
        </View>
      ))}

      {/* Totals */}
      <View style={[styles.divider]} />
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 4 }}>
        <View style={{ width: '45%' }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 }}>
            <Text style={styles.body}>Supply Subtotal</Text>
            <Text style={styles.body}>{formatINR(data.subtotalSupply)}</Text>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 }}>
            <Text style={styles.body}>GST @ 5%</Text>
            <Text style={styles.body}>{formatINR(data.gstSupply)}</Text>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 }}>
            <Text style={styles.body}>Works Contract Subtotal</Text>
            <Text style={styles.body}>{formatINR(data.subtotalWorks)}</Text>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 }}>
            <Text style={styles.body}>GST @ 18%</Text>
            <Text style={styles.body}>{formatINR(data.gstWorks)}</Text>
          </View>
          {data.discountAmount > 0 && (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 }}>
              <Text style={[styles.body, { color: BRAND.green }]}>Discount</Text>
              <Text style={[styles.body, { color: BRAND.green }]}>-{formatINR(data.discountAmount)}</Text>
            </View>
          )}
          <View style={{ borderTopWidth: 1, borderTopColor: BRAND.black, paddingTop: 4, marginTop: 4 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 12, fontFamily: 'Helvetica-Bold' }}>Total</Text>
              <Text style={{ fontSize: 12, fontFamily: 'Helvetica-Bold', color: BRAND.green }}>
                {formatINR(data.totalAfterDiscount)}
              </Text>
            </View>
          </View>
        </View>
      </View>

      {/* Footer */}
      <View style={styles.footer}>
        <Text>{data.proposalNumber}</Text>
        <Text>Page 2 of 3</Text>
      </View>
    </Page>
  );
}

// ─── Next Steps Page ──────────────────────────────────────────────────

function NextStepsPage({ data }: { data: ProposalPDFData }) {
  return (
    <Page size="A4" style={styles.page}>
      <View style={styles.brandBar} />

      <Text style={styles.h2}>Payment Schedule</Text>
      <View style={styles.tableHeader}>
        <Text style={[styles.tableCellBold, { width: '5%' }]}>#</Text>
        <Text style={[styles.tableCellBold, { width: '35%' }]}>Milestone</Text>
        <Text style={[styles.tableCellBold, { width: '20%', textAlign: 'right' }]}>%</Text>
        <Text style={[styles.tableCellBold, { width: '20%', textAlign: 'right' }]}>Amount</Text>
        <Text style={[styles.tableCellBold, { width: '20%' }]}>Trigger</Text>
      </View>
      {data.milestones.map(m => (
        <View key={m.order} style={styles.tableRow}>
          <Text style={[styles.tableCell, { width: '5%' }]}>{m.order}</Text>
          <Text style={[styles.tableCell, { width: '35%' }]}>{m.name}</Text>
          <Text style={[styles.tableCellRight, { width: '20%' }]}>{m.percentage}%</Text>
          <Text style={[styles.tableCellRight, { width: '20%' }]}>{formatINR(m.amount)}</Text>
          <Text style={[styles.tableCell, { width: '20%' }]}>
            {m.trigger.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
          </Text>
        </View>
      ))}

      {/* Next Steps */}
      <Text style={[styles.h2, { marginTop: 24 }]}>Next Steps</Text>
      <View style={{ marginTop: 8 }}>
        <View style={{ flexDirection: 'row', marginBottom: 8 }}>
          <Text style={{ fontSize: 14, marginRight: 8 }}>1.</Text>
          <View>
            <Text style={{ fontSize: 11, fontFamily: 'Helvetica-Bold' }}>Site Survey</Text>
            <Text style={styles.body}>Our design team will visit your site for a detailed assessment and technical survey.</Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', marginBottom: 8 }}>
          <Text style={{ fontSize: 14, marginRight: 8 }}>2.</Text>
          <View>
            <Text style={{ fontSize: 11, fontFamily: 'Helvetica-Bold' }}>Detailed Proposal</Text>
            <Text style={styles.body}>Based on the survey, we will provide a detailed proposal with exact specifications and layout design.</Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', marginBottom: 8 }}>
          <Text style={{ fontSize: 14, marginRight: 8 }}>3.</Text>
          <View>
            <Text style={{ fontSize: 11, fontFamily: 'Helvetica-Bold' }}>Confirm & Begin</Text>
            <Text style={styles.body}>Upon confirmation and advance payment, we begin procurement and installation within 3-4 weeks.</Text>
          </View>
        </View>
      </View>

      {/* Validity */}
      <View style={{ backgroundColor: BRAND.greenLight, padding: 12, borderRadius: 4, marginTop: 16 }}>
        <Text style={{ fontSize: 10, fontFamily: 'Helvetica-Bold', color: BRAND.greenDark }}>
          This budgetary proposal is valid until {data.validUntil}.
        </Text>
        <Text style={{ fontSize: 9, color: BRAND.gray700, marginTop: 4 }}>
          Prices are indicative and subject to change based on the detailed site survey. Final pricing will be confirmed in the detailed proposal.
        </Text>
      </View>

      {/* Contact */}
      <View style={{ marginTop: 24, borderTopWidth: 1, borderTopColor: BRAND.gray300, paddingTop: 16 }}>
        <Text style={styles.h3}>Contact Us</Text>
        <Text style={styles.body}>Shiroi Energy LLP</Text>
        <Text style={styles.body}>Chennai, Tamil Nadu</Text>
        <Text style={[styles.body, { color: BRAND.green }]}>www.shiroienergy.com</Text>
      </View>

      {/* Footer */}
      <View style={styles.footer}>
        <Text>{data.proposalNumber}</Text>
        <Text>Page 3 of 3</Text>
      </View>
    </Page>
  );
}

// ─── Main Document ────────────────────────────────────────────────────

export function BudgetaryQuotePDF({ data }: { data: ProposalPDFData }) {
  return (
    <Document
      title={`Budgetary Proposal — ${data.customerName} — ${data.systemSizeKwp}kWp`}
      author="Shiroi Energy LLP"
      subject={`Proposal ${data.proposalNumber}`}
    >
      <CoverPage data={data} />
      <PricingPage data={data} />
      <NextStepsPage data={data} />
    </Document>
  );
}
