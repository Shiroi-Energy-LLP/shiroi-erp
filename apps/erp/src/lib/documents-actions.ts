'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@repo/supabase/server';
import { type ActionResult, ok, err } from '@/lib/types/actions';
import { emitErpEvent } from '@/lib/n8n/emit';
import { asDocsClient, type DocumentCategory } from '@/lib/documents-queries';

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
