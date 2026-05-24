// apps/erp/src/lib/pdf/handover/handover-constants.ts
// Role: Shiroi contact details and warranty terms used in the handover pack PDF.
// Values confirmed by Vivek. Move to settings table in a future sprint.

export const SHIROI_CONTACT = {
  company: 'Shiroi Energy LLP',
  address: '75/34, Rangeela Apartments, Third Main Road,\nKasturba Nagar, Adyar, Chennai - 600 020',
  phone: '94440 60787',
  whatsapp: '94440 60787',
  email: 'support@shiroienergy.com',
  gstin: '33ACPFS4398J1ZE',
} as const;

export const WARRANTY_TERMS = [
  { item: 'Solar Panels — Performance', term: '25 years (80% output guaranteed)' },
  { item: 'Solar Panels — Product',     term: '10 years manufacturer defect' },
  { item: 'Inverter',                   term: '5 years standard (extendable to 10 years)' },
  { item: 'Mounting Structure',         term: '10 years structural integrity' },
  { item: 'Workmanship (Shiroi)',        term: '1 year free rectification' },
] as const;

export const OM_INSTRUCTIONS = [
  'Clean panel surface with soft cloth and water every quarter (avoid abrasives).',
  'Check inverter display weekly — green LED indicates normal operation.',
  'Inspect cable terminations and junction boxes annually for corrosion or loose contacts.',
  'Do not shade panels with new structures or vegetation — even partial shading reduces output significantly.',
  'If inverter shows a fault code, note the code and contact Shiroi before attempting any reset.',
] as const;

export const DOCUMENTS_CHECKLIST = [
  'Net metering approval letter (TANGEDCO / DISCOM)',
  'CEIG inspection certificate (if applicable)',
  'Inverter warranty card (from manufacturer)',
  'Panel warranty certificate (from manufacturer)',
  'Shiroi Energy invoice & payment receipt',
  'Emergency shutdown procedure (affixed on inverter enclosure)',
] as const;

// Chennai average insolation (used when PVWatts figure unavailable)
export const CHENNAI_YIELD_KWH_PER_KWP = 1200; // kWh/kWp/year
export const ELECTRICITY_RATE_PER_UNIT = 8;    // ₹/kWh — generic Tamil Nadu residential rate
