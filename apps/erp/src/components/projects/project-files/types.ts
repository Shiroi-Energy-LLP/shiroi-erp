import type * as React from 'react';
import {
  Camera, PenTool, LayoutGrid, ShoppingCart, Receipt, Truck, Shield,
  Table2, FileText, FileCheck, Folder, Users,
} from 'lucide-react';

/**
 * Types + category config for the project Documents tab.
 * Split out of project-files.tsx to keep the main shell under the
 * 500-LOC rule (CLAUDE.md NEVER-DO #14).
 */

export interface FileInfo {
  name: string;
  id: string;
  created_at: string;
  metadata: { size?: number; mimetype?: string };
  pathPrefix: string;
  bucket: string;
}

export interface LeadFileInfo {
  name: string;
  id: string;
  created_at: string;
  size?: number;
  mimetype?: string;
}

export interface HandoverPackData {
  id: string;
  version: number;
  generated_at: string;
  metadata: Record<string, unknown>;
}

export interface DeliveryChallanInfo {
  id: string;
  dc_number?: string;
  dc_date?: string;
  status: string;
  delivery_challan_items?: unknown[];
  created_at?: string;
}

export interface QcInspectionInfo {
  id: string;
  gate_number?: number;
  inspection_date?: string;
  overall_result?: string | null;
  approval_status?: string | null;
  employees?: { full_name: string } | null;
}

export interface SurveyInfo {
  id: string;
  survey_date?: string;
  survey_status?: string;
  recommended_size_kwp?: number;
  contact_person_name?: string;
}

export interface ProjectFilesProps {
  projectId: string;
  leadId: string | null;
  leadFiles: LeadFileInfo[];
  handoverPack: HandoverPackData | null;
  deliveryChallans?: DeliveryChallanInfo[];
  qcInspections?: QcInspectionInfo[];
  surveyData?: SurveyInfo | null;
}

export interface DragData {
  fileName: string;
  bucket: string;
  pathPrefix: string;
  sourceCategory: string;
}

export interface DocumentCategory {
  value: string;
  label: string;
  icon: React.ElementType;
}

export const DOCUMENT_CATEGORIES: readonly DocumentCategory[] = [
  { value: 'customer-documents', label: 'Customer Documents', icon: Users },
  { value: 'photos', label: 'Site Photos', icon: Camera },
  { value: 'autocad', label: 'AutoCAD / Design', icon: PenTool },
  { value: 'layouts', label: 'Layouts / Designs', icon: LayoutGrid },
  { value: 'purchase-orders', label: 'Purchase Orders', icon: ShoppingCart },
  { value: 'invoices', label: 'Invoices', icon: Receipt },
  { value: 'delivery-challans', label: 'Delivery Challans', icon: Truck },
  { value: 'warranty', label: 'Warranty Cards', icon: Shield },
  { value: 'excel', label: 'Excel / Costing', icon: Table2 },
  { value: 'documents', label: 'Documents / Approvals', icon: FileText },
  { value: 'sesal', label: 'SESAL', icon: FileCheck },
  { value: 'general', label: 'General', icon: Folder },
] as const;

/** Map every known storage folder name → display category value. */
export const FOLDER_TO_CATEGORY: Record<string, string> = {
  'customer-documents': 'customer-documents',
  photos: 'photos',
  autocad: 'autocad',
  layouts: 'layouts',
  'purchase-orders': 'purchase-orders',
  invoices: 'invoices',
  invoice: 'invoices', // legacy folder name
  'delivery-challans': 'delivery-challans',
  warranty: 'warranty',
  excel: 'excel',
  documents: 'documents',
  sesal: 'sesal',
  general: 'general',
};

export const SCAN_FOLDERS = Object.keys(FOLDER_TO_CATEGORY);
