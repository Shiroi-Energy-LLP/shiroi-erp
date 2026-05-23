import Link from 'next/link';
import { getLiaisonSummary } from '@/lib/liaison-summary-queries';
import { getAllNetMeteringApplications } from '@/lib/liaison-queries';
import type { LiaisonFilter } from '@/lib/liaison-queries';
import { formatDate } from '@repo/ui/formatters';
import { Card, CardContent, Eyebrow } from '@repo/ui';
import { Globe, AlertCircle, ShieldCheck, ShieldAlert, Zap } from 'lucide-react';
import { TnebStageBadge, CeigStageBadge, AwaitingClientBadge } from '@/components/liaison/liaison-status-badge';

interface LiaisonPageProps {
  searchParams: Promise<{ filter?: string; search?: string }>;
}

const CARD_DEFS = [
  {
    key: 'all' as const,
    label: 'Total Applications',
    summaryKey: 'total' as const,
    icon: Globe,
    bgColor: 'bg-blue-100',
    iconColor: 'text-blue-600',
  },
  {
    key: 'awaiting_client' as const,
    label: 'Awaiting Client',
    summaryKey: 'awaiting_client' as const,
    icon: AlertCircle,
    bgColor: 'bg-amber-100',
    iconColor: 'text-amber-600',
  },
  {
    key: 'ceig_pending' as const,
    label: 'CEIG Pending',
    summaryKey: 'ceig_pending' as const,
    icon: ShieldAlert,
    bgColor: 'bg-orange-100',
    iconColor: 'text-orange-600',
  },
  {
    key: 'ceig_in_process' as const,
    label: 'CEIG In Process',
    summaryKey: 'ceig_in_process' as const,
    icon: ShieldCheck,
    bgColor: 'bg-purple-100',
    iconColor: 'text-purple-600',
  },
  {
    key: 'tneb_active' as const,
    label: 'TNEB Active',
    summaryKey: 'tneb_active' as const,
    icon: Zap,
    bgColor: 'bg-green-100',
    iconColor: 'text-green-600',
  },
] as const;

export default async function LiaisonPage({ searchParams }: LiaisonPageProps) {
  const op = '[LiaisonPage]';
  const params = await searchParams;

  const rawFilter = params.filter;
  const activeFilter: LiaisonFilter =
    rawFilter === 'awaiting_client' ||
    rawFilter === 'ceig_pending' ||
    rawFilter === 'ceig_in_process' ||
    rawFilter === 'tneb_active'
      ? rawFilter
      : 'all';

  const summary = await getLiaisonSummary();
  let applications: any[] = [];
  try {
    applications = await getAllNetMeteringApplications({ filter: activeFilter, search: params.search });
  } catch (err) {
    console.error(`${op} Failed to load applications:`, { error: err instanceof Error ? err.message : String(err), timestamp: new Date().toISOString() });
  }

  const now = new Date();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Eyebrow className="mb-1">LIAISON</Eyebrow>
        <h1 className="text-2xl font-heading font-bold text-[#1A1D24]">Liaison</h1>
        <p className="text-sm text-[#7C818E] mt-1">
          CEIG clearances, TNEB net-metering applications, and follow-up tracking.
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        {CARD_DEFS.map((card) => {
          const Icon = card.icon;
          const isActive = activeFilter === card.key || (card.key === 'all' && activeFilter === 'all');
          const href = card.key === 'all' ? '/liaison' : `/liaison?filter=${card.key}`;
          return (
            <Link key={card.key} href={href} className="block group">
              <Card className={`transition-shadow hover:shadow-md ${isActive ? 'ring-2 ring-[#00B050]' : ''}`}>
                <CardContent className="flex items-center gap-3 p-4">
                  <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${card.bgColor}`}>
                    <Icon className={`h-4 w-4 ${card.iconColor}`} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-[#7C818E] leading-tight">{card.label}</p>
                    <p className="text-xl font-heading font-bold text-[#1A1D24]">
                      {summary[card.summaryKey]}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>

      {/* Active filter chip */}
      {activeFilter !== 'all' && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-n-600">
            Filtered: {CARD_DEFS.find((c) => c.key === activeFilter)?.label}
          </span>
          <Link href="/liaison" className="text-xs text-[#00B050] hover:underline">
            × Clear
          </Link>
        </div>
      )}

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-n-50 border-b-2 border-n-200 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-n-600 uppercase tracking-wider">Project</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-n-600 uppercase tracking-wider">kWp</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-n-600 uppercase tracking-wider">CEIG</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-n-600 uppercase tracking-wider">TNEB Stage</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-n-600 uppercase tracking-wider">App. Date</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-n-600 uppercase tracking-wider">Next Follow-up</th>
                </tr>
              </thead>
              <tbody>
                {applications.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-16 text-center text-sm text-n-500">
                      No applications found{activeFilter !== 'all' ? ' for this filter' : ''}.
                    </td>
                  </tr>
                ) : (
                  applications.map((app, i) => {
                    const followupDate = app.next_followup_date ? new Date(app.next_followup_date) : null;
                    const followupOverdue = followupDate && followupDate < now;
                    return (
                      <tr
                        key={app.id}
                        className={`h-10 border-b border-n-100 hover:bg-[#00B050]/[0.04] ${i % 2 === 1 ? 'bg-n-50/30' : ''}`}
                      >
                        <td className="px-3 py-2">
                          {app.projects ? (
                            <Link
                              href={`/liaison/net-metering/${app.project_id}`}
                              className="font-medium text-n-900 hover:text-[#00B050] hover:underline"
                            >
                              {app.projects.project_number} — {app.projects.customer_name}
                            </Link>
                          ) : (
                            <span className="text-n-400">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums text-n-600">
                          {app.projects?.system_size_kwp != null
                            ? Number(app.projects.system_size_kwp).toFixed(1)
                            : '—'}
                        </td>
                        <td className="px-3 py-2">
                          {app.ceig_required ? (
                            <CeigStageBadge status={app.ceig_status ?? 'pending'} />
                          ) : (
                            <span className="text-xs text-n-400">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <TnebStageBadge status={app.discom_status ?? 'pending'} />
                            {app.awaiting_client_details && <AwaitingClientBadge />}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-n-600 font-mono tabular-nums text-xs">
                          {app.discom_application_date ? formatDate(app.discom_application_date) : '—'}
                        </td>
                        <td className={`px-3 py-2 font-mono tabular-nums text-xs ${followupOverdue ? 'text-red-600 font-semibold' : 'text-n-600'}`}>
                          {followupDate ? formatDate(app.next_followup_date) : '—'}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
