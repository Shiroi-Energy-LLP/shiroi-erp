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
// Purchase Request (project-level procurement view)
// ---------------------------------------------------------------------------

export interface PurchaseRequestItem {
  project_id: string;
  project_number: string;
  customer_name: string;
  boq_sent_to_purchase_at: string | null;
  procurement_status: string | null;
  procurement_priority: string | null;
  procurement_received_date: string | null;
  total_amount: number;
  total_with_tax: number;
  item_count: number;
  po_count: number;
  items_yet_to_place: number;
  items_order_placed: number;
  items_received: number;
  items_ready: number;
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export interface ProcurementFilters {
  status?: string;
  projectId?: string;
  vendorId?: string;
  search?: string;
  priority?: string;
  page?: number;
  per_page?: number;
}

// ---------------------------------------------------------------------------
// Purchase Requests — project-centric procurement view
// ---------------------------------------------------------------------------

export async function getPurchaseRequests(filters: ProcurementFilters = {}): Promise<{
  items: PurchaseRequestItem[];
  total: number;
}> {
  const op = '[getPurchaseRequests]';
  console.log(`${op} Starting`);

  const supabase = await createClient();
  const page = filters.page || 1;
  const perPage = filters.per_page || 50;
  const from = (page - 1) * perPage;
  const to = from + perPage - 1;

  // Get projects that have been sent to purchase
  let query = supabase
    .from('projects')
    .select(
      'id, project_number, customer_name, boq_sent_to_purchase_at, procurement_status, procurement_priority, procurement_received_date',
      { count: 'estimated' },
    )
    .not('procurement_status', 'is', null)
    .order('boq_sent_to_purchase_at', { ascending: false, nullsFirst: false })
    .range(from, to);

  if (filters.status) query = query.eq('procurement_status', filters.status);
  if (filters.priority) query = query.eq('procurement_priority', filters.priority);
  if (filters.projectId) query = query.eq('id', filters.projectId);
  if (filters.search)
    query = query.or(
      `project_number.ilike.%${filters.search}%,customer_name.ilike.%${filters.search}%`,
    );

  const { data: projects, error, count } = await query;
  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    throw new Error(`Failed to load purchase requests: ${error.message}`);
  }

  if (!projects || projects.length === 0) {
    return { items: [], total: 0 };
  }

  const projectIds = projects.map((p) => p.id);

  // Fetch BOQ item aggregates per project
  const { data: boqAggs } = await supabase
    .from('project_boq_items')
    .select('project_id, procurement_status, quantity, unit_price, gst_rate, total_price')
    .in('project_id', projectIds)
    .neq('procurement_status', 'yet_to_finalize');

  // Fetch PO count per project
  const { data: poRows } = await supabase
    .from('purchase_orders')
    .select('project_id')
    .in('project_id', projectIds)
    .neq('status', 'cancelled');

  // Build aggregates
  const boqByProject: Record<string, {
    totalAmount: number;
    totalWithTax: number;
    count: number;
    yetToPlace: number;
    orderPlaced: number;
    received: number;
    ready: number;
  }> = {};

  for (const item of boqAggs ?? []) {
    const pid = item.project_id;
    if (!boqByProject[pid]) {
      boqByProject[pid] = { totalAmount: 0, totalWithTax: 0, count: 0, yetToPlace: 0, orderPlaced: 0, received: 0, ready: 0 };
    }
    const qty = Number(item.quantity || 0);
    const rate = Number(item.unit_price || 0);
    const amt = qty * rate;
    boqByProject[pid].totalAmount += amt;
    boqByProject[pid].totalWithTax += Number(item.total_price || 0);
    boqByProject[pid].count++;
    if (item.procurement_status === 'yet_to_place') boqByProject[pid].yetToPlace++;
    if (item.procurement_status === 'order_placed') boqByProject[pid].orderPlaced++;
    if (item.procurement_status === 'received') boqByProject[pid].received++;
    if (item.procurement_status === 'ready_to_dispatch' || item.procurement_status === 'delivered')
      boqByProject[pid].ready++;
  }

  const poCountByProject: Record<string, number> = {};
  for (const po of poRows ?? []) {
    poCountByProject[po.project_id] = (poCountByProject[po.project_id] || 0) + 1;
  }

