import { notFound } from 'next/navigation';
import { getUserProfile } from '@/lib/auth';
import { getLead, leadHasProject, leadHasProposal, leadHasDetailedProposal } from '@/lib/leads-queries';
import { LeadStatusBadge } from '@/components/leads/lead-status-badge';
import { LeadTabs } from '@/components/leads/lead-tabs';
import { StatusChange } from '@/components/leads/status-change';
import { LeadNameEditDialog } from '@/components/leads/lead-name-edit-dialog';
import { QuickQuoteButton } from '@/components/proposals/quick-quote-button';
import { ClosureBandBadge, ClosureBandHelper } from '@/components/sales/closure-band-badge';
import { AttemptWonButton } from '@/components/sales/attempt-won-button';
import { CreateProjectFromLeadButton } from '@/components/sales/create-project-from-lead-button';
import { ProposalGateBypassToggle } from '@/components/sales/proposal-gate-bypass-toggle';
import { ProposalGateBanner } from '@/components/proposal-gate-banner';
import { computeMargin } from '@/lib/closure-actions';
import { Breadcrumb, Card, CardContent, Button } from '@repo/ui';
import { formatDate } from '@repo/ui/formatters';
import Link from 'next/link';

interface LeadDetailLayoutProps {
  params: Promise<{ id: string }>;
  children: React.ReactNode;
}

