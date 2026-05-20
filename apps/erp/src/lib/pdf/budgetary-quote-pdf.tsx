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

// NB: do NOT place `{/* JSX comments */}` between Document children.
// Under React 19 + @react-pdf/renderer 4.x + Next.js SWC, those comment
// slots survive compilation as `undefined`/`null` entries in the children
// array, and react-pdf's reconciler dereferences `.props` on them, throwing
// "Cannot read properties of null (reading 'props')" only inside Next's
// runtime (esbuild/tsx strip the comments cleanly, which is why the
// standalone repro at scripts/repro-pdf-error.ts succeeded).
//
// Comments describing each page now live as JS comments OUTSIDE the JSX,
// or inline above the component call — never as `{/* ... */}` slots.

export function BudgetaryQuotePDF({ data }: { data: ProposalPDFData }) {
  return (
    <Document
      title={`Budgetary Proposal — ${data.customerName} — ${data.systemSizeKwp}kWp`}
      author="Shiroi Energy LLP"
      subject={`Proposal ${data.proposalNumber}`}
    >
      <CoverPage data={data} mode="quick" />
      <Page size="A4" style={styles.page}>
        <BomTable data={data} mode="quick" />
        <BrandFooter
          proposalNumber={data.proposalNumber}
          pageNum={2}
          totalPages={TOTAL_PAGES}
        />
      </Page>
      <PricingPage
        data={data}
        pageNum={3}
        totalPages={TOTAL_PAGES}
      />
      <NoteAndAccountPage
        data={data}
        pageNum={4}
        totalPages={TOTAL_PAGES}
      />
    </Document>
  );
}
