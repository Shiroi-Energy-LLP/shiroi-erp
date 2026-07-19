// Client-safe constants for the BOM import review UI.
// No server imports here — both client components and the server page import
// from this file (NEVER-DO #21: keep the client/server boundary clean).

import type { BillStatus } from './bom-sheet-parser';

export const BILL_STATUS_OPTIONS: ReadonlyArray<{ value: BillStatus; label: string }> = [
  { value: 'na', label: 'N/A' },
  { value: 'need_bill', label: 'Need bill' },
  { value: 'submitted', label: 'Submitted' },
];

export const MATCH_CONFIDENCE_LABEL: Record<string, string> = {
  exact: 'Exact',
  fuzzy: 'Fuzzy',
  none: 'No match',
};

export const MATCH_CONFIDENCE_CLASS: Record<string, string> = {
  exact: 'bg-green-100 text-green-700',
  fuzzy: 'bg-amber-100 text-amber-700',
  none: 'bg-n-100 text-n-500',
};

export const BOM_IMPORT_STATUS_TABS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'pending', label: 'Pending' },
  { value: 'imported', label: 'Imported' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'error', label: 'Errors' },
];
