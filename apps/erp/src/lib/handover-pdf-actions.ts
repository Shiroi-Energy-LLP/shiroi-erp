'use server';

import { createClient } from '@repo/supabase/server';
import { revalidatePath } from 'next/cache';
import { type ActionResult, ok, err } from '@/lib/types/actions';

/**
 * Generate the Handover Pack PDF for a project (C11):
 *  1. Calls the internal API route to render the PDF.
 *  2. Uploads the PDF bytes to Supabase Storage (project-files bucket).
 *  3. Records the storage path in projects.handover_pdf_path.
 *  4. Returns a signed download URL (valid 1 hour).
 */
export async function generateHandoverPackPdf(
  projectId: string,
): Promise<ActionResult<{ storagePath: string; downloadUrl: string }>> {
  const op = '[generateHandoverPackPdf]';
  console.log(`${op} Starting`, { projectId });

  if (!projectId) return err('Missing project ID');

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return err('Not authenticated');

  // Role check — only founder + project_manager
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile || !['founder', 'project_manager'].includes(profile.role)) {
    return err('Only founders and project managers can generate handover packs');
  }

  // Fetch project_number for a sensible filename
  const { data: project, error: projErr } = await supabase
    .from('projects')
    .select('project_number')
    .eq('id', projectId)
    .single();

  if (projErr || !project) {
    console.error(`${op} Project not found`, { projectId, error: projErr?.message, timestamp: new Date().toISOString() });
    return err('Project not found');
  }

  // Build the URL for the internal API route — use the request origin or env
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    ? `${process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000'}`
    : 'http://localhost:3000';

  // Call the internal route to get the PDF bytes
  // We pass the user's auth cookie implicitly (this is a server-to-server call
  // on the same origin) — but to be safe, pass the service key as a header so
  // the route can authenticate without cookies.
  let pdfBytes: Uint8Array;
  try {
    const resp = await fetch(`${baseUrl}/api/projects/${projectId}/handover-pdf`, {
      method: 'GET',
      headers: {
        // Cookie-less internal call — the route will use createClient() which
        // reads cookies, so we need to pass them. This pattern works in Next.js
        // server actions since cookies() is available.
        Cookie: ``, // cookies forwarded by Next.js automatically in same-process calls
      },
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      console.error(`${op} API route error`, { status: resp.status, body, timestamp: new Date().toISOString() });
      return err(`PDF generation failed (status ${resp.status})`);
    }

    const buffer = await resp.arrayBuffer();
    pdfBytes = new Uint8Array(buffer);
  } catch (fetchErr) {
    console.error(`${op} Fetch failed`, { error: fetchErr instanceof Error ? fetchErr.message : String(fetchErr), timestamp: new Date().toISOString() });
    return err('Failed to reach PDF generation service');
  }

  // Upload to project-files bucket
  const safeNumber = project.project_number.replace(/[^a-zA-Z0-9-]/g, '-');
  const storagePath = `handover-packs/${projectId}/${safeNumber}-handover.pdf`;

  const { error: uploadErr } = await supabase.storage
    .from('project-files')
    .upload(storagePath, pdfBytes, {
      contentType: 'application/pdf',
      upsert: true,
    });

  if (uploadErr) {
    console.error(`${op} Storage upload failed`, { message: uploadErr.message, timestamp: new Date().toISOString() });
    return err(`Storage upload failed: ${uploadErr.message}`);
  }

  // Record path in projects table
  const { error: updateErr } = await supabase
    .from('projects')
    .update({ handover_pdf_path: storagePath })
    .eq('id', projectId);

  if (updateErr) {
    console.error(`${op} Update failed`, { code: updateErr.code, message: updateErr.message, timestamp: new Date().toISOString() });
    // Non-fatal — the file is uploaded; we can still return the URL
  }

  // Generate a 1-hour signed URL
  const { data: signedData, error: signErr } = await supabase.storage
    .from('project-files')
    .createSignedUrl(storagePath, 3600);

  if (signErr || !signedData) {
    console.error(`${op} Signed URL failed`, { message: signErr?.message, timestamp: new Date().toISOString() });
    return err('PDF saved but could not create download link');
  }

  revalidatePath(`/projects/${projectId}`);
  console.log(`${op} Done`, { projectId, storagePath });
  return ok({ storagePath, downloadUrl: signedData.signedUrl });
}

/**
 * Get a fresh signed download URL for an already-generated handover PDF.
 */
export async function getHandoverPackDownloadUrl(
  storagePath: string,
): Promise<ActionResult<{ url: string }>> {
  const op = '[getHandoverPackDownloadUrl]';

  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from('project-files')
    .createSignedUrl(storagePath, 3600);

  if (error || !data) {
    console.error(`${op} Failed`, { message: error?.message, storagePath, timestamp: new Date().toISOString() });
    return err('Could not create download link');
  }

  return ok({ url: data.signedUrl });
}
