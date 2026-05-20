// apps/erp/src/lib/pdf/budgetary-quote-pdf.tsx
// Role: Class B (Quick) proposal — composes the 4-page quick-quote flow.
// Pages: Cover → BomTable (wrapped in Page) → PricingPage → NoteAndAccountPage
import React from 'react';
import { Document, Page, View } from '@react-pdf/renderer';
import { styles } from './pdf-styles';
import { CoverPage } from './proposal/cover-page';
import { BomTable } from './proposal/bom-table';
import { PricingPage } from './proposal/pricing-page';
import { NoteAndAccountPage } from './proposal/note-and-account-page';
import { BrandFooter } from './proposal/brand-footer';
import type { ProposalPDFData } from './proposal-pdf-data';

const TOTAL_PAGES = 4;

export function BudgetaryQuotePDF({ data }: { data: ProposalPDFData }) {
  return (
    <Document
      title={`Budgetary Proposal — ${data.customerName} — ${data.systemSizeKwp}kWp`}
      author="Shiroi Energy LLP"
      subject={`Proposal ${data.proposalNumber}`}
    >
      {/* Page 1: Cover */}
      <CoverPage data={data} mode="quick" />

      {/* Page 2: Technical Specification (BOM) */}
      <Page size="A4" style={styles.page}>
        <BomTable data={data} mode="quick" />
        <BrandFooter
          proposalNumber={data.proposalNumber}
          pageNum={2}
          totalPages={TOTAL_PAGES}
        />
      </Page>

      {/* Page 3: Pricing */}
      <PricingPage
        data={data}
        pageNum={3}
        totalPages={TOTAL_PAGES}
      />

      {/* Page 4: Note + Account Details */}
      <NoteAndAccountPage
        data={data}
        pageNum={4}
        totalPages={TOTAL_PAGES}
      />
    </Document>
  );
}
