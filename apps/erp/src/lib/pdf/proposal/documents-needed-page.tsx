// apps/erp/src/lib/pdf/proposal/documents-needed-page.tsx
// Role: 8-item bulleted list of customer-provided documents required for
//       net-metering application and project completion.
// Mode: detailed only.
import React from 'react';
import { Page, View, Text } from '@react-pdf/renderer';
import { BRAND } from '../pdf-styles';
import { BrandFooter } from './brand-footer';
import type { ProposalPDFData } from '../proposal-pdf-data';

const DOCUMENTS = [
  'KYC: Aadhar + PAN of property owner',
  'Electricity bill (latest 3 months)',
  'Sanction letter copy (electrical service connection)',
  'Property documents (sale deed / patta — first page only, for net-metering)',
  'Cancelled cheque (for refund of net-metering deposit if applicable)',
  'Society NOC (apartments / gated communities only)',
  'Roof access / installation site photos',
  'Site survey form (filled jointly with Shiroi engineer)',
] as const;

interface DocumentsNeededPageProps {
  data: ProposalPDFData;
  pageNum: number;
  totalPages: number;
}

export function DocumentsNeededPage({ data, pageNum, totalPages }: DocumentsNeededPageProps) {
  return (
    <Page size="A4" style={{ fontFamily: 'Helvetica', paddingTop: 40, paddingBottom: 60, paddingHorizontal: 40 }}>
      {/* Brand bar */}
      <View style={{ height: 4, backgroundColor: BRAND.green, marginBottom: 16 }} />

      <Text
        style={{
          fontSize: 24,
          fontFamily: 'Helvetica-Bold',
          color: BRAND.black,
          marginBottom: 8,
        }}
      >
        Documents Needed
      </Text>

      <Text style={{ fontSize: 10, color: BRAND.gray500, marginBottom: 20 }}>
        Please arrange the following documents to expedite the net-metering application and project completion:
      </Text>

      {DOCUMENTS.map((doc, i) => (
        <View key={i} style={{ flexDirection: 'row', marginBottom: 10, alignItems: 'flex-start' }}>
          {/* Numbered badge */}
          <View
            style={{
              width: 20,
              height: 20,
              borderRadius: 10,
              backgroundColor: BRAND.green,
              alignItems: 'center',
              justifyContent: 'center',
              marginRight: 10,
              flexShrink: 0,
            }}
          >
            <Text
              style={{
                fontSize: 9,
                fontFamily: 'Helvetica-Bold',
                color: BRAND.white,
                textAlign: 'center',
              }}
            >
              {i + 1}
            </Text>
          </View>
          <Text style={{ fontSize: 10, color: BRAND.gray700, flex: 1, lineHeight: 1.4, paddingTop: 3 }}>
            {doc}
          </Text>
        </View>
      ))}

      <View
        style={{
          marginTop: 24,
          backgroundColor: BRAND.gray50,
          padding: 12,
          borderRadius: 4,
          borderLeftWidth: 3,
          borderLeftColor: BRAND.green,
        }}
      >
        <Text style={{ fontSize: 9, color: BRAND.gray700, fontFamily: 'Helvetica-Oblique' }}>
          Note: Documents are required for TNEB net-metering application and regulatory approvals.
          Soft copies (PDF/JPG) are acceptable for initial processing. Originals may be requested at
          inspection stage.
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
