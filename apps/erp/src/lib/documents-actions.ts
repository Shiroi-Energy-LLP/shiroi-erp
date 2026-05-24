'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@repo/supabase/server';
import { type ActionResult, ok, err } from '@/lib/types/actions';
import { emitErpEvent } from '@/lib/n8n/emit';
import { asDocsClient, type DocumentCategory } from '@/lib/documents-queries';

// ---------------------------------------------------------------------------
// C10: Upload a project document via drag-drop form
// ---------------------------------------------------------------------------

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/octet-stream', // DWG/SKP — no official MIME
  'image/svg+xml',
]);

const ALLOWED_EXTENSIONS = new Set([
  'pdf', 'jpg', 'jpeg', 'png', 'webp', 'heic',
  'xlsx', 'xls', 'csv',
  'dwg', 'skp', 'dxf',
]);

const MAX_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB

/**
 * Auto-detect a category from file name + mime type.
 */
function detectCategory(name: string, mimeType: string): DocumentCategory {
  const lower = name.toLowerCase();
  if (lower.includes('bom') || lower.endsWith('.xlsx') || lower.endsWith('.xls') || lower.endsWith('.csv')) {
    return lower.includes('bom') ? 'bom_excel' : 'costing_sheet';
  }
  if (mimeType.startsWith('image/')) return 'site_survey_photo';
  if (lower.endsWith('.dwg') || lower.endsWith('.dxf')) return 'cad_drawing';
  if (lower.endsWith('.skp')) return 'sketchup_model';
  if (mimeType === 'application/pdf') return 'proposal_pdf';
  return 'misc';
}

export interface UploadDocumentInput {
  file: File;
  entityType: 'lead' | 'project';
  entityId: string;
  category?: DocumentCategory;
}

export async function uploadProjectDocument(
  formData: FormData,
): Promise<ActionResult<{ id: string; name: string }>> {
  const op = '[uploadProjectDocument]';

  const file = formData.get('file') as File | null;
  const entityType = formData.get('entityType') as 'lead' | 'project' | null;
  const entityId = formData.get('entityId') as string | null;
  const categoryOverride = formData.get('category') as DocumentCategory | null;

  if (!file || !(file instanceof File)) return err('No file provided');
  if (!entityType || !entityId) return err('Missing entity association');

  console.log(`${op} Starting`, { name: file.name, size: file.size, entityType, entityId });

  // --- Validations ---
  if (file.size > MAX_SIZE_BYTES) {
    return err(`File too large: max 20 MB (got ${(file.size / 1024 / 1024).toFixed(1)} MB)`);
  }

  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (!ALLOWED_EXTENSIONS.has(ext) && !ALLOWED_MIME_TYPES.has(file.type)) {
    return err(`File type not allowed: .${ext}`);
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return err('Not authenticated');

  const { data: employee } = await supabase
    .from('employees')
    .select('id')
    .eq('profile_id', user.id)
    .maybeSingle();

  // --- Upload to Storage ---
  const category = categoryOverride ?? detectCategory(file.name, file.type);
  // Store under entity-specific path for easy listing
  const timestamp = Date.now();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storagePath = `${entityId}/${timestamp}_${safeName}`;

  // Pick the bucket whose RLS permits the caller's role.
  //  - 'project-files' allows founder + PM + site_supervisor + om_technician.
  //  - 'proposal-files' is restricted to founder + sales_engineer + designer.
  // Routing project-scoped uploads to project-files unblocks the actual users.
  const bucket = entityType === 'project' ? 'project-files' : 'proposal-files';

  const arrayBuffer = await file.arrayBuffer();
  const uint8 = new Uint8Array(arrayBuffer);

  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(storagePath, uint8, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    });

  if (uploadError) {
    console.error(`${op} Storage upload failed`, { bucket, message: uploadError.message, timestamp: new Date().toISOString() });
    return err(`Upload failed: ${uploadError.message}`);
  }

  // --- Create documents row ---
  const insertRow = {
    lead_id: entityType === 'lead' ? entityId : null,
    project_id: entityType === 'project' ? entityId : null,
    category,
    storage_backend: 'supabase' as const,
    storage_path: storagePath,
    name: file.name,
    mime_type: file.type || null,
    size_bytes: file.size,
    tags: [] as string[],
    uploaded_by: employee?.id ?? null,
  };

  const docs = asDocsClient(supabase);
  const { data, error: insertError } = await docs
    .from('documents')
    .insert(insertRow)
    .select('id')
    .single();

  if (insertError) {
    console.error(`${op} Document insert failed`, { code: insertError.code, message: insertError.message, timestamp: new Date().toISOString() });
    // Clean up orphaned file from the same bucket we uploaded to.
    await supabase.storage.from(bucket).remove([storagePath]);
    return err(insertError.message, insertError.code);
  }

  if (entityType === 'lead') revalidatePath(`/leads/${entityId}/files`);
  if (entityType === 'project') revalidatePath(`/projects/${entityId}`);

  return ok({ id: data.id, name: file.name });
}

/**
 * Documents mutations + Drive folder lifecycle (mig 109, phase 1).
 *
 * The Drive-folder action fires an n8n event (`lead.drive_folder_requested`).
 * The n8n workflow (`infrastructure/n8n/workflows/29-drive-folder-create.json`)
 * picks it up, creates the Drive folder, and writes back `drive_folder_id` +
 * `drive_folder_url` to the lead row via Supabase REST. This keeps the Drive
 * service-account credential in n8n only.
 */

