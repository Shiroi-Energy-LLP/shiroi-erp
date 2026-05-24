// apps/erp/src/lib/pdf/proposal/scope-of-work-page.tsx
// Role: Two-column Inclusions / Exclusions layout.
//       Exclusions are dynamically built from BOM lines with scope_owner='client'
//       plus 5 universal exclusions.
// Mode: detailed only.
import React from 'react';
import { Page, View, Text } from '@react-pdf/renderer';
import { BRAND } from '../pdf-styles';
import { BrandFooter } from './brand-footer';
import type { ProposalPDFData } from '../proposal-pdf-data';

// Base inclusions common across all segments
const BASE_INCLUSIONS = [
  'Supply of all materials per Technical Specification',
  'Installation, commissioning, and testing',
  '1-year free maintenance',
  'Remote monitoring portal setup',
] as const;

// Segment-specific inclusion additions
const SEGMENT_INCLUSIONS: Record<string, readonly string[]> = {
  residential: [
    'TNEB net-metering liaison (if applicable)',
  ],
  commercial: [
    'TNEB net-metering / Open-access liaison (if applicable)',
    'CEIG approval support (>10 kWp systems)',
  ],
  industrial: [
    'TNEB net-metering / Open-access liaison (if applicable)',
    'CEIG approval support (mandatory for >10 kWp)',
    'Safety audit and documentation support',
  ],
};

const UNIVERSAL_EXCLUSIONS = [
  'Civil works (foundation, watertight roof penetration sealing) unless quoted separately',
  'Electrical contractor licence fees',
  'TNEB net-metering deposit',
  'Any structural strengthening of the existing roof',
  'Insurance during installation',
] as const;

interface ScopeOfWorkPageProps {
  data: ProposalPDFData;
  pageNum: number;
  totalPages: number;
}

function BulletRow({ text, color }: { text: string; color: string }) {
  return (
    <View style={{ flexDirection: 'row', marginBottom: 5 }}>
      <Text style={{ fontSize: 10, color, marginRight: 6, marginTop: 1 }}>•</Text>
      <Text style={{ fontSize: 9, color: BRAND.gray700, flex: 1, lineHeight: 1.4 }}>{text}</Text>
    </View>
  );
}

export function ScopeOfWorkPage({ data, pageNum, totalPages }: ScopeOfWorkPageProps) {
  // Dynamic exclusions from BOM lines where scope_owner = 'client'
  const clientScopeItems = data.bomLines
    .filter(l => l.scopeOwner === 'client')
    .map(l => l.description);

  const allExclusions = [...clientScopeItems, ...UNIVERSAL_EXCLUSIONS];

  // Build segment-aware inclusions list
  const segment = (data.segment ?? 'residential').toLowerCase();
  const segmentAdditions = SEGMENT_INCLUSIONS[segment] ?? SEGMENT_INCLUSIONS.commercial ?? [];
  const allInclusions: string[] = [...BASE_INCLUSIONS, ...segmentAdditions];

  return (
    <Page size="A4" style={{ fontFamily: 'Helvetica', paddingTop: 40, paddingBottom: 60, paddingHorizontal: 40 }}>
      {/* Brand bar */}
      <View style={{ height: 4, backgroundColor: BRAND.green, marginBottom: 16 }} />

      <Text
        style={{
          fontSize: 24,
          fontFamily: 'Helvetica-Bold',
          color: BRAND.black,
          marginBottom: 20,
        }}
      >
        Scope of Work
      </Text>

      <View style={{ flexDirection: 'row', gap: 20 }}>
        {/* Inclusions column */}
        <View style={{ flex: 1 }}>
          <View
            style={{
              backgroundColor: BRAND.green,
              paddingHorizontal: 10,
              paddingVertical: 5,
              borderRadius: 3,
              marginBottom: 10,
            }}
          >
            <Text style={{ fontSize: 10, fontFamily: 'Helvetica-Bold', color: BRAND.white }}>
              Inclusions
            </Text>
          </View>
          {allInclusions.map((item, i) => (
            <BulletRow key={i} text={item} color={BRAND.green} />
          ))}
        </View>

        {/* Exclusions column */}
        <View style={{ flex: 1 }}>
          <View
            style={{
              backgroundColor: BRAND.gray700,
              paddingHorizontal: 10,
              paddingVertical: 5,
              borderRadius: 3,
              marginBottom: 10,
            }}
          >
            <Text style={{ fontSize: 10, fontFamily: 'Helvetica-Bold', color: BRAND.white }}>
              Exclusions
            </Text>
          </View>
          {allExclusions.map((item, i) => (
            <BulletRow key={i} text={item} color={BRAND.gray500} />
          ))}
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