  const items: PurchaseRequestItem[] = projects.map((p) => {
    const agg = boqByProject[p.id] || { totalAmount: 0, totalWithTax: 0, count: 0, yetToPlace: 0, orderPlaced: 0, received: 0, ready: 0 };
    return {
      project_id: p.id,
      project_number: p.project_number ?? '',
      customer_name: p.customer_name ?? '',
      boq_sent_to_purchase_at: p.boq_sent_to_purchase_at,
      procurement_status: p.procurement_status,
      procurement_priority: p.procurement_priority,
      procurement_received_date: p.procurement_received_date,
      total_amount: agg.totalAmount,
      total_with_tax: agg.totalWithTax,
      item_count: agg.count,
      po_count: poCountByProject[p.id] || 0,
      items_yet_to_place: agg.yetToPlace,
      items_order_placed: agg.orderPlaced,
      items_received: agg.received,
      items_ready: agg.ready,
    };
  });

  return { items, total: count ?? 0 };
}

// ---------------------------------------------------------------------------
// Purchase Request Detail — BOQ items for a project + POs
// ---------------------------------------------------------------------------

export interface PurchaseDetailItem {
  id: string;
  line_number: number;
  item_category: string;
  item_description: string;
  brand: string | null;
  model: string | null;
  hsn_code: string | null;
  quantity: number;
  unit: string;
  unit_price: number;
  gst_rate: number;
  total_price: number;
  procurement_status: string;
  vendor_id: string | null;
  vendor_name: string | null;
  purchase_order_id: string | null;
}

export async function getPurchaseDetail(projectId: string): Promise<{
  project: { id: string; project_number: string; customer_name: string; procurement_status: string | null; procurement_priority: string | null };
  items: PurchaseDetailItem[];
  purchaseOrders: POListItem[];
  vendors: { id: string; company_name: string }[];
}> {
  const op = '[getPurchaseDetail]';
  console.log(`${op} Starting for: ${projectId}`);

  const supabase = await createClient();

  const [projectRes, itemsRes, posRes, vendorsRes] = await Promise.all([
    supabase
      .from('projects')
      .select('id, project_number, customer_name, procurement_status, procurement_priority')
      .eq('id', projectId)
      .single(),
    supabase
      .from('project_boq_items')
      .select('id, line_number, item_category, item_description, brand, model, hsn_code, quantity, unit, unit_price, gst_rate, total_price, procurement_status, vendor_id, vendor_name, purchase_order_id')
      .eq('project_id', projectId)
      .neq('procurement_status', 'yet_to_finalize')
      .order('line_number'),
    supabase
      .from('purchase_orders')
      .select('*, vendors!purchase_orders_vendor_id_fkey(company_name, is_msme), projects!purchase_orders_project_id_fkey(project_number, customer_name)')
      .eq('project_id', projectId)
      .neq('status', 'cancelled')
      .order('created_at', { ascending: false }),
    supabase
      .from('vendors')
      .select('id, company_name')
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('company_name')
      .limit(200),
  ]);

  if (projectRes.error) throw new Error(`Failed to load project: ${projectRes.error.message}`);
  if (!projectRes.data) throw new Error(`Project not found: ${projectId}`);

  return {
    project: projectRes.data as any,
    items: (itemsRes.data ?? []) as unknown as PurchaseDetailItem[],
    purchaseOrders: (posRes.data ?? []) as unknown as POListItem[],
    vendors: vendorsRes.data ?? [],
  };
}

// ---------------------------------------------------------------------------
// Existing PO Queries (preserved for PO detail page)
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
    .order('po_date', { ascending: false })
    .limit(100);

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

  const allPOs = (data ?? []) as unknown as POListItem[];
  return allPOs.filter((po) => po.vendors?.is_msme === true);
}

export async function getVendorsList(): Promise<Pick<VendorRow, 'id' | 'company_name'>[]> {
  const op = '[getVendorsList]';
  console.log(`${op} Starting`);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('vendors')
    .select('id, company_name')
    .eq('is_active', true)
    .is('deleted_at', null)
    .order('company_name')
    .limit(200);

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    throw new Error(`Failed to load vendors list: ${error.message}`);
  }

  return data ?? [];
}

export async function getProjectsList(): Promise<Pick<ProjectRow, 'id' | 'project_number' | 'customer_name'>[]> {
  const op = '[getProjectsList]';
  console.log(`${op} Starting`);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('projects')
    .select('id, project_number, customer_name')
    .order('project_number', { ascending: false })
    .limit(200);

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    throw new Error(`Failed to load projects list: ${error.message}`);
  }

  return data ?? [];
}
