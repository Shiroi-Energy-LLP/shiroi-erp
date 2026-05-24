import { createClient } from '@repo/supabase/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { type ActionResult, ok, err } from '@/lib/types/actions';

// Re-export constants + DocumentCategory type so server-side callers can keep
// importing them from here. Client components must import directly from
// `./documents-constants` to keep the server Supabase client out of the
// client bundle (Next.js production build will otherwise fail with
// "You're importing a component that needs next/headers").
export type { DocumentCategory } from './documents-constants';
export { DOCUMENT_CATEGORY_LABELS } from './documents-constants';
import type { DocumentCategory } from './documents-constants';

/**
 * Documents — unified file index across the customer journey (mig 109).
 * Files live in either Drive (collab/large) or Supabase Storage
 * (structured/sensitive); this table is the storage-agnostic index.
 *
 * Phase 1 escape hatch: `documents` and the new `leads.drive_folder_*` columns
 * are not yet in regenerated `packages/types/database.ts` — the regen explodes
 * the type tree with FK references to digest views (TS2589). We cast the client
 * once to a narrow `DocsClient` shape that knows about these new tables, then
 * use that client for documents-related queries. No inline `as any`. When the
 * regen issue is fixed, delete this file's local types and use the standard
 * Database['public']['Tables'] types.
 */

