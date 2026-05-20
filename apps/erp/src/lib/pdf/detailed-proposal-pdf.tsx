// apps/erp/src/lib/pdf/detailed-proposal-pdf.tsx
// Role: Class A (Detailed) proposal — composes the 7-page detailed flow.
// Pages: Cover → ExecutedProjects → SystemSizing → BomTable (wrapped) →
//         ScopeOfWork → TermsAndCondition → DocumentsNeeded
import React from 'react';
import { Document, Page, View } from '@react-pdf/renderer';
import { styles } from './pdf-styles';
import { CoverPage } from './proposal/cover-page';
import { ExecutedProjectsPage } from './proposal/executed-projects-page';
import { SystemSizingPage } from './proposal/system-sizing-page';
import { BomTable } from './proposal/bom-table';
import { ScopeOfWorkPage } from './proposal/scope-of-work-page';
import { TermsAndConditionPage } from './proposal/terms-and-condition-page';
import { DocumentsNeededPage } from './proposal/documents-needed-page';
import { BrandFooter } from './proposal/brand-footer';
import type { ProposalPDFData } from './proposal-pdf-data';

const TOTAL_PAGES = 7;

// NB: keep this JSX free of `{/* ... */}` comment slots — see
// budgetary-quote-pdf.tsx for the React 19 + react-pdf 4 + SWC interaction
// that crashes the renderer at runtime when those slots are present.

export function DetailedProposalPDF({ data }: { data: ProposalPDFData }) {
  // Page 1: Cover · 2: Executed Projects · 3: System Sizing · 4: BOM table
  // 5: Scope of Work · 6: Terms & Conditions · 7: Documents Needed
  return (
    <Document
      title={`Solar Proposal — ${data.customerName} — ${data.systemSizeKwp}kWp`}
      author="Shiroi Energy LLP"
      subject={`Proposal ${data.proposalNumber}`}
    >
      <CoverPage data={data} mode="detailed" />
      <ExecutedProjectsPage
        data={data}
        pageNum={2}
        totalPages={TOTAL_PAGES}
      />
      <SystemSizingPage
        data={data}
        pageNum={3}
        totalPages={TOTAL_PAGES}
      />
      <Page size="A4" style={styles.page}>
        <BomTable data={data} mode="detailed" />
        <BrandFooter
          proposalNumber={data.proposalNumber}
          pageNum={4}
          totalPages={TOTAL_PAGES}
        />
      </Page>
      <ScopeOfWorkPage
        data={data}
        pageNum={5}
        totalPages={TOTAL_PAGES}
      />
      <TermsAndConditionPage
        data={data}
        pageNum={6}
        totalPages={TOTAL_PAGES}
      />
      <DocumentsNeededPage
        data={data}
        pageNum={7}
        totalPages={TOTAL_PAGES}
      />
    </Document>
  );
}
