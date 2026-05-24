/**
 * /p/[token]/pdf — Public proposal PDF download
 *
 * Customer-facing. Validates the share token, looks up the proposal's stored
 * PDF, signs a short-lived URL, and 302-redirects the browser to it.
 *
 * No auth required (token entropy + expiry are the gate). Mirrors the
 * /p/[token] page's validation rules.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@repo/supabase/admin';

interface Params {
  params: { token: string };
}

export async function GET(_req: NextRequest, { params }: Params) {
  const op = '[publicProposalPdf]';
  const { token } = params;

  if (!token || token.length < 32) {
    return new NextResponse('Invalid link', { status: 404 });
  }

  const admin = createAdminClient();

  const { data: share, error: shareErr } = await admin
    .from('proposal_share_tokens')
    .select('proposal_id, expires_at')
    .eq('token', token)
    .maybeSingle();

  if (shareErr || !share) {
    return new NextResponse('Link not found', { status: 404 });
  }
  if (new Date(share.expires_at).getTime() < Date.now()) {
    return new NextResponse('Link has expired', { status: 410 });
  }

  const { data: proposal, error: propErr } = await admin
    .from('proposals')
    .select('current_pdf_storage_path')
    .eq('id', share.proposal_id)
    .maybeSingle();

  if (propErr || !proposal?.current_pdf_storage_path) {
    return new NextResponse('PDF not available yet — please ask your contact at Shiroi to regenerate', { status: 404 });
  }

  const { data: signed, error: signErr } = await admin.storage
    .from('proposal-files')
    .createSignedUrl(proposal.current_pdf_storage_path, 60 * 15); // 15 min — enough for one click-through

  if (signErr || !signed?.signedUrl) {
    console.error(`${op} createSignedUrl failed`, {
      proposalId: share.proposal_id,
      path: proposal.current_pdf_storage_path,
      error: signErr?.message,
      timestamp: new Date().toISOString(),
    });
    return new NextResponse('Could not generate download link', { status: 500 });
  }

  return NextResponse.redirect(signed.signedUrl, { status: 302 });
}

export const dynamic = 'force-dynamic';
