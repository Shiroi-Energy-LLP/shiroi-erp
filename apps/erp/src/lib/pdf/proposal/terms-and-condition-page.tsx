// apps/erp/src/lib/pdf/proposal/terms-and-condition-page.tsx
// Role: Terms and Conditions — Payment Schedule, Warranty, Liability, Acceptance.
// Mode: detailed only.
import React from 'react';
import { Page, View, Text } from '@react-pdf/renderer';
import { BRAND } from '../pdf-styles';
import { formatINR } from '../proposal-pdf-data';
import { BrandFooter } from './brand-footer';
import type { ProposalPDFData } from '../proposal-pdf-data';

function SectionTitle({ label }: { label: string }) {
  return (
    <Text
      style={{
        fontSize: 12,
        fontFamily: 'Helvetica-Bold',
        color: BRAND.black,
        marginTop: 14,
        marginBottom: 6,
        borderBottomWidth: 0.5,
        borderBottomColor: BRAND.gray300,
        paddingBottom: 3,
      }}
    >
      {label}
    </Text>
  );
}

interface TermsAndConditionPageProps {
  data: ProposalPDFData;
  pageNum: number;
  totalPages: number;
}

export function TermsAndConditionPage({ data, pageNum, totalPages }: TermsAndConditionPageProps) {
  return (
    <Page size="A4" style={{ fontFamily: 'Helvetica', paddingTop: 40, paddingBottom: 60, paddingHorizontal: 40 }}>
      {/* Brand bar */}
      <View style={{ height: 4, backgroundColor: BRAND.green, marginBottom: 16 }} />

      <Text
        style={{
          fontSize: 24,
          fontFamily: 'Helvetica-Bold',
          color: BRAND.black,
          marginBottom: 4,
        }}
      >
        Terms and Condition
      </Text>

      {/* Section A — Payment Schedule */}
      <SectionTitle label="A. Payment Schedule" />

      {/* Payment table header */}
      <View
        style={{
          flexDirection: 'row',
          backgroundColor: BRAND.gray100,
          borderBottomWidth: 1,
          borderBottomColor: BRAND.gray300,
          paddingVertical: 4,
          paddingHorizontal: 6,
        }}
      >
        <Text style={{ fontSize: 8, fontFamily: 'Helvetica-Bold', width: '30%' }}>Milestone</Text>
        <Text style={{ fontSize: 8, fontFamily: 'Helvetica-Bold', width: '30%' }}>Trigger</Text>
        <Text style={{ fontSize: 8, fontFamily: 'Helvetica-Bold', width: '10%', textAlign: 'right' }}>%</Text>
        <Text style={{ fontSize: 8, fontFamily: 'Helvetica-Bold', width: '30%', textAlign: 'right' }}>Amount</Text>
      </View>

      {data.milestones.map((m, idx) => (
        <View
          key={m.order}
          style={{
            flexDirection: 'row',
            borderBottomWidth: 0.5,
            borderBottomColor: BRAND.gray300,
            paddingVertical: 4,
            paddingHorizontal: 6,
            backgroundColor: idx % 2 === 0 ? BRAND.white : BRAND.gray50,
          }}
        >
          <Text style={{ fontSize: 8, width: '30%', color: BRAND.gray700 }}>{m.name}</Text>
          <Text style={{ fontSize: 8, width: '30%', color: BRAND.gray700 }}>
            {m.trigger.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
          </Text>
          <Text style={{ fontSize: 8, width: '10%', textAlign: 'right', color: BRAND.gray700 }}>
            {m.percentage}%
          </Text>
          <Text style={{ fontSize: 8, width: '30%', textAlign: 'right', fontFamily: 'Helvetica-Bold', color: BRAND.gray700 }}>
            {formatINR(m.amount)}
          </Text>
        </View>
      ))}

      {/* Total row */}
      <View
        style={{
          flexDirection: 'row',
          paddingVertical: 4,
          paddingHorizontal: 6,
          borderTopWidth: 1,
          borderTopColor: BRAND.black,
        }}
      >
        <Text style={{ fontSize: 8, fontFamily: 'Helvetica-Bold', width: '30%' }}>Total</Text>
        <Text style={{ fontSize: 8, width: '30%' }} />
        <Text style={{ fontSize: 8, fontFamily: 'Helvetica-Bold', width: '10%', textAlign: 'right' }}>100%</Text>
        <Text style={{ fontSize: 8, fontFamily: 'Helvetica-Bold', width: '30%', textAlign: 'right', color: BRAND.green }}>
          {formatINR(data.totalAfterDiscount)}
        </Text>
      </View>

      {/* Section B — Warranty */}
      <SectionTitle label="B. Warranty" />
      {[
        { item: 'Solar Panels', warranty: '12 years product / 30 years performance (manufacturer)' },
        { item: 'Inverter', warranty: '5 years standard (extendable to 10 years for additional cost)' },
        { item: 'Mounting Structure', warranty: '10 years against galvanic failure' },
        { item: 'Workmanship', warranty: '1 year free maintenance, then optional AMC' },
      ].map((row, i) => (
        <View key={i} style={{ flexDirection: 'row', marginBottom: 4 }}>
          <Text style={{ fontSize: 8, fontFamily: 'Helvetica-Bold', width: '30%', color: BRAND.gray700 }}>
            {row.item}
          </Text>
          <Text style={{ fontSize: 8, width: '70%', color: BRAND.gray700 }}>{row.warranty}</Text>
        </View>
      ))}

      {/* Section C — Liability */}
      <SectionTitle label="C. Liability" />
      {[
        'Quotation valid for 30 days from date of issue.',
        'Prices subject to GST as per current government rates at time of invoicing.',
        'Final price subject to site survey and design confirmation.',
        'Force majeure: weather, regulatory changes, material shortages.',
      ].map((item, i) => (
        <View key={i} style={{ flexDirection: 'row', marginBottom: 4 }}>
          <Text style={{ fontSize: 8, color: BRAND.gray500, marginRight: 6 }}>•</Text>
          <Text style={{ fontSize: 8, color: BRAND.gray700, flex: 1 }}>{item}</Text>
        </View>
      ))}

      {/* Section D — Acceptance */}
      <SectionTitle label="D. Acceptance" />
      <View style={{ flexDirection: 'row', gap: 20, marginTop: 8 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 8, color: BRAND.gray500, marginBottom: 4 }}>
            Authorised Signatory (Shiroi Energy LLP)
          </Text>
          <View style={{ borderBottomWidth: 1, borderBottomColor: BRAND.gray300, marginBottom: 8, paddingBottom: 20 }} />
          <Text style={{ fontSize: 8, color: BRAND.gray500 }}>Name: _________________________</Text>
          <View style={{ marginTop: 4 }}>
            <Text style={{ fontSize: 8, color: BRAND.gray500 }}>Date: ____________</Text>
          </View>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 8, color: BRAND.gray500, marginBottom: 4 }}>
            Authorised Signatory (Customer)
          </Text>
          <View style={{ borderBottomWidth: 1, borderBottomColor: BRAND.gray300, marginBottom: 8, paddingBottom: 20 }} />
          <Text style={{ fontSize: 8, color: BRAND.gray500 }}>Name: _________________________</Text>
          <View style={{ marginTop: 4 }}>
            <Text style={{ fontSize: 8, color: BRAND.gray500 }}>Date: ____________</Text>
          </View>
        </View>
      </View>

      <BrandFooter
        proposalNumber={data.proposalNumber}
        pageNum={pageNum}
        totalPages={totalPages}
      />
    </Page>
  );
}
