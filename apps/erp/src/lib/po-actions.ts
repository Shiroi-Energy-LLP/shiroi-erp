'use server';

import { createClient } from '@repo/supabase/server';
import { revalidatePath } from 'next/cache';

export async function updatePoLineItemRate(input: {
  poId: string;
  itemId: string;
  newRate: number;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[updatePoLineItemRate]';
  console.log(`${op} Updating rate for PO item ${input.itemId} to ${input.newRate}`);

  const supabase = await createClient();

  // Fetch current item to get quantity_ordered and gst_rate
  const { data: item, error: fetchErr } = await supabase
    .from('purchase_order_items')
    .select('quantity_ordered, gst_rate')
    .eq('id', input.itemId)
    .single();

  if (fetchErr || !item) {
    console.error(`${op} Item fetch failed:`, fetchErr);
    return { success: false, error: 'Item not found' };
  }

  const qty = Number(item.quantity_ordered);
  const totalPrice = input.newRate * qty;
  const gstRate = Number(item.gst_rate ?? 18);
  const gstAmount = totalPrice * (gstRate / 100);

  // Update item
  const { error: updateErr } = await supabase
    .from('purchase_order_items')
    .update({
      unit_price: input.newRate,
      total_price: totalPrice,
      gst_amount: gstAmount,
    })
    .eq('id', input.itemId);

  if (updateErr) {
    console.error(`${op} Update failed:`, { code: updateErr.code, message: updateErr.message });
    return { success: false, error: updateErr.message };
  }

  // Recalculate PO totals from all items
  const { data: allItems } = await supabase
    .from('purchase_order_items')
    .select('total_price, gst_amount')
    .eq('purchase_order_id', input.poId);

  const subtotal = (allItems ?? []).reduce((sum, i) => sum + Number(i.total_price ?? 0), 0);
  const totalGst = (allItems ?? []).reduce((sum, i) => sum + Number(i.gst_amount ?? 0), 0);
  const totalAmount = subtotal + totalGst;

  const { error: poUpdateErr } = await supabase
    .from('purchase_orders')
    .update({
      subtotal,
      gst_amount: totalGst,
      total_amount: totalAmount,
    })
    .eq('id', input.poId);

  if (poUpdateErr) {
    console.error(`${op} PO total recalculation failed:`, { code: poUpdateErr.code, message: poUpdateErr.message });
    // Non-fatal — item was already updated; return success with a note
  }

  revalidatePath(`/procurement/${input.poId}`);
  return { success: true };
}

// Note: purchase_orders has no deleted_at column.
// Soft delete is implemented by setting status to 'cancelled'.
export async function deletePoSoft(poId: string): Promise<{ success: boolean; error?: string }> {
  const op = '[deletePoSoft]';
  console.log(`${op} Soft-deleting PO ${poId}`);

  const supabase = await createClient();

  const { error } = await supabase
    .from('purchase_orders')
    .update({ status: 'cancelled' })
    .eq('id', poId);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath('/procurement');
  return { success: true };
}