export type DocumentRow = {
  id: string;
  lead_id: string | null;
  proposal_id: string | null;
  project_id: string | null;
  category: DocumentCategory;
  subcategory: string | null;
  storage_backend: 'drive' | 'supabase';
  external_id: string | null;
  storage_path: string | null;
  external_url: string | null;
  parent_folder_id: string | null;
  name: string;
  mime_type: string | null;
  size_bytes: number | null;
  tags: string[];
  ai_summary: string | null;
  uploaded_by: string | null;
  uploaded_at: string;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

export type DocumentInsert = {
  id?: string;
  lead_id?: string | null;
  proposal_id?: string | null;
  project_id?: string | null;
  category: DocumentCategory;
  subcategory?: string | null;
  storage_backend: 'drive' | 'supabase';
  external_id?: string | null;
  storage_path?: string | null;
  external_url?: string | null;
  parent_folder_id?: string | null;
  name: string;
  mime_type?: string | null;
  size_bytes?: number | null;
  tags?: string[];
  ai_summary?: string | null;
  uploaded_by?: string | null;
  uploaded_at?: string;
};

export type DocumentUpdate = Partial<DocumentRow>;

/**
 * DocumentRow + a `signed_url` field that resolves to either:
 *   - `external_url` for Drive-backed docs (already publicly addressable), or
 *   - a 1-hour Supabase Storage signed URL for supabase-backed docs (private
 *     bucket — only way to reach the blob without a server-side handle).
 *
 * Used by the Files tab to render a single "Open" link regardless of where
 * the file actually lives.
 */
export type DocumentRowWithUrl = DocumentRow & { signed_url: string | null };

/**
 * Resolve open-URLs for a batch of documents. Signs Supabase Storage paths
 * in parallel, falls back to external_url for Drive-backed rows.
 * Bucket inference: proposal_pdf + supabase → proposal-files. Other
 * supabase-backed categories will be added as we wire them up.
 */
export async function attachOpenUrls(documents: DocumentRow[]): Promise<DocumentRowWithUrl[]> {
  const op = '[attachOpenUrls]';
  const supabase = await createClient();

  const SIGNED_URL_TTL = 60 * 60; // 1 hour

  return Promise.all(
    documents.map(async (doc): Promise<DocumentRowWithUrl> => {
      if (doc.storage_backend === 'drive') {
        return { ...doc, signed_url: doc.external_url };
      }
      if (doc.storage_backend === 'supabase' && doc.storage_path) {
        // Infer bucket from the row's entity association:
        //  - project_id set → project-files (broader RLS for field roles)
        //  - else (lead_id / proposal_id only) → proposal-files
        // Matches the routing in `uploadProjectDocument` (documents-actions.ts).
        const bucket = doc.project_id ? 'project-files' : 'proposal-files';

        const { data, error } = await supabase.storage
          .from(bucket)
          .createSignedUrl(doc.storage_path, SIGNED_URL_TTL);
        if (error) {
          console.error(`${op} signed-url failed for ${doc.id}`, {
            code: error.name,
            message: error.message,
            timestamp: new Date().toISOString(),
          });
          return { ...doc, signed_url: null };
        }
        return { ...doc, signed_url: data?.signedUrl ?? null };
      }
      return { ...doc, signed_url: null };
    }),
  );
}

type DocsDatabase = {
  public: {
    Tables: {
      documents: { Row: DocumentRow; Insert: DocumentInsert; Update: DocumentUpdate; Relationships: [] };
      leads: { Row: { id: string; customer_name: string; status: string; drive_folder_id: string | null; drive_folder_url: string | null }; Insert: never; Update: { drive_folder_id?: string | null; drive_folder_url?: string | null }; Relationships: [] };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

/**
 * Cast helper — narrows the standard supabase client to one that knows about
 * documents + leads.drive_folder_*. Keeps the cast on a single line, avoids
 * sprinkling `as any` across queries (forbidden by NEVER-DO #11). Used only
 * inside this file and documents-actions.ts.
 */
export function asDocsClient(client: Awaited<ReturnType<typeof createClient>>): SupabaseClient<DocsDatabase> {
  return client as unknown as SupabaseClient<DocsDatabase>;
}

const SELECT_COLS =
  'id, lead_id, proposal_id, project_id, category, subcategory, storage_backend, external_id, storage_path, external_url, parent_folder_id, name, mime_type, size_bytes, tags, ai_summary, uploaded_by, uploaded_at, deleted_at, created_at, updated_at';

export async function getDocumentsForLead(
  leadId: string,
): Promise<ActionResult<DocumentRow[]>> {
  const op = '[getDocumentsForLead]';
  const supabase = asDocsClient(await createClient());

  const { data, error } = await supabase
    .from('documents')
    .select(SELECT_COLS)
    .eq('lead_id', leadId)
    .is('deleted_at', null)
    .order('uploaded_at', { ascending: false });

  if (error) {
    console.error(`${op} Query failed`, {
      leadId,
      code: error.code,
      message: error.message,
      timestamp: new Date().toISOString(),
    });
    return err(`Failed to load documents: ${error.message}`, error.code);
  }

  return ok((data ?? []) as DocumentRow[]);
}

export async function getDocumentsForProposal(
  proposalId: string,
): Promise<ActionResult<DocumentRow[]>> {
  const op = '[getDocumentsForProposal]';
  const supabase = asDocsClient(await createClient());

  const { data, error } = await supabase
    .from('documents')
    .select(SELECT_COLS)
    .eq('proposal_id', proposalId)
    .is('deleted_at', null)
    .order('uploaded_at', { ascending: false });

  if (error) {
    console.error(`${op} Query failed`, {
      proposalId,
      code: error.code,
      message: error.message,
      timestamp: new Date().toISOString(),
    });
    return err(`Failed to load documents: ${error.message}`, error.code);
  }

  return ok((data ?? []) as DocumentRow[]);
}

export async function getDocumentsForProject(
  projectId: string,
): Promise<ActionResult<DocumentRow[]>> {
  const op = '[getDocumentsForProject]';
  const supabase = asDocsClient(await createClient());

  const { data, error } = await supabase
    .from('documents')
    .select(SELECT_COLS)
    .eq('project_id', projectId)
    .is('deleted_at', null)
    .order('uploaded_at', { ascending: false });

  if (error) {
    console.error(`${op} Query failed`, {
      projectId,
      code: error.code,
      message: error.message,
      timestamp: new Date().toISOString(),
    });
    return err(`Failed to load documents: ${error.message}`, error.code);
  }

  return ok((data ?? []) as DocumentRow[]);
}

export async function getLeadDriveFolder(
  leadId: string,
): Promise<{ id: string | null; url: string | null }> {
  const op = '[getLeadDriveFolder]';
  const supabase = asDocsClient(await createClient());
  const { data, error } = await supabase
    .from('leads')
    .select('drive_folder_id, drive_folder_url')
    .eq('id', leadId)
    .maybeSingle();
  if (error || !data) {
    if (error) {
      console.error(`${op} Query failed`, {
        leadId,
        code: error.code,
        message: error.message,
        timestamp: new Date().toISOString(),
      });
    }
    return { id: null, url: null };
  }
  return { id: data.drive_folder_id ?? null, url: data.drive_folder_url ?? null };
}

