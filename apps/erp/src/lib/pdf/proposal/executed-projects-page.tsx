// apps/erp/src/lib/pdf/proposal/executed-projects-page.tsx
// Role: 4-column grid of past-client chips, one column per sector.
// Mode: detailed only.
// Data: hardcoded from EXECUTED_PROJECTS in quote-constants.ts (not DB-driven in v1).
import React from 'react';
import { Page, View, Text } from '@react-pdf/renderer';
import { BRAND } from '../pdf-styles';
import { EXECUTED_PROJECTS } from './quote-constants';
import { BrandFooter } from './brand-footer';
import type { ProposalPDFData } from '../proposal-pdf-data';

const COLUMNS: Array<{
  header: string;
  key: keyof typeof EXECUTED_PROJECTS;
}> = [
  { header: 'Builder Sector',           key: 'builder' },
  { header: 'Industrial Sector',        key: 'industrial' },
  { header: 'Edu. / Institutional',     key: 'educational' },
  { header: 'Residential',              key: 'residential' },
];

interface ExecutedProjectsPageProps {
  data: ProposalPDFData;
  pageNum: number;
  totalPages: number;
}

function Chip({ name }: { name: string }) {
  return (
    <View
      style={{
        borderWidth: 0.5,
        borderColor: BRAND.gray300,
        borderRadius: 3,
        paddingHorizontal: 6,
        paddingVertical: 3,
        marginBottom: 5,
      }}
    >
      <Text style={{ fontSize: 9, color: BRAND.gray700 }}>{name}</Text>
    </View>
  );
}

export function ExecutedProjectsPage({ data, pageNum, totalPages }: ExecutedProjectsPageProps) {
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
        Executed Project
      </Text>

      {/* 4-column grid */}
      <View style={{ flexDirection: 'row', gap: 12 }}>
        {COLUMNS.map(col => (
          <View key={col.key} style={{ flex: 1 }}>
            {/* Column header */}
            <Text
              style={{
                fontSize: 10,
                fontFamily: 'Helvetica-Bold',
                color: BRAND.green,
                marginBottom: 8,
                borderBottomWidth: 1,
                borderBottomColor: BRAND.green,
                paddingBottom: 3,
              }}
            >
              {col.header}
            </Text>

            {/* Chips */}
            {(EXECUTED_PROJECTS[col.key] as readonly string[]).map((name: string) => (
              <Chip key={name} name={name} />
            ))}
          </View>
        ))}
      </View>

      <BrandFooter
        proposalNumber={data.proposalNumber}
        pageNum={pageNum}
        totalPages={totalPages}
      />
    </Page>
  );
}
