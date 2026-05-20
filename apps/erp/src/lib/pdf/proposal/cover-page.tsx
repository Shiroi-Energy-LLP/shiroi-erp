// apps/erp/src/lib/pdf/proposal/cover-page.tsx
// Role: Shared cover page — "Proposal for rooftop solar PV system" with client
//       name, reference number, date, and Shiroi address block.
// Mode: shared (used by both detailed [mode="detailed"] and quick [mode="quick"] proposals).
//       In quick mode an italic budgetary-estimate line is appended under the title.
import React from 'react';
import { Page, View, Text } from '@react-pdf/renderer';
import { BRAND } from '../pdf-styles';
import { COMPANY } from './quote-constants';
import type { ProposalPDFData } from '../proposal-pdf-data';

function toIST(utcTimestamp: string): string {
  return new Date(utcTimestamp).toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

interface CoverPageProps {
  data: ProposalPDFData;
  mode: 'quick' | 'detailed';
}

export function CoverPage({ data, mode }: CoverPageProps) {
  return (
    <Page size="A4" style={{ fontFamily: 'Helvetica', padding: 0 }}>
      {/* 6mm brand-green stripe at top */}
      <View
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 17, // ~6mm at 72dpi
          backgroundColor: BRAND.green,
        }}
      />

      {/* Main content area with 40mm margins */}
      <View
        style={{
          flex: 1,
          paddingTop: 60,
          paddingHorizontal: 113, // ~40mm
          paddingBottom: 80,
          flexDirection: 'column',
        }}
      >
        {/* Logotype */}
        <Text
          style={{
            fontSize: 36,
            fontFamily: 'Helvetica-Bold',
            color: BRAND.green,
            marginBottom: 4,
          }}
        >
          {COMPANY.brandName}
        </Text>
        <Text
          style={{
            fontSize: 12,
            color: BRAND.gray500,
            letterSpacing: 3,
            marginBottom: 40,
          }}
        >
          ENERGY LLP
        </Text>

        {/* Title block — centred */}
        <Text
          style={{
            fontSize: 18,
            fontFamily: 'Helvetica-Bold',
            color: BRAND.black,
            textAlign: 'center',
            marginBottom: 6,
          }}
        >
          Proposal for rooftop solar PV system
        </Text>

        {/* Quick-mode budgetary disclaimer */}
        {mode === 'quick' && (
          <Text
            style={{
              fontSize: 10,
              fontFamily: 'Helvetica-Oblique',
              color: BRAND.gray500,
              textAlign: 'center',
              marginBottom: 12,
            }}
          >
            Budgetary estimate — subject to site survey
          </Text>
        )}

        {/* Client details */}
        <Text
          style={{
            fontSize: 14,
            color: BRAND.gray700,
            textAlign: 'center',
            marginTop: mode === 'quick' ? 0 : 16,
            marginBottom: 4,
          }}
        >
          Client Name: {data.customerName}
        </Text>
        <Text
          style={{
            fontSize: 12,
            color: BRAND.gray500,
            textAlign: 'center',
            marginBottom: 4,
          }}
        >
          Reference number: {data.proposalNumber}
        </Text>
        <Text
          style={{
            fontSize: 12,
            color: BRAND.gray500,
            textAlign: 'center',
          }}
        >
          {toIST(data.createdAt)}
        </Text>
      </View>

      {/* Address block — pushed to bottom */}
      <View
        style={{
          position: 'absolute',
          bottom: 30,
          left: 40,
          right: 40,
          borderTopWidth: 0.75,
          borderTopColor: BRAND.gray300,
          paddingTop: 10,
        }}
      >
        <Text
          style={{
            fontSize: 11,
            fontFamily: 'Helvetica-Bold',
            color: BRAND.green,
            marginBottom: 4,
          }}
        >
          {COMPANY.legalName}
        </Text>
        <Text style={{ fontSize: 9, color: BRAND.gray700, lineHeight: 1.4 }}>
          {COMPANY.address}
        </Text>
        <Text style={{ fontSize: 9, color: BRAND.gray700, marginTop: 2 }}>
          Landline: {COMPANY.landline}
        </Text>
        <Text style={{ fontSize: 9, color: BRAND.gray700 }}>
          E-Mail: {COMPANY.email}
        </Text>
      </View>
    </Page>
  );
}
