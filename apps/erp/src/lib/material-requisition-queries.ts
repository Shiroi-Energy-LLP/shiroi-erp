import { createClient } from '@repo/supabase/server';
import type { Database } from '@repo/types/database';

type MatReqRow = Database['public']['Tables']['material_requisitions']['Row'];

export interface MatReqItem {
  description: string;
  quantity: number;
  unit: string;
  notes?: string;
}

export interface MaterialRequisitionDetail extends MatReqRow {
  requester: { full_name: string } | null;
  reviewer: { full_name: string } | null;
  project: { project_number: string; customer_name: string } | null;
  converted_po: { po_number: string } | null;
}

export interface MaterialRequisitionListItem {
  id: string;
  project_id: string;
  urgency: string;
  status: string;
  items: MatReqItem[];
  notes: string | null;
  created_at: string;
  reviewed_at: string | null;
  review_notes: string | null;
  converted_po_id: string | null;
  requester: { full_name: string } | null;
  project: { project_number: string; customer_name: string } | null;
  converted_po: { po_number: string } | null;
}

/**
 * List material requisitions for a project.
 * Ordered newest first.
 */
export async function getMaterialRequisitionsForProject(
  projectId: string,
): Promise<MaterialRequisitionListItem[]> {
  const op = '[getMaterialRequisitionsForProject]';
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('material_requisitions')
    .select(
      `id, project_id, urgency, status, items, notes, created_at, reviewed_at, review_notes,
       converted_po_id,
       requester:employees!material_requisitions_requested_by_fkey(full_name),
       project:projects!material_requisitions_project_id_fkey(project_number, customer_name),
       converted_po:purchase_orders!material_requisitions_converted_po_id_fkey(po_number)`,
    )
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error(`${op} Query failed`, { projectId, code: error.code, message: error.message });
    throw new Error(`Failed to load material requisitions: ${error.message}`);
  }

  return (data ?? []) as unknown as MaterialRequisitionListItem[];
}

/**
 * List all pending material requisitions — for the PM/purchase officer inbox.
 */
export async function getPendingMaterialRequisitions(): Promise<MaterialRequisitionListItem[]> {
  const op = '[getPendingMaterialRequisitions]';
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('material_requisitions')
    .select(
      `id, project_id, urgency, status, items, notes, created_at, reviewed_at, review_notes,
       converted_po_id,
       requester:employees!material_requisitions_requested_by_fkey(full_name),
       project:projects!material_requisitions_project_id_fkey(project_number, customer_name),
       converted_po:purchase_orders!material_requisitions_converted_po_id_fkey(po_number)`,
    )
    .in('status', ['pending', 'approved'])
    .order('urgency', { ascending: false })
    .order('created_at', { ascending: true });

  if (error) {
    console.error(`${op} Query failed`, { code: error.code, message: error.message });
    throw new Error(`Failed to load pending requisitions: ${error.message}`);
  }

  return (data ?? []) as unknown as MaterialRequisitionListItem[];
}

// ---------------------------------------------------------------------------
// PO Bill Reconciliation RPC wrapper
// ---------------------------------------------------------------------------

export interface POBillReconciliationRow {
  po_id: string;
  po_number: string;
  vendor_name: string;
  vendor_is_msme: boolean;
  po_date: string;
  po_total: number;
  approval_status: string;
  po_status: string;
  billed_amount: number;
  paid_amount: number;
  balance: number;
  bill_count: number;
  bill_status: 'unbilled' | 'pending' | 'partial' | 'paid';
}

export async function getPOBillReconciliation(
  projectId: string,
): Promise<POBillReconciliationRow[]> {
  const op = '[getPOBillReconciliation]';
  const supabase = await createClient();

  const { data, error } = await supabase.rpc(
    'fn_get_po_bill_reconciliation',
    { p_project_id: projectId },
  );

  if (error) {
    console.error(`${op} RPC failed`, { projectId, code: error.code, message: error.message });
    throw new Error(`Failed to load PO-bill reconciliation: ${error.message}`);
  }

  return (data ?? []) as unknown as POBillReconciliationRow[];
}

/**
 * Minimal project info for page headers.
 */
export interface ProjectBasicInfo {
  id: string;
  project_number: string;
  customer_name: string;
}

export async function getProjectBasicInfo(
  projectId: string,
): Promise<ProjectBasicInfo | null> {
  const op = '[getProjectBasicInfo]';
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('projects')
    .select('id, project_number, customer_name')
    .eq('id', projectId)
    .maybeSingle();

  if (error) {
    console.error(`${op} Query failed`, { projectId, code: error.code, message: error.message });
    return null;
  }

  return data;
}

/**
 * Fetch vendor bills linked to a specific PO — displayed in the PO detail page
 * "Associated Bills" panel.
 */
export interface POLinkedBill {
  id: string;
  bill_number: string;
  bill_date: string;
  status: string;
  total_amount: number;
  amount_paid: number;
  balance_due: number;
  zoho_bill_id: string | null;
}

export async function getVendorBillsForPO(poId: string): Promise<POLinkedBill[]> {
  const op = '[getVendorBillsForPO]';
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('vendor_bills')
    .select(
      'id, bill_number, bill_date, status, total_amount, amount_paid, balance_due, zoho_bill_id',
    )
    .eq('purchase_order_id', poId)
    .neq('status', 'cancelled')
    .order('bill_date', { ascending: false });

  if (error) {
    console.error(`${op} Query failed`, { poId, code: error.code, message: error.message });
    return [];
  }

  return (data ?? []) as unknown as POLinkedBill[];
}
