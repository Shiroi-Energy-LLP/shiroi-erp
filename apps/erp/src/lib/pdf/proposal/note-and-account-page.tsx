// apps/erp/src/lib/pdf/proposal/note-and-account-page.tsx
// Role: Boilerplate note paragraph + SHIROI ENERGY LLP bank account details.
//       Bank values sourced from BANK constant in quote-constants.ts (hardcoded v1).
// Mode: quick only.
import React from 'react';
import { Page, View, Text } from '@react-pdf/renderer';
import { BRAND } from '../pdf-styles';
import { BANK } from './quote-constants';
import { BrandFooter } from './brand-footer';
import type { ProposalPDFData } from '../proposal-pdf-data';

const NOTE_TEXT =
  'This is a budgetary estimate based on the system size and segment provided. ' +
  'Final pricing will be confirmed after a detailed site survey. The system specifications ' +
  'listed are indicative and may be revised based on roof type, structural assessment, and ' +
  'shading analysis. Once accepted, an advance of 50% is required to lock in panel inventory ' +
  'and start procurement. Subsequent milestones are payable as per the schedule confirmed in ' +
  'the detailed proposal.';

interface NoteAndAccountPageProps {
  data: ProposalPDFData;
  pageNum: number;
  totalPages: number;
}

function AccountRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', marginBottom: 5 }}>
      <Text style={{ fontSize: 9, color: BRAND.gray500, width: '35%' }}>{label}</Text>
      <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', color: BRAND.gray700, flex: 1 }}>
        {value}
      </Text>
    </View>
  );
}

export function NoteAndAccountPage({ data, pageNum, totalPages }: NoteAndAccountPageProps) {
  return (
    <Page size="A4" style={{ fontFamily: 'Helvetica', paddingTop: 40, paddingBottom: 60, paddingHorizontal: 40 }}>
      {/* Brand bar */}
      <View style={{ height: 4, backgroundColor: BRAND.green, marginBottom: 16 }} />

      {/* Note section */}
      <Text
        style={{
          fontSize: 14,
          fontFamily: 'Helvetica-Bold',
          color: BRAND.black,
          marginBottom: 10,
        }}
      >
        Note
      </Text>

      <View
        style={{
          backgroundColor: BRAND.gray50,
          borderLeftWidth: 3,
          borderLeftColor: BRAND.green,
          padding: 14,
          borderRadius: 4,
          marginBottom: 28,
        }}
      >
        <Text style={{ fontSize: 9, color: BRAND.gray700, lineHeight: 1.5 }}>
          {NOTE_TEXT}
        </Text>
      </View>

      {/* Account Details section */}
      <Text
        style={{
          fontSize: 14,
          fontFamily: 'Helvetica-Bold',
          color: BRAND.black,
          marginBottom: 14,
        }}
      >
        Account Details
      </Text>

      <View
        style={{
          borderWidth: 1,
          borderColor: BRAND.gray300,
          borderRadius: 6,
          padding: 16,
        }}
      >
        <AccountRow label="Account Name"   value={BANK.accountName} />
        <AccountRow label="Bank"           value={BANK.name} />
        <AccountRow label="Account Number" value={BANK.accountNumber} />
        <AccountRow label="IFSC"           value={BANK.ifsc} />
        <AccountRow label="Branch"         value={BANK.branch} />
        <AccountRow label="GSTIN"          value={BANK.gstin} />
      </View>

      <View style={{ marginTop: 20 }}>
        <Text style={{ fontSize: 8, color: BRAND.gray500, fontFamily: 'Helvetica-Oblique' }}>
          Please transfer the advance payment via NEFT / RTGS / UPI to the account above.
          Quote your proposal reference number in the payment remarks.
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
