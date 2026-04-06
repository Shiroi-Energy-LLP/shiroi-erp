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

export type EntityType = 'leads' | 'proposals' | 'projects' | 'contacts' | 'companies';

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
  { key: 'status', label: 'Status', sortKey: 'status', defaultVisible: true, sortable: true, editable: true, fieldType: 'badge',
    options: [
      { value: 'new', label: 'New' }, { value: 'contacted', label: 'Contacted' },
      { value: 'site_survey_scheduled', label: 'Survey Scheduled' }, { value: 'site_survey_done', label: 'Survey Done' },
      { value: 'proposal_sent', label: 'Proposal Sent' }, { value: 'design_confirmed', label: 'Design Confirmed' },
      { value: 'negotiation', label: 'Negotiation' }, { value: 'won', label: 'Won' },
      { value: 'converted', label: 'Converted' }, { value: 'lost', label: 'Lost' },
      { value: 'on_hold', label: 'On Hold' }, { value: 'disqualified', label: 'Disqualified' },
    ] },
  { key: 'assigned_to_name', label: 'Assigned To', defaultVisible: true, sortable: false, editable: false, fieldType: 'text' },
  { key: 'created_at', label: 'Created', sortKey: 'created_at', defaultVisible: true, sortable: true, editable: false, fieldType: 'date', format: 'date' },
  { key: 'estimated_size_kwp', label: 'System Size (kWp)', sortKey: 'estimated_size_kwp', defaultVisible: false, sortable: true, editable: true, fieldType: 'number' },
  { key: 'address_line1', label: 'Address', defaultVisible: false, sortable: false, editable: true, fieldType: 'text' },
  { key: 'pincode', label: 'Pincode', defaultVisible: false, sortable: true, editable: true, fieldType: 'text' },
  { key: 'is_qualified', label: 'Qualified', defaultVisible: false, sortable: true, editable: false, fieldType: 'select',
    options: [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }] },
  { key: 'next_followup_date', label: 'Next Follow-up', sortKey: 'next_followup_date', defaultVisible: false, sortable: true, editable: true, fieldType: 'date', format: 'date' },
];

// ── Proposals columns ──

export const PROPOSAL_COLUMNS: ColumnDef[] = [
  { key: 'proposal_number', label: 'Proposal #', sortKey: 'proposal_number', defaultVisible: true, sortable: true, editable: false, fieldType: 'link', frozen: true },
  { key: 'customer_name', label: 'Customer', defaultVisible: true, sortable: true, editable: false, fieldType: 'text' },
  { key: 'proposal_type', label: 'Type', sortKey: 'proposal_type', defaultVisible: true, sortable: true, editable: false, fieldType: 'select',
    options: [{ value: 'detailed', label: 'Detailed' }, { value: 'budgetary', label: 'Budgetary' }] },
  { key: 'system_type', label: 'System', sortKey: 'system_type', defaultVisible: true, sortable: true, editable: false, fieldType: 'select',
    options: [{ value: 'on_grid', label: 'On-Grid' }, { value: 'hybrid', label: 'Hybrid' }, { value: 'off_grid', label: 'Off-Grid' }] },
  { key: 'system_size_kwp', label: 'Size (kWp)', sortKey: 'system_size_kwp', defaultVisible: true, sortable: true, editable: false, fieldType: 'number' },
  { key: 'total_price', label: 'Total Price', sortKey: 'total_price', defaultVisible: true, sortable: true, editable: false, fieldType: 'currency', format: 'currency' },
  { key: 'margin_pct', label: 'Margin %', sortKey: 'margin_pct', defaultVisible: true, sortable: true, editable: false, fieldType: 'number', format: 'percentage' },
  { key: 'status', label: 'Status', sortKey: 'status', defaultVisible: true, sortable: true, editable: false, fieldType: 'badge',
    options: [
      { value: 'draft', label: 'Draft' }, { value: 'sent', label: 'Sent' }, { value: 'accepted', label: 'Accepted' },
      { value: 'rejected', label: 'Rejected' }, { value: 'expired', label: 'Expired' }, { value: 'revised', label: 'Revised' },
    ] },
  { key: 'created_at', label: 'Created', sortKey: 'created_at', defaultVisible: true, sortable: true, editable: false, fieldType: 'date', format: 'date' },
  { key: 'valid_until', label: 'Valid Until', sortKey: 'valid_until', defaultVisible: true, sortable: true, editable: false, fieldType: 'date', format: 'date' },
  { key: 'revision_number', label: 'Revision', defaultVisible: false, sortable: true, editable: false, fieldType: 'number' },
  { key: 'is_budgetary', label: 'Budgetary?', defaultVisible: false, sortable: true, editable: false, fieldType: 'select',
    options: [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }] },
];

