/**
 * Column configuration for the HubSpot-style data table.
 * Each entity (leads, proposals, etc.) defines its available columns here.
 */

export interface ColumnDef {
  key: string;
  label: string;
  /** Which DB field this maps to (for sorting) */
  sortKey?: string;
  /** Is this column visible by default? */
  defaultVisible: boolean;
  /** Column width hint */
  width?: string;
  /** Can this column be sorted? */
  sortable?: boolean;
  /** Can this cell be inline-edited? */
  editable?: boolean;
  /** Field type for inline edit and filter operators */
  fieldType: 'text' | 'number' | 'date' | 'select' | 'badge' | 'currency' | 'phone' | 'email' | 'link';
  /** Options for select-type fields */
  options?: { value: string; label: string }[];
  /** Format function name (handled in renderer) */
  format?: 'date' | 'datetime' | 'currency' | 'percentage' | 'phone';
  /** Is this a frozen/pinned column? */
  frozen?: boolean;
}

export type EntityType = 'leads' | 'proposals' | 'projects' | 'contacts' | 'companies' | 'vendors' | 'purchase_orders' | 'bom_items';

// ── Leads columns ──

export const LEAD_COLUMNS: ColumnDef[] = [
  { key: 'customer_name', label: 'Customer Name', sortKey: 'customer_name', defaultVisible: true, sortable: true, editable: true, fieldType: 'text', frozen: true },
  { key: 'phone', label: 'Phone', defaultVisible: true, sortable: false, editable: true, fieldType: 'phone' },
  { key: 'email', label: 'Email', defaultVisible: false, sortable: false, editable: true, fieldType: 'email' },
  { key: 'city', label: 'City', sortKey: 'city', defaultVisible: true, sortable: true, editable: true, fieldType: 'text' },
  { key: 'state', label: 'State', defaultVisible: false, sortable: true, editable: true, fieldType: 'text' },
  { key: 'segment', label: 'Segment', sortKey: 'segment', defaultVisible: true, sortable: true, editable: true, fieldType: 'select',
    options: [{ value: 'residential', label: 'Residential' }, { value: 'commercial', label: 'Commercial' }, { value: 'industrial', label: 'Industrial' }] },
  { key: 'source', label: 'Source', sortKey: 'source', defaultVisible: true, sortable: true, editable: true, fieldType: 'select',
    options: [
      { value: 'referral', label: 'Referral' }, { value: 'website', label: 'Website' },
      { value: 'builder_tie_up', label: 'Builder Tie-up' }, { value: 'channel_partner', label: 'Channel Partner' },
      { value: 'cold_call', label: 'Cold Call' }, { value: 'exhibition', label: 'Exhibition' },
      { value: 'social_media', label: 'Social Media' }, { value: 'walkin', label: 'Walk-in' },
    ] },
  // Lead status options must stay in sync with the stage-bar nav
  // (lead-stage-nav.tsx STAGE_ORDER) and leads-helpers.ts STAGE_LABELS.
  // Legacy/terminal values (proposal_sent, converted, disqualified) are
  // intentionally NOT offered here — they exist in the enum for historical
  // rows and triggers, not for user-driven edits.
  { key: 'status', label: 'Status', sortKey: 'status', defaultVisible: true, sortable: true, editable: true, fieldType: 'badge',
    options: [
      { value: 'new', label: 'New' },
      { value: 'contacted', label: 'Contacted' },
      // Path A (Quick)
      { value: 'quick_quote_sent', label: 'Quick Quote Sent' },
      // Path B (Detailed)
      { value: 'site_survey_scheduled', label: 'Survey Scheduled' },
      { value: 'site_survey_done', label: 'Survey Done' },
      { value: 'design_in_progress', label: 'Design In Progress' },
      { value: 'design_confirmed', label: 'Design Confirmed' },
      { value: 'detailed_proposal_sent', label: 'Detailed Proposal Sent' },
      // Shared tail
      { value: 'negotiation', label: 'Negotiation' },
      { value: 'closure_soon', label: 'Closure Soon' },
      { value: 'won', label: 'Won' },
      { value: 'lost', label: 'Lost' },
      { value: 'on_hold', label: 'On Hold' },
    ] },
  { key: 'assigned_to_name', label: 'Assigned To', defaultVisible: true, sortable: false, editable: false, fieldType: 'text' },
  { key: 'created_at', label: 'Created', sortKey: 'created_at', defaultVisible: true, sortable: true, editable: false, fieldType: 'date', format: 'date' },
  { key: 'estimated_size_kwp', label: 'System Size (kWp)', sortKey: 'estimated_size_kwp', defaultVisible: false, sortable: true, editable: true, fieldType: 'number' },
  { key: 'address_line1', label: 'Address', defaultVisible: false, sortable: false, editable: true, fieldType: 'text' },
  { key: 'pincode', label: 'Pincode', defaultVisible: false, sortable: true, editable: true, fieldType: 'text' },
  { key: 'is_qualified', label: 'Qualified', defaultVisible: false, sortable: true, editable: false, fieldType: 'select',
    options: [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }] },
  { key: 'expected_close_date', label: 'Expected Close', sortKey: 'expected_close_date', defaultVisible: true, sortable: true, editable: true, fieldType: 'date', format: 'date' },
  { key: 'close_probability', label: 'Probability %', sortKey: 'close_probability', defaultVisible: true, sortable: true, editable: true, fieldType: 'number', format: 'percentage' },
  { key: 'weighted_value', label: 'Weighted Value', defaultVisible: false, sortable: false, editable: false, fieldType: 'currency', format: 'currency' },
  { key: 'next_followup_date', label: 'Next Follow-up', sortKey: 'next_followup_date', defaultVisible: true, sortable: true, editable: true, fieldType: 'date', format: 'date' },
];

