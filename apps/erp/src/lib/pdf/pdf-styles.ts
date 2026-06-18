// apps/erp/src/lib/pdf/pdf-styles.ts
// Role: Design-system-aligned brand tokens and shared StyleSheet.
//       All PDF components import BRAND and styles from here.
//       COMPANY is re-exported from proposal/quote-constants for convenience.
import { StyleSheet } from '@react-pdf/renderer';

export const BRAND = {
  // Solar Gold brand accent. `green`/`greenDark` keys are kept as deprecated
  // aliases (still referenced across PDF components) but now resolve to GOLD —
  // green is no longer the brand hue. Prefer `gold`/`goldDark` going forward.
  gold:      '#E08A00',   // matches design-system.md --brand (solar gold)
  goldDark:  '#B45309',   // matches --brand-dark (AA on white)
  ink:       '#1F1709',   // dark ink text on gold fills
  green:     '#E08A00',   // deprecated alias → gold
  greenDark: '#B45309',   // deprecated alias → gold-dark
  black:     '#16130D',   // matches --n950 (warm near-black)
  gray900:   '#221C12',   // warm
  gray700:   '#3F424D',   // body text on white
  gray500:   '#6B7280',   // secondary labels
  gray300:   '#E5DFD3',   // warm border
  gray100:   '#F4F0E7',   // warm zebra
  gray50:    '#FBF8F2',   // warm cream
  white:     '#FFFFFF',
  solar:     '#F0B429',   // optional CTA accent on payment milestone callouts
  // Legacy tokens — kept for non-proposal PDFs (project-report, survey-report, etc.)
  greenLight: '#ECFDF5',
  amber:      '#B45309',
  red:        '#991B1B',
  statusGreen: '#16A34A', // true status green (live / healthy / pass marks)
} as const;

export const styles = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 10,
    color: BRAND.black,
    paddingTop: 40,
    paddingBottom: 60,
    paddingLeft: 40,
    paddingRight: 40,
  },
  coverPage: {
    fontFamily: 'Helvetica',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    height: '100%',
    padding: 50,
  },
  h1: {
    fontSize: 24,
    fontFamily: 'Helvetica-Bold',
    color: BRAND.black,
    marginBottom: 8,
  },
  h2: {
    fontSize: 16,
    fontFamily: 'Helvetica-Bold',
    color: BRAND.black,
    marginBottom: 6,
    marginTop: 16,
  },
  h3: {
    fontSize: 12,
    fontFamily: 'Helvetica-Bold',
    color: BRAND.gray700,
    marginBottom: 4,
    marginTop: 12,
  },
  body: {
    fontSize: 10,
    lineHeight: 1.5,
    color: BRAND.gray700,
  },
  caption: {
    fontSize: 8,
    color: BRAND.gray500,
  },
  table: {
    width: '100%',
    marginTop: 8,
    marginBottom: 8,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: BRAND.gray100,
    borderBottomWidth: 1,
    borderBottomColor: BRAND.gray300,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: BRAND.gray300,
    paddingVertical: 5,
    paddingHorizontal: 8,
  },
  tableCell: {
    fontSize: 9,
  },
  tableCellRight: {
    fontSize: 9,
    textAlign: 'right',
  },
  tableCellBold: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
  },
  brandBar: {
    height: 4,
    backgroundColor: BRAND.green,
    width: '100%',
    marginBottom: 20,
  },
  footer: {
    position: 'absolute',
    bottom: 20,
    left: 40,
    right: 40,
    fontSize: 8,
    color: BRAND.gray500,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  kpiCard: {
    backgroundColor: BRAND.gray50,
    padding: 12,
    borderRadius: 4,
    width: '23%',
  },
  kpiValue: {
    fontSize: 18,
    fontFamily: 'Helvetica-Bold',
    color: BRAND.green,
  },
  kpiLabel: {
    fontSize: 8,
    color: BRAND.gray500,
    marginTop: 2,
  },
  divider: {
    borderBottomWidth: 1,
    borderBottomColor: BRAND.gray300,
    marginVertical: 10,
    borderStyle: 'dashed',
  },
});