export default async function LeadDetailLayout({ params, children }: LeadDetailLayoutProps) {
  const { id } = await params;
  const lead = await getLead(id);

  if (!lead) {
    notFound();
  }

  const showPayments = lead.status === 'won' || lead.status === 'converted';

  // Resolve caller role for gated UI elements (gate-bypass toggle, skip-margin button).
  // Fail open visually — role check is enforced server-side in each action.
  const callerProfile = await getUserProfile();
  const isGatedRole = callerProfile?.role === 'founder' || callerProfile?.role === 'marketing_manager';

  // For closure_soon leads, compute margin + band so the banner shows live
  // numbers (and AttemptWonButton routes through attemptWon server action).
  const inClosure = lead.status === 'closure_soon' || lead.status === 'negotiation';
  const marginSnapshot = inClosure ? await computeMargin(id) : null;
  const margin = marginSnapshot && marginSnapshot.success ? marginSnapshot.data : null;

  // Won leads should always have a project. If the cascade missed (bulk
  // import, no in-play proposal at won-time), surface a manual fallback so
  // ops isn't stuck. Hidden once a project exists.
  const hasProjectForLead = lead.status === 'won' ? await leadHasProject(id) : true;

  // Mig 107's DB trigger blocks UPDATE leads SET status = 'won' when no
  // proposal exists. Show a banner on stages where won is the natural next
  // click so the user knows BEFORE hitting the error.
  const TERMINAL = ['won', 'lost', 'on_hold', 'disqualified', 'converted'];
  const hasProposal = await leadHasProposal(id);
  const showNoProposalBanner = !TERMINAL.includes(lead.status) && !hasProposal;

  // For leads that have a quick quote but no detailed proposal yet, show an
  // amber nudge if they're in a stage where won is reachable (post-quick-quote stages).
  const QUICK_QUOTE_SENT_AND_LATER = [
    'quick_quote_sent', 'site_survey_scheduled', 'site_survey_done',
    'design_in_progress', 'design_confirmed', 'detailed_proposal_sent',
    'negotiation', 'closure_soon',
  ];
  const needsDetailedProposalNudge =
    hasProposal &&
    QUICK_QUOTE_SENT_AND_LATER.includes(lead.status) &&
    !(await leadHasDetailedProposal(id));

  return (
    <div className="space-y-6">
      {/* Org-wide proposal gate disabled banner — renders only when gate is off. */}
      <ProposalGateBanner />

      {/* Breadcrumb - middleware redirects /leads -> /sales so this always
          renders under /sales URL space post-revamp. */}
      <Breadcrumb
        className="mb-2"
        items={[
          { label: 'Sales', href: '/sales' },
          { label: lead.customer_name },
        ]}
      />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-n-900">{lead.customer_name}</h1>
            <LeadNameEditDialog leadId={lead.id} currentName={lead.customer_name} />
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <LeadStatusBadge status={lead.status} />
            {lead.employees?.full_name && (
              <span className="text-sm text-n-500">
                Assigned to {lead.employees.full_name}
              </span>
            )}
            {lead.expected_close_date && (
              <span className="text-sm text-n-500">
                Expected close: {formatDate(lead.expected_close_date)}
              </span>
            )}
            {lead.closed_date && (
              <span className="text-sm text-n-500">
                Closed: {formatDate(lead.closed_date)}
              </span>
            )}
            {lead.close_probability != null && lead.close_probability > 0 && (
              <span className="text-sm font-medium text-n-600">
                {lead.close_probability}% probability
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {lead.status === 'won' && !hasProjectForLead && (
            <CreateProjectFromLeadButton leadId={lead.id} />
          )}
          {/* Detailed quote CTA — prominent when no detailed proposal exists yet */}
          {needsDetailedProposalNudge && (
            <Link href={`/leads/${id}/proposal`}>
              <Button size="sm" className="bg-shiroi-gold hover:bg-shiroi-gold/90 text-shiroi-ink">
                Create Detailed Quote
              </Button>
            </Link>
          )}
          <QuickQuoteButton
            leadId={lead.id}
            systemType={lead.system_type}
            sizeKwp={lead.estimated_size_kwp}
            segment={lead.segment}
          />
          <StatusChange
            leadId={lead.id}
            currentStatus={lead.status}
            currentExpectedCloseDate={lead.expected_close_date}
          />
        </div>
      </div>

      {/* No-proposal banner — shows when the lead is in an active (non-terminal)
          stage but has no proposal yet. Mig 107 blocks the won transition
          server-side; this surfaces the requirement up-front.
          B1: founder + marketing_manager can bypass the gate for historical cleanup. */}
      {showNoProposalBanner && (
        <Card className="border-l-4 border-l-amber-500 bg-amber-50/40">
          <CardContent className="py-3">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="text-sm text-n-800">
                {lead.proposal_gate_bypassed ? (
                  <>
                    <span className="font-semibold text-amber-700">
                      ⚠ Cleanup mode — Won is allowed without a proposal.
                    </span>{' '}
                    Toggle off after cleanup.
                  </>
                ) : (
                  <>
                    <span className="font-semibold">No proposal yet.</span>{' '}
                    Create a Quick Quote (fast lane) or a detailed proposal before
                    marking this lead Won — the Won transition is blocked otherwise.
                  </>
                )}
              </div>
              {isGatedRole && (
                <ProposalGateBypassToggle
                  leadId={lead.id}
                  currentlyBypassed={lead.proposal_gate_bypassed ?? false}
                />
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Detailed proposal nudge — shown when quick quote exists but detailed proposal not yet created */}
      {needsDetailedProposalNudge && (
        <Card className="border-l-4 border-l-amber-400 bg-amber-50/30">
          <CardContent className="py-3">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="text-sm text-n-800">
                <span className="font-semibold">Detailed proposal not created yet</span>{' '}
                — needed before this lead can be marked <strong>Won</strong>. Create it now in the Proposal tab.
              </div>
              <Link href={`/leads/${id}/proposal`}>
                <Button size="sm" variant="outline" className="border-amber-500 text-amber-700 hover:bg-amber-50">
                  Go to Proposal tab
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Closure Soon banner - shows live margin band + Attempt Won button */}
      {lead.status === 'closure_soon' && margin && (
        <Card className="border-l-4 border-l-amber-500 bg-amber-50/40">
          <CardContent className="py-4">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="space-y-2 flex-1 min-w-[240px]">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-sm font-semibold text-n-800">Closure Soon</span>
                  <ClosureBandBadge
                    band={margin.band}
                    grossMargin={margin.grossMargin}
                    dataQuality={margin.dataQuality}
                    size="lg"
                  />
                </div>
                <ClosureBandHelper band={margin.band} dataQuality={margin.dataQuality} />
                <div className="text-xs text-n-500 font-mono">
                  Base: ₹{Math.round(margin.basePrice).toLocaleString('en-IN')} · BOM cost: ₹
                  {Math.round(margin.bomCost).toLocaleString('en-IN')} · Site est: ₹
                  {Math.round(margin.siteExpensesEst).toLocaleString('en-IN')}
                </div>
              </div>
              <div>
                <AttemptWonButton
                  leadId={lead.id}
                  disabled={margin.band === 'red'}
                  canSkipMargin={isGatedRole}
                />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      <LeadTabs leadId={id} showPayments={showPayments} />

      {/* Tab content */}
      {children}
    </div>
  );
}