// ── Proposals columns ──

export const PROPOSAL_COLUMNS: ColumnDef[] = [
  { key: 'proposal_number', label: 'Proposal #', sortKey: 'proposal_number', defaultVisible: true, sortable: true, editable: false, fieldType: 'link', frozen: true },
  { key: 'customer_name', label: 'Customer', defaultVisible: true, sortable: true, editable: false, fieldType: 'text' },
  { key: 'proposal_type', label: 'Type', sortKey: 'is_budgetary', defaultVisible: true, sortable: true, editable: false, fieldType: 'select',
    options: [{ value: 'detailed', label: 'Detailed' }, { value: 'budgetary', label: 'Budgetary' }] },
  { key: 'system_type', label: 'System', sortKey: 'system_type', defaultVisible: true, sortable: true, editable: true, fieldType: 'select',
    options: [{ value: 'on_grid', label: 'On-Grid' }, { value: 'hybrid', label: 'Hybrid' }, { value: 'off_grid', label: 'Off-Grid' }] },
  { key: 'system_size_kwp', label: 'Size (kWp)', sortKey: 'system_size_kwp', defaultVisible: true, sortable: true, editable: true, fieldType: 'number' },
  { key: 'total_price', label: 'Total Price', sortKey: 'total_price', defaultVisible: true, sortable: true, editable: true, fieldType: 'currency', format: 'currency' },
  { key: 'margin_pct', label: 'Margin %', sortKey: 'margin_pct', defaultVisible: true, sortable: true, editable: false, fieldType: 'number', format: 'percentage' },
  { key: 'status', label: 'Status', sortKey: 'status', defaultVisible: true, sortable: true, editable: true, fieldType: 'badge',
    options: [
      { value: 'draft', label: 'Draft' }, { value: 'sent', label: 'Sent' }, { value: 'accepted', label: 'Accepted' },
      { value: 'rejected', label: 'Rejected' }, { value: 'expired', label: 'Expired' }, { value: 'revised', label: 'Revised' },
    ] },
  { key: 'created_at', label: 'Created', sortKey: 'created_at', defaultVisible: true, sortable: true, editable: false, fieldType: 'date', format: 'date' },
  { key: 'valid_until', label: 'Valid Until', sortKey: 'valid_until', defaultVisible: true, sortable: true, editable: true, fieldType: 'date', format: 'date' },
  { key: 'revision_number', label: 'Revision', defaultVisible: false, sortable: true, editable: false, fieldType: 'number' },
  { key: 'is_budgetary', label: 'Budgetary?', defaultVisible: false, sortable: true, editable: false, fieldType: 'select',
    options: [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }] },
];

// ── Projects columns ──

