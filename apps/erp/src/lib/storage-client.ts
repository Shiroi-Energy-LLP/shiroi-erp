// =============================================================================
// Browser-side Supabase Storage helpers (client components only)
// =============================================================================
// File uploads have to happen from the browser — the bytes are in the user's
// File object, and streaming them through a Next server action just to reach
// Storage would be pointless. These helpers centralise the bucket name, the
// path conventions, and the signed-URL TTL so individual components don't each
// re-import the browser Supabase client (NEVER-DO #15 keeps that import out of
// app/ and components/).
//
// Import from 'use client' components only — never from a server component.
// =============================================================================

import { createClient } from '@repo/supabase/client';

/** All project/AMC/ticket documents live in this private bucket. */
const BUCKET = 'project-files';

/** Signed URLs are short-lived; long enough to open or save a file. */
const SIGNED_URL_TTL_SECONDS = 600;

export interface UploadResult {
  path: string;
  name: string;
}

/**
 * Uploads `file` under `pathPrefix`, keeping the original extension and giving
 * the object a random name so two uploads of "report.pdf" can't collide.
 * Returns null on failure — callers surface their own error copy.
 */
export async function uploadProjectFile(
  pathPrefix: string,
  file: File,
  fallbackExt = 'bin',
): Promise<UploadResult | null> {
  const op = '[uploadProjectFile]';
  const supabase = createClient();
  const ext = file.name.split('.').pop() || fallbackExt;
  const path = `${pathPrefix}/${crypto.randomUUID()}.${ext}`;

  const { error } = await supabase.storage.from(BUCKET).upload(path, file);
  if (error) {
    console.error(`${op} Upload failed:`, { path, message: error.message });
    return null;
  }

  return { path, name: file.name };
}

/**
 * Mints a signed URL. Pass `downloadAs` to make the browser save the file
 * instead of previewing it inline.
 */
export async function getSignedFileUrl(
  path: string,
  downloadAs?: string,
): Promise<string | null> {
  const op = '[getSignedFileUrl]';
  const supabase = createClient();

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS, downloadAs ? { download: downloadAs } : undefined);

  if (error || !data?.signedUrl) {
    console.error(`${op} Failed to sign:`, { path, message: error?.message });
    return null;
  }

  return data.signedUrl;
}
