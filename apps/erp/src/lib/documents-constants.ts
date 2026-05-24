/**
 * documents-constants.ts
 *
 * Pure constants + types for the documents module. **No server imports** —
 * safe to import from both client components ('use client') and server actions.
 *
 * Lives in its own file because `documents-queries.ts` pulls in
 * `@repo/supabase/server` which uses `next/headers`, and a client component
 * that imports anything from that file would fail the Next.js production
 * build with "You're importing a component that needs next/headers".
 */

export type DocumentCategory =
  | 'site_survey_photo'
  | 'site_survey_report'
  | 'roof_layout'
  | 'electrical_sld'
  | 'cad_drawing'
  | 'sketchup_model'
  | 'proposal_pdf'
  | 'costing_sheet'
  | 'bom_excel'
  | 'kyc_document'
  | 'electricity_bill'
  | 'signed_proposal'
  | 'purchase_order'
  | 'invoice'
  | 'payment_receipt'
  | 'commissioning_report'
  | 'liaison_document'
  | 'as_built_drawing'
  | 'om_photo'
  | 'om_report'
  | 'misc';

export const DOCUMENT_CATEGORY_LABELS: Record<DocumentCategory, string> = {
  site_survey_photo: 'Site Photo',
  site_survey_report: 'Survey Report',
  roof_layout: 'Roof Layout',
  electrical_sld: 'Electrical SLD',
  cad_drawing: 'CAD Drawing',
  sketchup_model: 'Sketchup',
  proposal_pdf: 'Proposal PDF',
  costing_sheet: 'Costing Sheet',
  bom_excel: 'BOM',
  kyc_document: 'KYC',
  electricity_bill: 'Electricity Bill',
  signed_proposal: 'Signed Proposal',
  purchase_order: 'Purchase Order',
  invoice: 'Invoice',
  payment_receipt: 'Payment Receipt',
  commissioning_report: 'Commissioning Report',
  liaison_document: 'Liaison Doc',
  as_built_drawing: 'As-Built',
  om_photo: 'O&M Photo',
  om_report: 'O&M Report',
  misc: 'Misc',
};
