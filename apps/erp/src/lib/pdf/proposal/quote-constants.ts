// apps/erp/src/lib/pdf/proposal/quote-constants.ts
// Role: Shared constants — company identity, bank details, and executed-projects list.
// Mode: shared (used by both detailed and quick proposals).
//
// TODO: move BANK values to a settings table when /settings/company UI exists.
// GSTIN and bank details are hardcoded here for v1 — pull from env or DB in v2.

export const COMPANY = {
  legalName:  'SHIROI ENERGY LLP',
  brandName:  'SHIROI',
  tagline:    'Solar EPC · Chennai',
  address:    '75/34, Rangeela Apartments, Third Main Road,\nKasturba Nagar, Adyar, Chennai - 600 020, INDIA',
  landline:   '94440 60787',
  email:      'prem@shiroienergy.com',
} as const;

// Real bank + GSTIN values confirmed by Vivek 2026-05-20.
// TODO: move to settings/company table once the /settings/company UI exists
// so non-engineers can update them without a code deploy.
export const BANK = {
  name:          'UCO Bank',
  accountName:   'Shiroi Energy LLP',
  accountNumber: '01580510000908',
  ifsc:          'UCBA0000158',
  branch:        'Adyar Branch',
  accountType:   'Cash Credit',
  gstin:         '33ACPFS4398J1ZE',
} as const;

// Hardcoded executed-project lists per sector (text-only chips for v1).
// If Prem wants to add/remove a customer, edit the array directly here.
// Future revision: add a /settings/proposal-clients UI surface.

export const EXECUTED_PROJECTS = {
  builder: [
    'Radiance Lifestyle',
    'Prestige',
    'Brigade',
    'Akshaya',
    'GRN',
    'Vijay-Raja',
    'Marutham',
    'Ramaniyam',
    'Sumanth & Co',
    'Indus Alliance',
    'DRA',
    'Bhagyam',
    'Olympia Panache',
    'Lancor',
  ],
  industrial: [
    'Metal Forms',
    'Chemfab Alkalis',
    'Pioneer Spinning Mills',
    'Sri Krishna Sweets',
    'SVA Spinning Mills',
    'SVPB Spinners',
    'MSM Spinning Mill',
    'Cholan Paper Mills',
  ],
  educational: [
    'Ramakrishna Mission',
    'Hindu School',
    'GGN School',
  ],
  residential: [
    'Mandarin',
    'Radiance Mercury',
    'Lancor RWD',
    'Sun Grow',
  ],
} as const;
