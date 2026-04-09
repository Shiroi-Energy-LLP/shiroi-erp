'use server';

import { createClient } from '@repo/supabase/server';
import { revalidatePath } from 'next/cache';

interface POLineItem {
  itemCategory: string;
  itemDescription: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  gstRate: number;
  brand?: string;
}

export async function createPurchaseOrder(input: {
  projectId: string;
  vendorId: string;
  expectedDeliveryDate?: string;
  paymentTermsDays?: number;
  notes?: string;
  lineItems: POLineItem[];
}): Promise<{ success: boolean; error?: string; poId?: string }> {
  const op = '[createPurchaseOrder]';

  if (!input.lineItems.length) return { success: false, error: 'At least one line item is required' };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  // Get employee ID
  const { data: employee } = await supabase
    .from('employees')
    .select('id')
    .eq('profile_id', user.id)
    .single();

  if (!employee) return { success: false, error: 'Employee profile not found' };

  // Generate PO number
  const { data: docNum } = await supabase.rpc('generate_doc_number', { doc_type: 'PO' });
  const poNumber = docNum || `SHIROI/PO/${new Date().getFullYear()}/TEMP`;

  // Calculate totals
  let subtotal = 0;
  let gstTotal = 0;
  for (const item of input.lineItems) {
    const lineTotal = item.quantity * item.unitPrice;
    const lineGst = lineTotal * (item.gstRate / 100);
    subtotal += lineTotal;
    gstTotal += lineGst;
  }
  const totalAmount = subtotal + gstTotal;

  // Create PO
  const { data: po, error: poError } = await supabase
    .from('purchase_orders')
    .insert({
      project_id: input.projectId,
      vendor_id: input.vendorId,
      prepared_by: employee.id,
      po_number: poNumber,
      status: 'draft',
      po_date: new Date().toISOString().slice(0, 10),
      expected_delivery_date: input.expectedDeliveryDate || null,
      payment_terms_days: input.paymentTermsDays ?? 30,
      subtotal,
      gst_amount: gstTotal,
      total_amount: totalAmount,
      amount_paid: 0,
      amount_outstanding: totalAmount,
      notes: input.notes || null,
    })
    .select('id')
    .single();

  if (poError) {
    console.error(`${op} PO insert failed:`, { code: poError.code, message: poError.message });
    return { success: false, error: poError.message };
  }

  // Create line items
  const lineItemRows = input.lineItems.map((item, idx) => {
    const lineTotal = item.quantity * item.unitPrice;
    const lineGst = lineTotal * (item.gstRate / 100);
    return {
      purchase_order_id: po.id,
      line_number: idx + 1,
      item_category: item.itemCategory,
      item_description: item.itemDescription,
      brand: item.brand || null,
      unit: item.unit,
      quantity_ordered: item.quantity,
      quantity_pending: item.quantity,
      unit_price: item.unitPrice,
      total_price: lineTotal,
      gst_rate: item.gstRate,
      gst_amount: lineGst,
    };
  });

  const { error: itemsError } = await supabase
    .from('purchase_order_items')
    .insert(lineItemRows);

  if (itemsError) {
    console.error(`${op} Line items insert failed:`, { code: itemsError.code, message: itemsError.message });
    // PO created but items failed — still return success with warning
    return { success: true, poId: po.id, error: `PO created but line items failed: ${itemsError.message}` };
  }

  revalidatePath('/procurement');
  return { success: true, poId: po.id };
}