type CreateDocumentInput = {
  leadId?: string;
  proposalId?: string;
  projectId?: string;
  category: DocumentCategory;
  subcategory?: string;
  storageBackend: 'drive' | 'supabase';
  externalId?: string;
  storagePath?: string;
  externalUrl?: string;
  parentFolderId?: string;
  name: string;
  mimeType?: string;
  sizeBytes?: number;
  tags?: string[];
};

export async function createDocument(
  input: CreateDocumentInput,
): Promise<ActionResult<{ id: string }>> {
  const op = '[createDocument]';
  console.log(`${op} Starting`, { name: input.name, category: input.category });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return err('Not authenticated');

  const { data: employee } = await supabase
    .from('employees')
    .select('id')
    .eq('profile_id', user.id)
    .maybeSingle();

  // Validate at least one entity association (matches DB CHECK constraint)
  if (!input.leadId && !input.proposalId && !input.projectId) {
    return err('Must associate document with at least one of: lead, proposal, project');
  }

  // Validate storage-backend integrity (matches DB CHECK constraint)
  if (input.storageBackend === 'drive' && !input.externalId) {
    return err('Drive documents require externalId (Drive file ID)');
  }
  if (input.storageBackend === 'supabase' && !input.storagePath) {
    return err('Supabase documents require storagePath');
  }

  const insertRow = {
    lead_id: input.leadId ?? null,
    proposal_id: input.proposalId ?? null,
    project_id: input.projectId ?? null,
    category: input.category,
    subcategory: input.subcategory ?? null,
    storage_backend: input.storageBackend,
    external_id: input.externalId ?? null,
    storage_path: input.storagePath ?? null,
    external_url: input.externalUrl ?? null,
    parent_folder_id: input.parentFolderId ?? null,
    name: input.name,
    mime_type: input.mimeType ?? null,
    size_bytes: input.sizeBytes ?? null,
    tags: input.tags ?? [],
    uploaded_by: employee?.id ?? null,
  };

  const docs = asDocsClient(supabase);
  const { data, error } = await docs
    .from('documents')
    .insert(insertRow)
    .select('id')
    .single();

  if (error) {
    console.error(`${op} Failed:`, {
      code: error.code,
      message: error.message,
      timestamp: new Date().toISOString(),
    });
    return err(error.message, error.code);
  }

  if (input.leadId) revalidatePath(`/sales/${input.leadId}`);
  if (input.proposalId) revalidatePath(`/proposals/${input.proposalId}`);
  if (input.projectId) revalidatePath(`/projects/${input.projectId}`);

  return ok({ id: data.id });
}

export async function softDeleteDocument(documentId: string): Promise<ActionResult<void>> {
  const op = '[softDeleteDocument]';
  console.log(`${op} Starting`, { documentId });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return err('Not authenticated');

  const docs = asDocsClient(supabase);
  const { error } = await docs
    .from('documents')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', documentId);

  if (error) {
    console.error(`${op} Failed:`, {
      code: error.code,
      message: error.message,
      timestamp: new Date().toISOString(),
    });
    return err(error.message, error.code);
  }
  return ok(undefined);
}

/**
 * Manually request creation of a Drive folder for a lead. Fires an n8n event;
 * n8n creates the folder + 5 sub-folders and writes back drive_folder_id +
 * drive_folder_url to the lead row.
 *
 * Idempotent: if drive_folder_id is already set, returns success without
 * firing the event.
 */
export async function requestDriveFolderForLead(
  leadId: string,
): Promise<ActionResult<{ alreadyExists: boolean }>> {
  const op = '[requestDriveFolderForLead]';
  console.log(`${op} Starting`, { leadId });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return err('Not authenticated');

  // Read lead row + check existing folder
  const docs = asDocsClient(supabase);
  const { data: lead, error: leadErr } = await docs
    .from('leads')
    .select('id, customer_name, status, drive_folder_id')
    .eq('id', leadId)
    .maybeSingle();

  if (leadErr) {
    console.error(`${op} Lead fetch failed`, {
      leadId,
      code: leadErr.code,
      message: leadErr.message,
      timestamp: new Date().toISOString(),
    });
    return err(`Failed to load lead: ${leadErr.message}`, leadErr.code);
  }
  if (!lead) return err('Lead not found');

  if (lead.drive_folder_id) {
    return ok({ alreadyExists: true });
  }

  // Determine FY for folder naming (Apr–Mar Indian financial year)
  const now = new Date();
  const month = now.getMonth(); // 0-indexed: 0=Jan, 3=Apr
  const year = now.getFullYear();
  const fyStart = month >= 3 ? year : year - 1;
  const fyEnd = (fyStart + 1).toString().slice(-2);
  const fy = `${fyStart}-${fyEnd}`;

  await emitErpEvent('lead.drive_folder_requested', {
    lead_id: leadId,
    customer_name: lead.customer_name,
    status: lead.status,
    fy,
    requested_by: user.id,
    trigger: 'manual',
  });

  revalidatePath(`/sales/${leadId}`);
  return ok({ alreadyExists: false });
}
