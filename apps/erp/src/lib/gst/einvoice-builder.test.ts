/**
 * einvoice-builder.test.ts
 *
 * Vitest unit tests for the NIC e-invoice payload builder.
 * These tests are purely functional — no DB or network access required.
 */

import { describe, it, expect } from 'vitest';
import {
  buildEInvoicePayload,
  type EInvoiceSourceRow,
  type EInvoiceCustomer,
  type EInvoiceSellerConfig,
} from './einvoice-builder';

const MOCK_SELLER: EInvoiceSellerConfig = {
  gstin: '33AABCS1429B1ZB',
  legal_name: 'Shiroi Energy LLP',
  trade_name: 'Shiroi Energy',
  address_line1: '15 Anna Salai',
  city: 'Chennai',
  state_code: '33',
  pincode: '600002',
  phone: '9876543210',
  email: 'accounts@shiroienergy.com',
};

const MOCK_CUSTOMER_B2B: EInvoiceCustomer = {
  name: 'Anita Industries Pvt Ltd',
  gstin: '33AABCA1234B1Z5',
  address_line1: '22 Mount Road',
  city: 'Chennai',
  state_code: '33',
  pincode: '600006',
  phone: '9988776655',
  email: 'anita@example.com',
};

const MOCK_CUSTOMER_B2C: EInvoiceCustomer = {
  name: 'Suresh Kumar',
  gstin: null,
  address_line1: '5 Gandhi Nagar',
  city: 'Coimbatore',
  state_code: '33',
  pincode: '641001',
};

const MOCK_INVOICE_MIXED: EInvoiceSourceRow = {
  invoice_number: 'SHIROI/INV/2026/001',
  invoice_date: '2026-05-24',
  invoice_type: 'tax_invoice',
  subtotal_supply: 400000,
  subtotal_works: 100000,
  gst_supply_amount: 48000,      // 12% of 400000
  gst_works_amount: 12000,       // 12% of 100000
  total_amount: 560000,
};

const MOCK_INVOICE_SUPPLY_ONLY: EInvoiceSourceRow = {
  invoice_number: 'SHIROI/INV/2026/002',
  invoice_date: '2026-06-01',
  invoice_type: 'tax_invoice',
  subtotal_supply: 300000,
  subtotal_works: 0,
  gst_supply_amount: 36000,
  gst_works_amount: 0,
  total_amount: 336000,
};

describe('buildEInvoicePayload', () => {
  it('produces Version 1.1 payload', () => {
    const payload = buildEInvoicePayload(MOCK_INVOICE_MIXED, MOCK_CUSTOMER_B2B, MOCK_SELLER);
    expect(payload.Version).toBe('1.1');
  });

  it('sets DocDtls.Typ to INV for tax_invoice', () => {
    const payload = buildEInvoicePayload(MOCK_INVOICE_MIXED, MOCK_CUSTOMER_B2B, MOCK_SELLER);
    expect(payload.DocDtls.Typ).toBe('INV');
  });

  it('sets DocDtls.Typ to CRN for credit_note', () => {
    const creditNote: EInvoiceSourceRow = { ...MOCK_INVOICE_MIXED, invoice_type: 'credit_note' };
    const payload = buildEInvoicePayload(creditNote, MOCK_CUSTOMER_B2B, MOCK_SELLER);
    expect(payload.DocDtls.Typ).toBe('CRN');
  });

  it('formats invoice date as DD/MM/YYYY', () => {
    const payload = buildEInvoicePayload(MOCK_INVOICE_MIXED, MOCK_CUSTOMER_B2B, MOCK_SELLER);
    expect(payload.DocDtls.Dt).toBe('24/05/2026');
  });

  it('sets SupTyp = B2B when customer has GSTIN', () => {
    const payload = buildEInvoicePayload(MOCK_INVOICE_MIXED, MOCK_CUSTOMER_B2B, MOCK_SELLER);
    expect(payload.TranDtls.SupTyp).toBe('B2B');
  });

  it('sets SupTyp = B2C when customer has no GSTIN', () => {
    const payload = buildEInvoicePayload(MOCK_INVOICE_MIXED, MOCK_CUSTOMER_B2C, MOCK_SELLER);
    expect(payload.TranDtls.SupTyp).toBe('B2C');
  });

  it('sets BuyerDtls.Gstin = URP for unregistered customer', () => {
    const payload = buildEInvoicePayload(MOCK_INVOICE_MIXED, MOCK_CUSTOMER_B2C, MOCK_SELLER);
    expect(payload.BuyerDtls.Gstin).toBe('URP');
  });

  it('produces 2 line items for mixed supply+works invoice', () => {
    const payload = buildEInvoicePayload(MOCK_INVOICE_MIXED, MOCK_CUSTOMER_B2B, MOCK_SELLER);
    expect(payload.ItemList).toHaveLength(2);
  });

  it('produces 1 line item for supply-only invoice', () => {
    const payload = buildEInvoicePayload(MOCK_INVOICE_SUPPLY_ONLY, MOCK_CUSTOMER_B2B, MOCK_SELLER);
    expect(payload.ItemList).toHaveLength(1);
    expect(payload.ItemList[0].HsnCd).toBe('85414040');
  });

  it('splits intra-state GST into CGST + SGST (no IGST)', () => {
    const payload = buildEInvoicePayload(MOCK_INVOICE_MIXED, MOCK_CUSTOMER_B2B, MOCK_SELLER, false);
    expect(payload.ValDtls.IgstVal).toBe(0);
    expect(payload.ValDtls.CgstVal).toBe(30000);  // (48000+12000)/2
    expect(payload.ValDtls.SgstVal).toBe(30000);
  });

  it('applies full IGST for inter-state (no CGST/SGST)', () => {
    const payload = buildEInvoicePayload(MOCK_INVOICE_MIXED, MOCK_CUSTOMER_B2B, MOCK_SELLER, true);
    expect(payload.ValDtls.IgstVal).toBe(60000);  // 48000+12000
    expect(payload.ValDtls.CgstVal).toBe(0);
    expect(payload.ValDtls.SgstVal).toBe(0);
  });

  it('ValDtls.AssVal equals sum of taxable values', () => {
    const payload = buildEInvoicePayload(MOCK_INVOICE_MIXED, MOCK_CUSTOMER_B2B, MOCK_SELLER);
    expect(payload.ValDtls.AssVal).toBe(500000);  // 400000 + 100000
  });

  it('ValDtls.TotInvVal equals invoice total_amount', () => {
    const payload = buildEInvoicePayload(MOCK_INVOICE_MIXED, MOCK_CUSTOMER_B2B, MOCK_SELLER);
    expect(payload.ValDtls.TotInvVal).toBe(560000);
  });

  it('SellerDtls carries through GSTIN and legal name', () => {
    const payload = buildEInvoicePayload(MOCK_INVOICE_MIXED, MOCK_CUSTOMER_B2B, MOCK_SELLER);
    expect(payload.SellerDtls.Gstin).toBe('33AABCS1429B1ZB');
    expect(payload.SellerDtls.LglNm).toBe('Shiroi Energy LLP');
  });
});
