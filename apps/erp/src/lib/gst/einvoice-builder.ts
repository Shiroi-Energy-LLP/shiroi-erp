/**
 * einvoice-builder.ts
 *
 * Pure function to convert a Shiroi invoice row (with project + customer context)
 * into the NIC e-invoice JSON payload (Schema version 1.1).
 *
 * IMPORTANT: This builder produces the schema; it does NOT call the API.
 * The actual API call (via GSP) is in finance-actions.ts → generateEInvoice().
 *
 * Pending: GSP credentials + taxpayer profile setup on the NIC sandbox before
 * live API calls are enabled. See docs/modules/finance.md § e-invoicing.
 *
 * References:
 *   - NIC e-Invoice schema v1.1: https://einvoice1.gst.gov.in/schema
 *   - GST Act: supply type codes SC = B2B, SEZWP = SEZ with payment, etc.
 */

import Decimal from 'decimal.js';

/** Minimal invoice row shape needed by the builder. */
export interface EInvoiceSourceRow {
  invoice_number: string;
  invoice_date: string;        // 'YYYY-MM-DD'
  invoice_type: 'tax_invoice' | 'proforma' | 'credit_note';
  subtotal_supply: number;     // goods / supply of goods (NUMERIC(14,2))
  subtotal_works: number;      // works contract / service (NUMERIC(14,2))
  gst_supply_amount: number;
  gst_works_amount: number;
  total_amount: number;
  notes?: string | null;
}

export interface EInvoiceCustomer {
  name: string;
  gstin?: string | null;      // null → B2C (e-invoicing not mandatory, but we build the payload)
  address_line1: string;
  city: string;
  state_code: string;          // e.g. '33' for Tamil Nadu
  pincode: string;
  phone?: string | null;
  email?: string | null;
}

export interface EInvoiceSellerConfig {
  gstin: string;               // Shiroi's GSTIN — from env / system settings, never hardcoded
  legal_name: string;          // 'Shiroi Energy LLP'
  trade_name?: string;
  address_line1: string;
  city: string;
  state_code: string;
  pincode: string;
  phone?: string;
  email?: string;
}

export interface EInvoiceLineItem {
  description: string;
  hsn_code: string;
  quantity: number;
  unit: string;                // 'KWH', 'NOS', 'OTH'
  unit_price: number;          // NUMERIC(14,2)
  taxable_value: number;       // NUMERIC(14,2)
  gst_rate: number;            // e.g. 12 or 18
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  total_line_value: number;
}

export interface EInvoicePayload {
  Version: string;
  TranDtls: {
    TaxSch: string;
    SupTyp: string;
    RegRev: string;
    EcmGstin?: string | null;
    IgstOnIntra: string;
  };
  DocDtls: {
    Typ: string;
    No: string;
    Dt: string;          // 'DD/MM/YYYY'
  };
  SellerDtls: Record<string, string | number | undefined>;
  BuyerDtls: Record<string, string | number | undefined>;
  ItemList: Record<string, string | number>[];
  ValDtls: {
    AssVal: number;
    CgstVal: number;
    SgstVal: number;
    IgstVal: number;
    CesVal: number;
    TotInvVal: number;
  };
}

/**
 * buildEInvoicePayload
 *
 * Converts Shiroi invoice data into NIC e-invoice schema v1.1 JSON.
 *
 * Tax split assumption (intra-state — Tamil Nadu seller, Tamil Nadu buyer):
 *   Supply items (panels, inverter) → HSN 85414040, 12% GST → 6% CGST + 6% SGST
 *   Works contract items (installation, civil) → SAC 9954, 12% GST → 6% CGST + 6% SGST
 *
 * For inter-state transactions pass `isInterState: true` — IGST applies instead.
 */
