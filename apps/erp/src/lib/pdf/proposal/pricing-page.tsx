// apps/erp/src/lib/pdf/proposal/pricing-page.tsx
// Role: Supply Cost + Services Cost side-by-side panels, Grand Total at bottom.
//       Pulls subtotal_supply, subtotal_works, gst_supply_amount, gst_works_amount,
//       total_after_discount from proposal data.
// Mode: quick only.
import React from 'react';
import { Page, View, Text } from '@react-pdf/renderer';
import { BRAND } from '../pdf-styles';
import { formatINR } from '../proposal-pdf-data';
import { BrandFooter } from './brand-footer';
import type { ProposalPDFData } from '../proposal-pdf-data';

interface PricingPageProps {
  data: ProposalPDFData;
  pageNum: number;
  totalPages: number;
}

function PricingPanel({
  title,
  gstRate,
  subtotal,
  gstAmount,
  total,
}: {
  title: string;
  gstRate: string;
  subtotal: number;
  gstAmount: number;
  total: number;
}) {
  return (
    <View
      style={{
        flex: 1,
        borderWidth: 1,
        borderColor: BRAND.gray300,
        borderRadius: 6,
        overflow: 'hidden',
      }}
    >
      {/* Panel header */}
      <View
        style={{
          backgroundColor: BRAND.gray100,
          paddingHorizontal: 12,
          paddingVertical: 8,
          borderBottomWidth: 1,
          borderBottomColor: BRAND.gray300,
        }}
      >
        <Text style={{ fontSize: 11, fontFamily: 'Helvetica-Bold', color: BRAND.black }}>{title}</Text>
        <Text style={{ fontSize: 8, color: BRAND.gray500, marginTop: 1 }}>GST @ {gstRate}</Text>
      </View>

      {/* Rows */}
      <View style={{ padding: 12 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
          <Text style={{ fontSize: 9, color: BRAND.gray700 }}>Subtotal</Text>
          <Text style={{ fontSize: 9, color: BRAND.gray700 }}>{formatINR(subtotal)}</Text>
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
          <Text style={{ fontSize: 9, color: BRAND.gray700 }}>GST @ {gstRate}</Text>
          <Text style={{ fontSize: 9, color: BRAND.gray700 }}>{formatINR(gstAmount)}</Text>
        </View>
        <View
          style={{
            borderTopWidth: 1,
            borderTopColor: BRAND.gray300,
            paddingTop: 6,
            flexDirection: 'row',
            justifyContent: 'space-between',
          }}
        >
          <Text style={{ fontSize: 10, fontFamily: 'Helvetica-Bold' }}>Total</Text>
          <Text style={{ fontSize: 10, fontFamily: 'Helvetica-Bold' }}>{formatINR(total)}</Text>
        </View>
      </View>
    </View>
  );
}

export function PricingPage({ data, pageNum, totalPages }: PricingPageProps) {
  const supplyTotal = data.subtotalSupply + data.gstSupply;
  const worksTotal  = data.subtotalWorks + data.gstWorks;

  return (
    <Page size="A4" style={{ fontFamily: 'Helvetica', paddingTop: 40, paddingBottom: 60, paddingHorizontal: 40 }}>
      {/* Brand bar */}
      <View style={{ height: 4, backgroundColor: BRAND.green, marginBottom: 16 }} />

      <Text
        style={{
          fontSize: 18,
          fontFamily: 'Helvetica-Bold',
          color: BRAND.black,
          marginBottom: 20,
        }}
      >
        Pricing for {data.systemSizeKwp} kWp with{' '}
        {data.panelWattage ? `${data.panelWattage} Wp` : '600/620 Wp'} Bifacial Solar panels
      </Text>

      {/* Side-by-side panels */}
      <View style={{ flexDirection: 'row', gap: 16, marginBottom: 24 }}>
        <PricingPanel
          title="Supply Cost"
          gstRate="5%"
          subtotal={data.subtotalSupply}
          gstAmount={data.gstSupply}
          total={supplyTotal}
        />
        <PricingPanel
          title="Services Cost"
          gstRate="18%"
          subtotal={data.subtotalWorks}
          gstAmount={data.gstWorks}
          total={worksTotal}
        />
      </View>

      {/* Discount (if any) */}
      {data.discountAmount > 0 && (
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'flex-end',
            marginBottom: 8,
          }}
        >
          <Text style={{ fontSize: 10, color: BRAND.green, marginRight: 12 }}>Discount</Text>
          <Text style={{ fontSize: 10, color: BRAND.green, fontFamily: 'Helvetica-Bold' }}>
            -{formatINR(data.discountAmount)}
          </Text>
        </View>
      )}

      {/* Grand Total */}
      <View
        style={{
          borderTopWidth: 2,
          borderTopColor: BRAND.green,
          paddingTop: 14,
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <Text style={{ fontSize: 14, fontFamily: 'Helvetica-Bold', color: BRAND.black }}>
          Grand Total (incl. GST)
        </Text>
        <Text
          style={{
            fontSize: 28,
            fontFamily: 'Helvetica-Bold',
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
