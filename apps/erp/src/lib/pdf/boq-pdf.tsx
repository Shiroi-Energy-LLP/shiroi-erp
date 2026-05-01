// apps/erp/src/lib/pdf/boq-pdf.tsx
//
// BOQ PDF document — Shiroi letterhead + project BOQ table.
// Pattern-matched to budgetary-quote-pdf.tsx and purchase-order-pdf.tsx.

import React from 'react';
import { Document, Page, Text, View } from '@react-pdf/renderer';
import { styles, BRAND } from './pdf-styles';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatINRLocal(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(amount);
}

function toISTDateTime(isoStr: string): string {
  return new Date(isoStr).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

// ─── Props ───────────────────────────────────────────────────────────────────

export interface BoqPdfProps {
  project: {
    project_number: string;
    customer_name: string;
    site_address?: string | null;
  };
  items: Array<{
    line_number: number;
    item_category: string;
    item_description: string;
    unit: string;
    quantity: number;
    unit_price: number;
    total_price: number;
    hsn_code?: string | null;
  }>;
  generatedBy: string;
  generatedAt: string; // ISO timestamp
}

// ─── Column widths (points, A4 = 595pt wide, 50pt margins each side = 495pt) ─

const COL = {
  num: 20,
  category: 80,
  description: 150,
  hsn: 45,
  unit: 25,
  qty: 35,
  rate: 55,
  amount: 65,
} as const;

// ─── Component ───────────────────────────────────────────────────────────────

export function BoqPdf({ project, items, generatedBy, generatedAt }: BoqPdfProps) {
  const grandTotal = items.reduce((s, i) => s + Number(i.total_price || 0), 0);

  return (
    <Document
      title={`BOQ — ${project.project_number}`}
      author="Shiroi Energy LLP"
    >
      <Page size="A4" style={styles.page}>
        {/* Brand bar */}
        <View style={styles.brandBar} />

        {/* Letterhead */}
        <View style={{ marginBottom: 10 }}>
          <Text style={{ fontSize: 16, fontFamily: 'Helvetica-Bold', color: BRAND.green }}>
            SHIROI ENERGY PRIVATE LIMITED
          </Text>
          <Text style={{ fontSize: 8, color: BRAND.gray500, marginTop: 2 }}>
            Solar EPC — Rooftop Solar, Chennai, Tamil Nadu
          </Text>
        </View>

        {/* Document title */}
        <View style={{ marginBottom: 10, borderBottomWidth: 1, borderBottomColor: BRAND.gray300, paddingBottom: 6 }}>
          <Text style={{ fontSize: 13, fontFamily: 'Helvetica-Bold', color: BRAND.black }}>
            Bill of Quantities (BOQ)
          </Text>
        </View>

        {/* Project details */}
        <View style={{ flexDirection: 'row', marginBottom: 12, gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 8, color: BRAND.gray500, fontFamily: 'Helvetica-Bold', marginBottom: 2 }}>
              PROJECT
            </Text>
            <Text style={{ fontSize: 10, color: BRAND.black, fontFamily: 'Helvetica-Bold' }}>
              {project.project_number}
            </Text>
          </View>
          <View style={{ flex: 2 }}>
            <Text style={{ fontSize: 8, color: BRAND.gray500, fontFamily: 'Helvetica-Bold', marginBottom: 2 }}>
              CUSTOMER
            </Text>
            <Text style={{ fontSize: 10, color: BRAND.black }}>
              {project.customer_name}
            </Text>
          </View>
          {project.site_address && (
            <View style={{ flex: 2 }}>
              <Text style={{ fontSize: 8, color: BRAND.gray500, fontFamily: 'Helvetica-Bold', marginBottom: 2 }}>
                SITE
              </Text>
              <Text style={{ fontSize: 9, color: BRAND.gray700 }}>
                {project.site_address}
              </Text>
            </View>
          )}
        </View>

        {/* Table header */}
        <View style={[styles.tableHeader, { flexDirection: 'row' }]}>
          <Text style={[styles.tableCell, { width: COL.num, fontFamily: 'Helvetica-Bold' }]}>#</Text>
          <Text style={[styles.tableCell, { width: COL.category, fontFamily: 'Helvetica-Bold' }]}>Category</Text>
          <Text style={[styles.tableCell, { flex: 1, fontFamily: 'Helvetica-Bold' }]}>Description</Text>
          <Text style={[styles.tableCell, { width: COL.hsn, fontFamily: 'Helvetica-Bold' }]}>HSN</Text>
          <Text style={[styles.tableCell, { width: COL.unit, fontFamily: 'Helvetica-Bold' }]}>Unit</Text>
          <Text style={[styles.tableCellRight, { width: COL.qty, fontFamily: 'Helvetica-Bold' }]}>Qty</Text>
          <Text style={[styles.tableCellRight, { width: COL.rate, fontFamily: 'Helvetica-Bold' }]}>Rate</Text>
          <Text style={[styles.tableCellRight, { width: COL.amount, fontFamily: 'Helvetica-Bold' }]}>Amount</Text>
        </View>

        {/* Table rows */}
        {items.map((item, idx) => (
          <View
            key={item.line_number}
            style={[
              styles.tableRow,
              { flexDirection: 'row', backgroundColor: idx % 2 === 0 ? BRAND.gray50 : BRAND.white },
            ]}
          >
            <Text style={[styles.tableCell, { width: COL.num }]}>{item.line_number}</Text>
            <Text style={[styles.tableCell, { width: COL.category }]}>
              {(item.item_category || '').replace(/_/g, ' ')}
            </Text>
            <Text style={[styles.tableCell, { flex: 1 }]}>{item.item_description}</Text>
            <Text style={[styles.tableCell, { width: COL.hsn }]}>{item.hsn_code ?? '—'}</Text>
            <Text style={[styles.tableCell, { width: COL.unit }]}>{item.unit}</Text>
            <Text style={[styles.tableCellRight, { width: COL.qty }]}>{item.quantity}</Text>
            <Text style={[styles.tableCellRight, { width: COL.rate }]}>{formatINRLocal(Number(item.unit_price))}</Text>
            <Text style={[styles.tableCellRight, { width: COL.amount }]}>{formatINRLocal(Number(item.total_price))}</Text>
          </View>
        ))}

        {/* Grand total */}
        <View style={{ flexDirection: 'row', borderTopWidth: 1.5, borderTopColor: BRAND.black, marginTop: 4, paddingTop: 6 }}>
          <Text style={{ flex: 1, fontSize: 9, fontFamily: 'Helvetica-Bold', color: BRAND.black }}>
            Grand Total (incl. GST)
          </Text>
          <Text style={[styles.tableCellRight, { width: COL.amount, fontFamily: 'Helvetica-Bold', fontSize: 10, color: BRAND.green }]}>
            {formatINRLocal(grandTotal)}
          </Text>
        </View>

        {/* Footer */}
        <View style={[styles.footer]}>
          <Text>Generated by {generatedBy}</Text>
          <Text>{toISTDateTime(generatedAt)} IST</Text>
        </View>
      </Page>
    </Document>
  );
}
