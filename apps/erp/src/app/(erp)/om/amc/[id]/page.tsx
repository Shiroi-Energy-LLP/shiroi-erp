/**
 * /om/amc/[id] — AMC contract detail page.
 *
 * Opened by clicking the "Scheduled Visits" cell on /om/amc. Replaces the old
 * inline expander with a full page: contract header (incl. Service Amount for
 * paid AMCs), then one card per scheduled visit carrying its editable details,
 * service reports (view + download), per-visit Work Activity timeline, and a
 * delete action.
 *
 * NEVER-DO compliance:
 * - #12: annual_value is displayed, never summed in JS.
 * - #15: no inline Supabase — reads go through amc-actions.ts.
 * - #21: client children import constants from amc-constants.ts.
 * - #24: no writes during render.
 */

import { notFound } from 'next/navigation';
import Link from 'next/link';
import {
  getAmcContractDetail,
  getVisitsForContract,
  getVisitEvents,
} from '@/lib/amc-actions';
import { getActiveEmployees } from '@/lib/tasks-actions';
import { getUserProfile } from '@/lib/auth';
import { formatDate, formatDateFromTimestamp, formatINR } from '@repo/ui/formatters';
import { Card, CardContent, Badge } from '@repo/ui';
import { ArrowLeft, CalendarCheck } from 'lucide-react';
import { AmcVisitCard } from '@/components/om/amc-visit-card';
import { AmcStatusToggle } from '@/components/om/amc-status-toggle';
import { DeleteAmcButton } from '@/components/om/delete-amc-button';
import { AMC_CATEGORY_LABELS, AMC_DELETE_ROLES, AMC_OPEN_STATUSES } from '@/lib/amc-constants';

interface PageProps {
  params: Promise<{ id: string }>;
}

function MetaItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-n-500">{label}</div>
      <div className="mt-0.5 text-sm text-n-800">{children}</div>
    </div>
  );
}

export default async function AmcDetailPage({ params }: PageProps) {
  const { id } = await params;

  const [contract, visits, employees, profile] = await Promise.all([
    getAmcContractDetail(id),
    getVisitsForContract(id),
    getActiveEmployees(),
    getUserProfile(),
  ]);

  if (!contract) notFound();

  // Activity per visit, fetched in parallel — one small indexed query each
  // (idx_om_visit_events_visit), and a contract holds a handful of visits.
  const eventsByVisit = new Map(
    await Promise.all(
      visits.map(async (v) => [v.id, await getVisitEvents(v.id)] as const),
    ),
  );

  const isFree = contract.amc_category === 'free_amc';
  const isPaid = contract.amc_category === 'paid_amc';
  const isOpen = (AMC_OPEN_STATUSES as readonly string[]).includes(contract.status);
  const canDelete = profile?.role
    ? (AMC_DELETE_ROLES as readonly string[]).includes(profile.role)
    : false;

  const completedCount = visits.filter((v) => v.status === 'completed').length;
  const lastCompletedAt = visits
    .map((v) => v.completed_at)
    .filter((d): d is string => Boolean(d))
    .sort()
    .at(-1) ?? null;
  const nextVisitDate = visits
    .filter((v) => v.status !== 'completed' && v.status !== 'cancelled')
    .map((v) => v.scheduled_date)
    .sort()
    .at(0) ?? null;

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      <Link href="/om/amc" className="inline-flex items-center gap-1 text-xs text-n-500 hover:text-n-800">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to AMC schedule
      </Link>

      {/* ── Contract header ── */}
      <Card>
        <CardContent className="py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[11px] text-n-400">{contract.contract_number}</span>
                <Badge variant={isFree ? 'outline' : 'info'} className="text-[11px]">
                  {AMC_CATEGORY_LABELS[contract.amc_category ?? ''] ?? 'AMC'}
                </Badge>
                <AmcStatusToggle contractId={contract.id} currentStatus={contract.status} />
              </div>
              <h1 className="mt-1 break-words text-lg font-heading font-bold text-n-900">
                {contract.projects ? (
                  <Link href={`/projects/${contract.project_id}`} className="hover:underline">
                    {contract.projects.customer_name}
                  </Link>
                ) : (
                  'AMC Contract'
                )}
              </h1>
            </div>
            {canDelete && (
              <div className="flex-shrink-0">
                <DeleteAmcButton contractId={contract.id} contractNumber={contract.contract_number} />
              </div>
            )}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MetaItem label="Start Date">{formatDate(contract.start_date)}</MetaItem>
            <MetaItem label="End Date">{formatDate(contract.end_date)}</MetaItem>
            <MetaItem label="Visits Completed">
              {completedCount} / {visits.length || contract.visits_included}
            </MetaItem>
            <MetaItem label="Next Visit">
              {nextVisitDate ? formatDate(nextVisitDate) : '—'}
            </MetaItem>
            <MetaItem label="Completed Date">
              {/* completed_at is TIMESTAMPTZ — this was the "Invalid Date" bug. */}
              {lastCompletedAt ? formatDateFromTimestamp(lastCompletedAt) : '—'}
            </MetaItem>
            <MetaItem label="Duration">
              {contract.amc_duration_months ? `${contract.amc_duration_months} months` : '—'}
            </MetaItem>
            <MetaItem label="Status">{isOpen ? 'Open' : 'Closed'}</MetaItem>
            {/* Service Amount is meaningful only for paid AMCs. */}
            {isPaid && (
              <MetaItem label="Service Amount">
                <span className="font-medium tabular-nums">
                  {(contract.annual_value ?? 0) > 0 ? formatINR(contract.annual_value) : '—'}
                </span>
              </MetaItem>
            )}
          </div>

          {contract.notes && (
            <div className="mt-4 border-t border-n-150 pt-3">
              <div className="text-[11px] uppercase tracking-wider text-n-500">Notes</div>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm text-n-700">{contract.notes}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Scheduled visits ── */}
      <div className="space-y-2">
        <h2 className="text-sm font-heading font-bold text-n-900">
          Scheduled Visits{' '}
          <span className="text-xs font-normal text-n-500">({visits.length})</span>
        </h2>

        {visits.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <CalendarCheck className="mb-3 h-10 w-10 text-n-300" />
              <h3 className="text-sm font-heading font-bold text-n-700">No visits generated yet</h3>
              <p className="mt-1 max-w-[320px] text-xs text-n-500">
                Visits are created automatically when the AMC contract is set up.
              </p>
            </CardContent>
          </Card>
        ) : (
          visits.map((visit) => (
            <AmcVisitCard
              key={visit.id}
              visit={visit}
              contractId={contract.id}
              employees={employees}
              events={eventsByVisit.get(visit.id) ?? []}
              canDelete={canDelete}
            />
          ))
        )}
      </div>
    </div>
  );
}