// ── Projects columns ──

export const PROJECT_COLUMNS: ColumnDef[] = [
  { key: 'project_number', label: 'Project #', sortKey: 'project_number', defaultVisible: true, sortable: true, editable: false, fieldType: 'link', frozen: true },
  { key: 'customer_name', label: 'Customer', sortKey: 'customer_name', defaultVisible: true, sortable: true, editable: false, fieldType: 'text' },
  { key: 'site_city', label: 'Location', sortKey: 'site_city', defaultVisible: true, sortable: true, editable: false, fieldType: 'text' },
  { key: 'system_size_kwp', label: 'Size (kWp)', sortKey: 'system_size_kwp', defaultVisible: true, sortable: true, editable: false, fieldType: 'number' },
  { key: 'status', label: 'Status', sortKey: 'status', defaultVisible: true, sortable: true, editable: false, fieldType: 'badge' },
  { key: 'year', label: 'Year', sortKey: 'created_at', defaultVisible: true, sortable: true, editable: false, fieldType: 'text' },
  { key: 'remarks', label: 'Remarks', defaultVisible: true, sortable: false, editable: true, fieldType: 'text' },
  { key: 'system_type', label: 'System Type', sortKey: 'system_type', defaultVisible: false, sortable: true, editable: false, fieldType: 'select',
    options: [{ value: 'on_grid', label: 'On-Grid' }, { value: 'hybrid', label: 'Hybrid' }, { value: 'off_grid', label: 'Off-Grid' }] },
  { key: 'contracted_value', label: 'Contract Value', sortKey: 'contracted_value', defaultVisible: false, sortable: true, editable: false, fieldType: 'currency', format: 'currency' },
  { key: 'project_manager_name', label: 'PM', defaultVisible: false, sortable: false, editable: false, fieldType: 'text' },
  { key: 'created_at', label: 'Created', sortKey: 'created_at', defaultVisible: false, sortable: true, editable: false, fieldType: 'date', format: 'date' },
  { key: 'advance_amount', label: 'Advance', sortKey: 'advance_amount', defaultVisible: false, sortable: true, editable: false, fieldType: 'currency', format: 'currency' },
  { key: 'customer_phone', label: 'Phone', defaultVisible: false, sortable: false, editable: false, fieldType: 'phone' },
];

// ── Contacts columns ──

export const CONTACT_COLUMNS: ColumnDef[] = [
  { key: 'name', label: 'Name', sortKey: 'name', defaultVisible: true, sortable: true, editable: false, fieldType: 'link', frozen: true },
  { key: 'phone', label: 'Phone', defaultVisible: true, sortable: false, editable: true, fieldType: 'phone' },
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

// ── Column registry ──

export const ENTITY_COLUMNS: Record<EntityType, ColumnDef[]> = {
  leads: LEAD_COLUMNS,
  proposals: PROPOSAL_COLUMNS,
  projects: PROJECT_COLUMNS,
  contacts: CONTACT_COLUMNS,
  companies: COMPANY_COLUMNS,
};

/** Get default visible columns for an entity */
export function getDefaultColumns(entityType: EntityType): string[] {
  return ENTITY_COLUMNS[entityType]
    .filter((c) => c.defaultVisible)
    .map((c) => c.key);
}