export function buildEInvoicePayload(
  invoice: EInvoiceSourceRow,
  customer: EInvoiceCustomer,
  seller: EInvoiceSellerConfig,
  isInterState = false,
): EInvoicePayload {
  const supplyTaxableVal = new Decimal(invoice.subtotal_supply);
  const worksTaxableVal = new Decimal(invoice.subtotal_works);
  const totalTaxableVal = supplyTaxableVal.plus(worksTaxableVal);

  const supplyGst = new Decimal(invoice.gst_supply_amount);
  const worksGst = new Decimal(invoice.gst_works_amount);
  const totalGst = supplyGst.plus(worksGst);

  // Intra-state: split GST 50/50 into CGST + SGST; inter-state: full IGST
  const cgstVal = isInterState ? new Decimal(0) : totalGst.dividedBy(2).toDecimalPlaces(2);
  const sgstVal = isInterState ? new Decimal(0) : totalGst.dividedBy(2).toDecimalPlaces(2);
  const igstVal = isInterState ? totalGst : new Decimal(0);

  const totalInvVal = new Decimal(invoice.total_amount);

  // Format date as DD/MM/YYYY for NIC schema
  const [year, month, day] = invoice.invoice_date.split('-');
  const docDate = `${day}/${month}/${year}`;

  const itemList: EInvoicePayload['ItemList'] = [];

  if (supplyTaxableVal.greaterThan(0)) {
    const supplyHalfGst = supplyGst.dividedBy(2).toDecimalPlaces(2);
    itemList.push({
      SlNo: '1',
      PrdDesc: 'Solar panels, inverter and associated electrical equipment',
      IsServc: 'N',
      HsnCd: '85414040',
      Qty: 1,
      Unit: 'OTH',
      UnitPrice: supplyTaxableVal.toNumber(),
      TotAmt: supplyTaxableVal.toNumber(),
      Discount: 0,
      AssAmt: supplyTaxableVal.toNumber(),
      GstRt: 12,
      IgstAmt: isInterState ? supplyGst.toNumber() : 0,
      CgstAmt: isInterState ? 0 : supplyHalfGst.toNumber(),
      SgstAmt: isInterState ? 0 : supplyHalfGst.toNumber(),
      CesRt: 0,
      CesAmt: 0,
      CesNonAdvlAmt: 0,
      StateCesRt: 0,
      StateCesAmt: 0,
      StateCesNonAdvlAmt: 0,
      OthChrg: 0,
      TotItemVal: supplyTaxableVal.plus(supplyGst).toNumber(),
    });
  }

  if (worksTaxableVal.greaterThan(0)) {
    const worksHalfGst = worksGst.dividedBy(2).toDecimalPlaces(2);
    itemList.push({
      SlNo: String(itemList.length + 1),
      PrdDesc: 'Solar installation and commissioning (works contract)',
      IsServc: 'Y',
      HsnCd: '9954',
      Qty: 1,
      Unit: 'OTH',
      UnitPrice: worksTaxableVal.toNumber(),
      TotAmt: worksTaxableVal.toNumber(),
      Discount: 0,
      AssAmt: worksTaxableVal.toNumber(),
      GstRt: 12,
      IgstAmt: isInterState ? worksGst.toNumber() : 0,
      CgstAmt: isInterState ? 0 : worksHalfGst.toNumber(),
      SgstAmt: isInterState ? 0 : worksHalfGst.toNumber(),
      CesRt: 0,
      CesAmt: 0,
      CesNonAdvlAmt: 0,
      StateCesRt: 0,
      StateCesAmt: 0,
      StateCesNonAdvlAmt: 0,
      OthChrg: 0,
      TotItemVal: worksTaxableVal.plus(worksGst).toNumber(),
    });
  }

  const docType =
    invoice.invoice_type === 'credit_note' ? 'CRN' : 'INV';

  return {
    Version: '1.1',
    TranDtls: {
      TaxSch: 'GST',
      SupTyp: customer.gstin ? 'B2B' : 'B2C',
      RegRev: 'N',
      IgstOnIntra: 'N',
    },
    DocDtls: {
      Typ: docType,
      No: invoice.invoice_number,
      Dt: docDate,
    },
    SellerDtls: {
      Gstin: seller.gstin,
      LglNm: seller.legal_name,
      TrdNm: seller.trade_name ?? seller.legal_name,
      Addr1: seller.address_line1,
      Loc: seller.city,
      Pin: seller.pincode,
      Stcd: seller.state_code,
      Ph: seller.phone ?? '',
      Em: seller.email ?? '',
    },
    BuyerDtls: {
      Gstin: customer.gstin ?? 'URP',  // 'URP' = unregistered person
      LglNm: customer.name,
      TrdNm: customer.name,
      Pos: customer.state_code,
      Addr1: customer.address_line1,
      Loc: customer.city,
      Pin: customer.pincode,
      Stcd: customer.state_code,
      Ph: customer.phone ?? '',
      Em: customer.email ?? '',
    },
    ItemList: itemList,
    ValDtls: {
      AssVal: totalTaxableVal.toNumber(),
      CgstVal: cgstVal.toNumber(),
      SgstVal: sgstVal.toNumber(),
      IgstVal: igstVal.toNumber(),
      CesVal: 0,
      TotInvVal: totalInvVal.toNumber(),
    },
  };
}
