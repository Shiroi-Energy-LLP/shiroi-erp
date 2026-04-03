// apps/erp/src/lib/pdf/pdf-styles.ts
import { StyleSheet } from '@react-pdf/renderer';

// Shiroi brand colors
export const BRAND = {
  green: '#00B050',
  greenDark: '#008A3E',
  greenLight: '#ECFDF5',
  black: '#1A1D24',
  gray700: '#3E3E3E',
  gray500: '#6B7280',
  gray300: '#D1D5DB',
  gray100: '#F3F4F6',
  gray50: '#F9FAFB',
  white: '#FFFFFF',
  red: '#991B1B',
  amber: '#B45309',
} as const;

export const styles = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 10,
    color: BRAND.black,
    paddingTop: 40,
    paddingBottom: 40,
    paddingLeft: 50,
    paddingRight: 50,
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
    left: 50,
    right: 50,
    fontSize: 8,
    color: BRAND.gray500,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  kpiCard: {
    backgroundColor: BRAND.greenLight,
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
