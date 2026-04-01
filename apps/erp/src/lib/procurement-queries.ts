import { createClient } from '@repo/supabase/server';
import type { Database } from '@repo/types/database';

type PurchaseOrderRow = Database['public']['Tables']['purchase_orders']['Row'];
type VendorRow = Database['public']['Tables']['vendors']['Row'];
type ProjectRow = Database['public']['Tables']['projects']['Row'];
type POItemRow = Database['public']['Tables']['purchase_order_items']['Row'];
type VendorDCRow = Database['public']['Tables']['vendor_delivery_challans']['Row'];
type VendorDCItemRow = Database['public']['Tables']['vendor_delivery_challan_items']['Row'];
type GRNRow = Database['public']['Tables']['goods_receipt_notes']['Row'];
type GRNItemRow = Database['public']['Tables']['grn_items']['Row'];
type VendorPaymentRow = Database['public']['Tables']['vendor_payments']['Row'];

// ---------------------------------------------------------------------------
// List types (joined shapes returned from queries)
// ---------------------------------------------------------------------------

export interface POListItem extends PurchaseOrderRow {
  vendors: Pick<VendorRow, 'company_name' | 'is_msme'> | null;
  projects: Pick<ProjectRow, 'project_number' | 'customer_name'> | null;
}

export interface PODetail extends PurchaseOrderRow {
  vendors: Pick<VendorRow, 'company_name' | 'is_msme' | 'contact_person' | 'email' | 'phone' | 'gstin'> | null;
  projects: Pick<ProjectRow, 'project_number' | 'customer_name'> | null;
  purchase_order_items: POItemRow[];
  vendor_delivery_challans: (VendorDCRow & {
    vendor_delivery_challan_items: VendorDCItemRow[];
    goods_receipt_notes: (GRNRow & {
      grn_items: GRNItemRow[];
    })[];
  })[];
  vendor_payments: VendorPaymentRow[];
  preparer: { full_name: string } | null;
  approver: { full_name: string } | null;
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export interface ProcurementFilters {
  status?: string;
  projectId?: string;
  vendorId?: string;
  search?: string;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function getPurchaseOrders(filters: ProcurementFilters = {}): Promise<POListItem[]> {
  const op = '[getPurchaseOrders]';
  console.log(`${op} Starting`);

  const supabase = await createClient();
  let query = supabase
    .from('purchase_orders')
    .select(
      '*, vendors!purchase_orders_vendor_id_fkey(company_name, is_msme), projects!purchase_orders_project_id_fkey(project_number, customer_name)',
    )
    .order('po_date', { ascending: false });

  if (filters.status) {
    query = query.eq('status', filters.status);
  }
  if (filters.projectId) {
    query = query.eq('project_id', filters.projectId);
  }
  if (filters.vendorId) {
    query = query.eq('vendor_id', filters.vendorId);
  }
  if (filters.search) {
    query = query.or(
      `po_number.ilike.%${filters.search}%`,
    );
  }

  const { data, error } = await query;

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    throw new Error(`Failed to load purchase orders: ${error.message}`);
  }

  return (data ?? []) as unknown as POListItem[];
}

export async function getPurchaseOrder(id: string): Promise<PODetail | null> {
  const op = '[getPurchaseOrder]';
  console.log(`${op} Starting for: ${id}`);
  if (!id) throw new Error(`${op} Missing required parameter: id`);

  const supabase = await createClient();

  const { data, error } = await supabase
    .from('purchase_orders')
    .select(
      `*,
       vendors!purchase_orders_vendor_id_fkey(company_name, is_msme, contact_person, email, phone, gstin),
       projects!purchase_orders_project_id_fkey(project_number, customer_name),
       preparer:employees!purchase_orders_prepared_by_fkey(full_name),
       approver:employees!purchase_orders_approved_by_fkey(full_name),
       purchase_order_items(*),
       vendor_delivery_challans!vendor_delivery_challans_purchase_order_id_fkey(
         *,
         vendor_delivery_challan_items(*),
         goods_receipt_notes!goods_receipt_notes_vendor_dc_id_fkey(
           *,
           grn_items(*)
         )
       ),
       vendor_payments!vendor_payments_purchase_order_id_fkey(*)`
    )
    .eq('id', id)
    .single();

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message, id });
    throw new Error(`Failed to load purchase order: ${error.message}`);
  }
  if (!data) {
    console.warn(`${op} Not found:`, { id });
    return null;
  }

  return data as unknown as PODetail;
}

/**
 * Fetches all MSME-vendor POs that have outstanding amounts and a delivery date,
 * used for the MSME alert banner.
 */
export async function getMSMEAlertPOs(): Promise<POListItem[]> {
  const op = '[getMSMEAlertPOs]';
  console.log(`${op} Starting`);

  const supabase = await createClient();

  const { data, error } = await supabase
    .from('purchase_orders')
    .select(
      '*, vendors!purchase_orders_vendor_id_fkey(company_name, is_msme), projects!purchase_orders_project_id_fkey(project_number, customer_name)',
    )
    .gt('amount_outstanding', 0)
    .not('actual_delivery_date', 'is', null)
    .order('actual_delivery_date', { ascending: true });

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    throw new Error(`Failed to load MSME alert POs: ${error.message}`);
  }

  // Filter to MSME vendors client-side (Supabase doesn't support filtering on joined fields easily)
  const allPOs = (data ?? []) as unknown as POListItem[];
  return allPOs.filter((po) => po.vendors?.is_msme === true);
}

/**
 * Fetches distinct vendors for filter dropdown.
 */
export async function getVendorsList(): Promise<Pick<VendorRow, 'id' | 'company_name'>[]> {
  const op = '[getVendorsList]';
  console.log(`${op} Starting`);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('vendors')
    .select('id, company_name')
    .eq('is_active', true)
    .is('deleted_at', null)
    .order('company_name');

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    throw new Error(`Failed to load vendors list: ${error.message}`);
  }

  return data ?? [];
}

/**
 * Fetches distinct projects for filter dropdown.
 */
export async function getProjectsList(): Promise<Pick<ProjectRow, 'id' | 'project_number' | 'customer_name'>[]> {
  const op = '[getProjectsList]';
  console.log(`${op} Starting`);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('projects')
    .select('id, project_number, customer_name')
    .is('deleted_at', null)
    .order('project_number', { ascending: false });

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    throw new Error(`Failed to load projects list: ${error.message}`);
  }

  return data ?? [];
}