export const PROJECT_COLUMNS: ColumnDef[] = [
  { key: 'project_number', label: 'Project #', sortKey: 'project_number', defaultVisible: true, sortable: true, editable: false, fieldType: 'link', frozen: true },
  { key: 'customer_name', label: 'Customer', sortKey: 'customer_name', defaultVisible: true, sortable: true, editable: true, fieldType: 'link' },
  { key: 'site_city', label: 'Location', sortKey: 'site_city', defaultVisible: true, sortable: true, editable: true, fieldType: 'text' },
  { key: 'system_size_kwp', label: 'Size (kWp)', sortKey: 'system_size_kwp', defaultVisible: true, sortable: true, editable: true, fieldType: 'number' },
  { key: 'status', label: 'Status', sortKey: 'status', defaultVisible: true, sortable: true, editable: true, fieldType: 'badge',
    options: [
      { value: 'order_received', label: 'Order Received' },
      { value: 'yet_to_start', label: 'Yet to Start' },
      { value: 'in_progress', label: 'In Progress' },
      { value: 'completed', label: 'Completed' },
      { value: 'holding_shiroi', label: 'Holding from Shiroi' },
      { value: 'holding_client', label: 'Holding from Client' },
      { value: 'waiting_net_metering', label: 'Waiting for Net Metering' },
      { value: 'meter_client_scope', label: 'Meter - Client Scope' },
    ] },
  { key: 'year', label: 'Year', sortKey: 'created_at', defaultVisible: true, sortable: true, editable: false, fieldType: 'text' },
  { key: 'remarks', label: 'Remarks', defaultVisible: false, sortable: false, editable: true, fieldType: 'text' },
  { key: 'system_type', label: 'System Type', sortKey: 'system_type', defaultVisible: false, sortable: true, editable: true, fieldType: 'select',
    options: [{ value: 'on_grid', label: 'On-Grid' }, { value: 'hybrid', label: 'Hybrid' }, { value: 'off_grid', label: 'Off-Grid' }] },
  { key: 'contracted_value', label: 'Contract Value', sortKey: 'contracted_value', defaultVisible: false, sortable: true, editable: true, fieldType: 'currency', format: 'currency' },
  { key: 'project_manager_name', label: 'PM', defaultVisible: false, sortable: false, editable: false, fieldType: 'text' },
  { key: 'created_at', label: 'Created', sortKey: 'created_at', defaultVisible: false, sortable: true, editable: false, fieldType: 'date', format: 'date' },
  { key: 'advance_amount', label: 'Advance', sortKey: 'advance_amount', defaultVisible: false, sortable: true, editable: true, fieldType: 'currency', format: 'currency' },
  { key: 'customer_phone', label: 'Phone', defaultVisible: false, sortable: false, editable: true, fieldType: 'phone' },
  { key: 'site_state', label: 'State', defaultVisible: false, sortable: true, editable: true, fieldType: 'text' },
];

// ── Contacts columns ──

export const CONTACT_COLUMNS: ColumnDef[] = [
  { key: 'name', label: 'Name', sortKey: 'name', defaultVisible: true, sortable: true, editable: false, fieldType: 'link', frozen: true },
  { key: 'first_name', label: 'First Name', defaultVisible: false, sortable: true, editable: true, fieldType: 'text' },
  { key: 'last_name', label: 'Last Name', defaultVisible: false, sortable: true, editable: true, fieldType: 'text' },
  { key: 'phone', label: 'Phone', defaultVisible: true, sortable: false, editable: true, fieldType: 'phone' },
  { key: 'secondary_phone', label: 'Secondary Phone', defaultVisible: false, sortable: false, editable: true, fieldType: 'phone' },
  { key: 'email', label: 'Email', defaultVisible: true, sortable: false, editable: true, fieldType: 'email' },
  { key: 'designation', label: 'Designation', defaultVisible: true, sortable: true, editable: true, fieldType: 'text' },
  { key: 'lifecycle_stage', label: 'Stage', sortKey: 'lifecycle_stage', defaultVisible: true, sortable: true, editable: true, fieldType: 'select',
    options: [
      { value: 'subscriber', label: 'Subscriber' }, { value: 'lead', label: 'Lead' },
      { value: 'opportunity', label: 'Opportunity' }, { value: 'customer', label: 'Customer' },
      { value: 'evangelist', label: 'Evangelist' },
    ] },
  { key: 'company_name', label: 'Company', defaultVisible: true, sortable: false, editable: false, fieldType: 'text' },
  { key: 'source', label: 'Source', defaultVisible: false, sortable: true, editable: true, fieldType: 'text' },
  { key: 'created_at', label: 'Created', sortKey: 'created_at', defaultVisible: false, sortable: true, editable: false, fieldType: 'date', format: 'date' },
];

// ── Companies columns ──

