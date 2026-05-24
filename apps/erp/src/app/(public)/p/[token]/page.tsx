/**
 * /p/[token] — Public customer proposal portal
 *
 * No authentication required. Uses admin client to validate the token,
 * then renders a read-only proposal view for the customer.
 *
 * Security model:
 *   - Token is 64 hex chars (256 bits of entropy) — brute-force infeasible
 *   - Expiry enforced server-side (expires_at < NOW())
 *   - view_count + last_viewed_ip logged for audit
 *   - No internal employee data, financial summaries, or project details beyond
 *     what the customer would see on their own proposal PDF
 */

import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import { createAdminClient } from '@repo/supabase/admin';
import { formatINR } from '@repo/ui';
import { ProposalPortalClient } from './proposal-portal-client';

interface Props {
  params: { token: string };
}

async function getProposalByToken(token: string, ip: string) {
  const admin = createAdminClient();

  // Validate token
  const { data: shareToken, error: tokenErr } = await admin
    .from('proposal_share_tokens')
    .select(`
      id,
      proposal_id,
      expires_at,
      viewed_count,
      proposals!proposal_share_tokens_proposal_id_fkey (
        id,
        proposal_number,
        system_size_kw,
        total_after_discount,
        discount_amount,
        subtotal,
        status,
        created_at,
        notes,
        leads!proposals_lead_id_fkey (
          customer_name,
          city,
          segment
        )
      )
    `)
    .eq('token', token)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();

  if (tokenErr || !shareToken) return null;

  // Increment view counter (best-effort, non-blocking)
  admin
    .from('proposal_share_tokens')
    .update({
      viewed_count: (shareToken.viewed_count ?? 0) + 1,
      last_viewed_at: new Date().toISOString(),
      last_viewed_ip: ip,
    })
    .eq('id', shareToken.id)
    .then(() => {});

  const proposal = Array.isArray(shareToken.proposals)
    ? shareToken.proposals[0]
    : shareToken.proposals;

  if (!proposal) return null;

  const lead = Array.isArray(proposal.leads) ? proposal.leads[0] : proposal.leads;

  return {
    proposalNumber: proposal.proposal_number ?? '',
    systemSizeKw: proposal.system_size_kw ?? 0,
    totalAfterDiscount: proposal.total_after_discount ?? 0,
    status: proposal.status ?? 'draft',
    customerName: lead?.customer_name ?? 'Customer',
    city: lead?.city ?? '',
    segment: lead?.segment ?? '',
    createdAt: proposal.created_at,
    expiresAt: shareToken.expires_at,
  };
}

export default async function ProposalPortalPage({ params }: Props) {
  // Get client IP from headers (Vercel forwards X-Forwarded-For)
  const headerList = headers();
  const ip =
    headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    headerList.get('x-real-ip') ??
    'unknown';

  const proposal = await getProposalByToken(params.token, ip);
  if (!proposal) notFound();

  return <ProposalPortalClient proposal={proposal} formatINR={formatINR} token={params.token} />;
}

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params: _params }: Props) {
  const title = 'Your Solar Proposal — Shiroi Energy';
  const description = 'View your personalised solar proposal from Shiroi Energy.';
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: 'website',
      siteName: 'Shiroi Energy',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
  };
}
