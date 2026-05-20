// apps/erp/src/lib/pdf/proposal/system-sizing-page.tsx
// Role: Two big headline numbers (Total Investment + Units Produced Per Day),
//       followed by a line-item breakdown table.
// Mode: detailed only.
// Units/Day calculation: systemSizeKwp × 4.5 (Tamil Nadu average insolation).
import React from 'react';
import { Page, View, Text } from '@react-pdf/renderer';
import { BRAND } from '../pdf-styles';
import { formatINR } from '../proposal-pdf-data';
import { BrandFooter } from './brand-footer';
import type { ProposalPDFData } from '../proposal-pdf-data';

interface SystemSizingPageProps {
  data: ProposalPDFData;
  pageNum: number;
  totalPages: number;
}

// Tamil Nadu average peak sun hours
const INSOLATION_HRS = 4.5;

export function SystemSizingPage({ data, pageNum, totalPages }: SystemSizingPageProps) {
  const unitsPerDay = (data.systemSizeKwp * INSOLATION_HRS).toFixed(1);

  return (
    <Page size="A4" style={{ fontFamily: 'Helvetica', paddingTop: 40, paddingBottom: 60, paddingHorizontal: 40 }}>
      {/* Brand bar */}
      <View style={{ height: 4, backgroundColor: BRAND.green, marginBottom: 16 }} />

      <Text
        style={{
          fontSize: 24,
          fontFamily: 'Helvetica-Bold',
          color: BRAND.black,
          marginBottom: 24,
        }}
      >
        System Sizing and Production
      </Text>

      {/* Two big KPI numbers */}
      <View style={{ flexDirection: 'row', gap: 20, marginBottom: 28 }}>
        {/* Total Investment */}
        <View
          style={{
            flex: 1,
            backgroundColor: BRAND.gray50,
            borderLeftWidth: 4,
            borderLeftColor: BRAND.green,
            padding: 16,
            borderRadius: 4,
          }}
        >
          <Text style={{ fontSize: 10, color: BRAND.gray500, marginBottom: 6 }}>
            Total Investment
          </Text>
          <Text
            style={{
              fontSize: 28,
              fontFamily: 'Helvetica-Bold',
              color: BRAND.green,
              flexWrap: 'wrap',
            }}
          >
            {formatINR(data.totalAfterDiscount)}
          </Text>
          <Text style={{ fontSize: 8, color: BRAND.gray500, marginTop: 4 }}>
            (inclusive of GST)
          </Text>
        </View>

        {/* Units Per Day */}
        <View
          style={{
            flex: 1,
            backgroundColor: BRAND.gray50,
            borderLeftWidth: 4,
            borderLeftColor: BRAND.black,
            padding: 16,
            borderRadius: 4,
          }}
        >
          <Text style={{ fontSize: 10, color: BRAND.gray500, marginBottom: 6 }}>
            Units Produced Per Day
          </Text>
          <Text
            style={{
              fontSize: 28,
              fontFamily: 'Helvetica-Bold',
              color: BRAND.black,
            }}
          >
            {unitsPerDay} kWh
          </Text>
          <Text style={{ fontSize: 8, color: BRAND.gray500, marginTop: 4 }}>
            at 4.5 peak sun hours (Tamil Nadu avg.)
          </Text>
        </View>
      </View>

      {/* Line-item breakdown table */}
      <Text
        style={{
          fontSize: 13,
          fontFamily: 'Helvetica-Bold',
          color: BRAND.black,
          marginBottom: 8,
        }}
      >
        Quotation
      </Text>

      {/* Table header */}
      <View
        style={{
          flexDirection: 'row',
          backgroundColor: BRAND.gray100,
          borderBottomWidth: 1,
          borderBottomColor: BRAND.gray300,
          paddingVertical: 5,
          paddingHorizontal: 6,
        }}
      >
        <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', width: '40%' }}>Category</Text>
        <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', width: '30%', flexWrap: 'wrap' }}>Description</Text>
        <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', width: '10%', textAlign: 'right' }}>Qty</Text>
        <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', width: '20%', textAlign: 'right' }}>Amount</Text>
      </View>

      {data.bomLines.map((line, idx) => (
        <View
          key={line.lineNumber}
          style={{
            flexDirection: 'row',
            borderBottomWidth: 0.5,
            borderBottomColor: BRAND.gray300,
            paddingVertical: 4,
            paddingHorizontal: 6,
            backgroundColor: idx % 2 === 0 ? BRAND.white : BRAND.gray50,
          }}
        >
          <Text style={{ fontSize: 8, width: '40%', color: BRAND.gray700 }}>{line.category}</Text>
          <Text style={{ fontSize: 8, width: '30%', color: BRAND.gray700, flexWrap: 'wrap' }}>{line.description}</Text>
          <Text style={{ fontSize: 8, width: '10%', textAlign: 'right', color: BRAND.gray700 }}>{line.quantity}</Text>
          <Text style={{ fontSize: 8, width: '20%', textAlign: 'right', color: BRAND.gray700 }}>
            {formatINR(line.totalPrice)}
          </Text>
        </View>
      ))}

      {/* Discount row (if applicable) */}
      {data.discountAmount > 0 && (
        <View
          style={{
            flexDirection: 'row',
            borderBottomWidth: 0.5,
            borderBottomColor: BRAND.gray300,
            paddingVertical: 4,
            paddingHorizontal: 6,
          }}
        >
          <Text style={{ fontSize: 8, width: '80%', color: BRAND.green, fontFamily: 'Helvetica-Bold' }}>
            Discount
          </Text>
          <Text style={{ fontSize: 8, width: '20%', textAlign: 'right', color: BRAND.green, fontFamily: 'Helvetica-Bold' }}>
            -{formatINR(data.discountAmount)}
          </Text>
        </View>
      )}

      {/* Total row */}
      <View
        style={{
          flexDirection: 'row',
          paddingVertical: 6,
          paddingHorizontal: 6,
          borderTopWidth: 1.5,
          borderTopColor: BRAND.black,
          marginTop: 2,
        }}
      >
        <Text style={{ fontSize: 10, fontFamily: 'Helvetica-Bold', width: '80%' }}>
          Total (incl. GST)
        </Text>
        <Text
          style={{
            fontSize: 10,
            fontFamily: 'Helvetica-Bold',
            width: '20%',
            textAlign: 'right',
            color: BRAND.green,
          }}
        >
          {formatINR(data.totalAfterDiscount)}
        </Text>
      </View>

      <BrandFooter
        proposalNumber={data.proposalNumber}
        pageNum={pageNum}
        totalPages={totalPages}
      />
    </Page>
  );
}