export const COMPANY_COLUMNS: ColumnDef[] = [
  { key: 'name', label: 'Company Name', sortKey: 'name', defaultVisible: true, sortable: true, editable: true, fieldType: 'link', frozen: true },
  { key: 'segment', label: 'Segment', sortKey: 'segment', defaultVisible: true, sortable: true, editable: true, fieldType: 'select',
    options: [{ value: 'residential', label: 'Residential' }, { value: 'commercial', label: 'Commercial' }, { value: 'industrial', label: 'Industrial' }] },
  { key: 'city', label: 'City', sortKey: 'city', defaultVisible: true, sortable: true, editable: true, fieldType: 'text' },
  { key: 'gstin', label: 'GSTIN', defaultVisible: true, sortable: false, editable: true, fieldType: 'text' },
  { key: 'industry', label: 'Industry', sortKey: 'industry', defaultVisible: false, sortable: true, editable: true, fieldType: 'text' },
  { key: 'state', label: 'State', defaultVisible: false, sortable: true, editable: false, fieldType: 'text' },
  { key: 'created_at', label: 'Created', sortKey: 'created_at', defaultVisible: false, sortable: true, editable: false, fieldType: 'date', format: 'date' },
];

// ── Vendors columns ──

export const VENDOR_COLUMNS: ColumnDef[] = [
  { key: 'vendor_code', label: 'Vendor Code', sortKey: 'vendor_code', defaultVisible: true, sortable: true, editable: false, fieldType: 'text', frozen: true },
  { key: 'company_name', label: 'Company', sortKey: 'company_name', defaultVisible: true, sortable: true, editable: true, fieldType: 'text' },
  { key: 'contact_person', label: 'Contact', defaultVisible: true, sortable: false, editable: true, fieldType: 'text' },
  { key: 'phone', label: 'Phone', defaultVisible: true, sortable: false, editable: true, fieldType: 'phone' },
  { key: 'email', label: 'Email', defaultVisible: false, sortable: false, editable: true, fieldType: 'email' },
  { key: 'city', label: 'City', sortKey: 'city', defaultVisible: true, sortable: true, editable: true, fieldType: 'text' },
  { key: 'gstin', label: 'GSTIN', defaultVisible: true, sortable: false, editable: true, fieldType: 'text' },
  { key: 'vendor_type', label: 'Type', sortKey: 'vendor_type', defaultVisible: true, sortable: true, editable: true, fieldType: 'select',
    options: [
      { value: 'panel_supplier', label: 'Panel' }, { value: 'inverter_supplier', label: 'Inverter' },
      { value: 'structure_supplier', label: 'Structure' }, { value: 'cable_supplier', label: 'Cable' },
      { value: 'electrical_supplier', label: 'Electrical' }, { value: 'civil_contractor', label: 'Civil' },
      { value: 'labour_contractor', label: 'Labour' }, { value: 'transport', label: 'Transport' },
      { value: 'other', label: 'Other' },
    ] },
  { key: 'is_msme', label: 'MSME', defaultVisible: true, sortable: true, editable: true, fieldType: 'select',
    options: [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }] },
  { key: 'is_active', label: 'Active', defaultVisible: true, sortable: true, editable: true, fieldType: 'select',
    options: [{ value: 'true', label: 'Active' }, { value: 'false', label: 'Inactive' }] },
  { key: 'state', label: 'State', defaultVisible: false, sortable: true, editable: true, fieldType: 'text' },
  { key: 'payment_terms_days', label: 'Payment Terms (days)', defaultVisible: false, sortable: true, editable: true, fieldType: 'number' },
  { key: 'notes', label: 'Notes', defaultVisible: false, sortable: false, editable: true, fieldType: 'text' },
];

// ── Purchase Order columns ──

export const PURCHASE_ORDER_COLUMNS: ColumnDef[] = [
  { key: 'po_number', label: 'PO #', sortKey: 'po_number', defaultVisible: true, sortable: true, editable: false, fieldType: 'text', frozen: true },
  { key: 'vendor_name', label: 'Vendor', defaultVisible: true, sortable: false, editable: false, fieldType: 'text' },
  { key: 'project_number', label: 'Project', defaultVisible: true, sortable: false, editable: false, fieldType: 'text' },
  { key: 'status', label: 'Status', sortKey: 'status', defaultVisible: true, sortable: true, editable: true, fieldType: 'badge',
    options: [
      { value: 'draft', label: 'Draft' }, { value: 'approved', label: 'Approved' },
      { value: 'partially_delivered', label: 'Partial' }, { value: 'fully_delivered', label: 'Delivered' },
      { value: 'cancelled', label: 'Cancelled' },
    ] },
  { key: 'total_amount', label: 'Total', sortKey: 'total_amount', defaultVisible: true, sortable: true, editable: false, fieldType: 'currency', format: 'currency' },
  { key: 'expected_delivery_date', label: 'Expected Delivery', sortKey: 'expected_delivery_date', defaultVisible: true, sortable: true, editable: true, fieldType: 'date', format: 'date' },
  { key: 'notes', label: 'Notes', defaultVisible: false, sortable: false, editable: true, fieldType: 'text' },
  { key: 'created_at', label: 'Created', sortKey: 'created_at', defaultVisible: false, sortable: true, editable: false, fieldType: 'date', format: 'date' },
];

// ── BOM Item columns (for /bom-review) ──

export const BOM_ITEM_COLUMNS: ColumnDef[] = [
  { key: 'item_description', label: 'Item', defaultVisible: true, sortable: true, editable: true, fieldType: 'text', frozen: true },
  { key: 'item_category', label: 'Category', sortKey: 'item_category', defaultVisible: true, sortable: true, editable: true, fieldType: 'select',
    options: [
      { value: 'panel', label: 'Panel' }, { value: 'inverter', label: 'Inverter' },
      { value: 'battery', label: 'Battery' }, { value: 'structure', label: 'Structure' },
      { value: 'dc_cable', label: 'DC Cable' }, { value: 'ac_cable', label: 'AC Cable' },
      { value: 'conduit', label: 'Conduit' }, { value: 'earthing', label: 'Earthing' },
      { value: 'acdb', label: 'ACDB' }, { value: 'dcdb', label: 'DCDB' },
      { value: 'net_meter', label: 'Net Meter' }, { value: 'civil_work', label: 'Civil Work' },
      { value: 'installation_labour', label: 'Installation Labour' }, { value: 'transport', label: 'Transport' },
      { value: 'other', label: 'Other' },
      { value: 'solar_panels', label: 'Solar Panels' }, { value: 'mms', label: 'MMS' },
      { value: 'dc_accessories', label: 'DC Accessories' }, { value: 'ac_accessories', label: 'AC Accessories' },
      { value: 'conduits', label: 'Conduits' }, { value: 'miscellaneous', label: 'Misc' },
      { value: 'safety', label: 'Safety' }, { value: 'generation_meter', label: 'Gen Meter' },
      { value: 'installation_and_commissioning', label: 'I&C' }, { value: 'statutory', label: 'Statutory' },
      { value: 'transport_and_civil', label: 'Transport & Civil' }, { value: 'others', label: 'Others' },
    ] },
  { key: 'quantity', label: 'Qty', defaultVisible: true, sortable: true, editable: true, fieldType: 'number' },
  { key: 'unit', label: 'Unit', defaultVisible: true, sortable: false, editable: true, fieldType: 'text' },
  { key: 'unit_price', label: 'Rate', defaultVisible: true, sortable: true, editable: true, fieldType: 'currency', format: 'currency' },
  { key: 'gst_rate', label: 'GST %', defaultVisible: true, sortable: false, editable: true, fieldType: 'number', format: 'percentage' },
  { key: 'total_price', label: 'Total', defaultVisible: true, sortable: true, editable: false, fieldType: 'currency', format: 'currency' },
  { key: 'brand', label: 'Brand', defaultVisible: false, sortable: true, editable: true, fieldType: 'text' },
  { key: 'proposal_number', label: 'Proposal', defaultVisible: true, sortable: false, editable: false, fieldType: 'text' },
];

// ── Column registry ──

export const ENTITY_COLUMNS: Record<EntityType, ColumnDef[]> = {
  leads: LEAD_COLUMNS,
  proposals: PROPOSAL_COLUMNS,
  projects: PROJECT_COLUMNS,
  contacts: CONTACT_COLUMNS,
  companies: COMPANY_COLUMNS,
  vendors: VENDOR_COLUMNS,
  purchase_orders: PURCHASE_ORDER_COLUMNS,
  bom_items: BOM_ITEM_COLUMNS,
};

/** Get default visible columns for an entity */
export function getDefaultColumns(entityType: EntityType): string[] {
  return ENTITY_COLUMNS[entityType]
    .filter((c) => c.defaultVisible)
    .map((c) => c.key);
}
