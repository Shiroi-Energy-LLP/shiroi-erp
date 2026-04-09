import { createClient } from '@repo/supabase/server';
import Link from 'next/link';
import { Card, CardContent, Badge, Eyebrow, EmptyState } from '@repo/ui';
import { Flag, CheckCircle2, AlertTriangle, BarChart3 } from 'lucide-react';
import { ResolveButton } from './resolve-button';

export const metadata = { title: 'Data Quality' };

const FLAG_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  wrong_data:     { label: 'Wrong Data',     color: 'bg-red-100 text-red-800' },
  duplicate:      { label: 'Duplicate',      color: 'bg-orange-100 text-orange-800' },
  incomplete:     { label: 'Incomplete',     color: 'bg-yellow-100 text-yellow-800' },
  wrong_file:     { label: 'Wrong File',     color: 'bg-purple-100 text-purple-800' },
  wrong_category: { label: 'Wrong Category', color: 'bg-blue-100 text-blue-800' },
  wrong_amount:   { label: 'Wrong Amount',   color: 'bg-pink-100 text-pink-800' },
  wrong_status:   { label: 'Wrong Status',   color: 'bg-indigo-100 text-indigo-800' },
  other:          { label: 'Other',          color: 'bg-gray-100 text-gray-700' },
};

const ENTITY_LINKS: Record<string, (id: string) => string> = {
  lead: (id) => `/leads/${id}`,
  project: (id) => `/projects/${id}`,
  proposal: (id) => `/proposals/${id}`,
  contact: (id) => `/contacts/${id}`,
  company: (id) => `/companies/${id}`,
  vendor: (id) => `/vendors`,
  po: (id) => `/procurement`,
  bom_item: (id) => `/bom-review`,
  file: (_id) => '#',
  invoice: (id) => `/invoices`,
  payment: (id) => `/payments`,
};

interface PageProps {
  searchParams: Promise<{ entity_type?: string; flag_type?: string; page?: string }>;
}

export default async function DataQualityPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const entityTypeFilter = params.entity_type ?? '';
  const flagTypeFilter = params.flag_type ?? '';
  const page = Math.max(1, parseInt(params.page ?? '1', 10));
  const perPage = 50;

  const supabase = await createClient();

  // ── Summary stats ──
  // Cast supabase to any for new tables/columns not yet in generated types
  const sb = supabase as any;
  const [totalRes, unresolvedRes, resolvedWeekRes, summaryRes, verifiedRes] = await Promise.all([
    sb.from('data_flags').select('*', { count: 'exact', head: true }),
    sb.from('data_flags').select('*', { count: 'exact', head: true }).is('resolved_at', null),
    (() => {
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      return sb.from('data_flags').select('*', { count: 'exact', head: true })
        .not('resolved_at', 'is', null).gte('resolved_at', weekAgo.toISOString());
    })(),
    sb.rpc('get_data_flag_summary'),
    // Count verified records (data_verified_at not yet in generated types)
    Promise.all([
      sb.from('leads').select('*', { count: 'exact', head: true }).not('data_verified_at', 'is', null),
      sb.from('projects').select('*', { count: 'exact', head: true }).not('data_verified_at', 'is', null),
      sb.from('proposals').select('*', { count: 'exact', head: true }).not('data_verified_at', 'is', null),
    ]),
  ]);

  const totalFlags = totalRes.count ?? 0;
  const unresolvedFlags = unresolvedRes.count ?? 0;
  const resolvedThisWeek = resolvedWeekRes.count ?? 0;
  const summary = (summaryRes.data ?? []) as { entity_type: string; total_flags: number; unresolved_flags: number; resolved_flags: number }[];
  const [verifiedLeads, verifiedProjects, verifiedProposals] = verifiedRes;
  const totalVerified = (verifiedLeads.count ?? 0) + (verifiedProjects.count ?? 0) + (verifiedProposals.count ?? 0);

  // ── Flags list ──
  let flagsQuery = sb
    .from('data_flags')
    .select('*', { count: 'estimated' })
    .is('resolved_at', null)
    .order('flagged_at', { ascending: false })
    .range((page - 1) * perPage, page * perPage - 1);

  if (entityTypeFilter) flagsQuery = flagsQuery.eq('entity_type', entityTypeFilter);
  if (flagTypeFilter) flagsQuery = flagsQuery.eq('flag_type', flagTypeFilter);

  const { data: flags, count: flagsCount } = await flagsQuery;
  const flagsList = (flags ?? []) as any[];
  const totalPages = Math.ceil((flagsCount ?? 0) / perPage);

  // ── Unique entity types for filter ──
  const entityTypes = [...new Set(summary.map((s) => s.entity_type))];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Eyebrow className="mb-1">DATA QUALITY</Eyebrow>
        <h1 className="text-2xl font-heading font-bold text-[#1A1D24]">Data Quality Dashboard</h1>
        <p className="text-sm text-[#7C818E]">
          Flag issues, verify data, track cleanup progress
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-100">
                <Flag className="h-5 w-5 text-orange-600" />
              </div>
              <div>
                <p className="text-2xl font-heading font-bold text-[#1A1D24]">{unresolvedFlags}</p>
                <p className="text-xs text-[#7C818E]">Unresolved Flags</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-100">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-2xl font-heading font-bold text-[#1A1D24]">{resolvedThisWeek}</p>
                <p className="text-xs text-[#7C818E]">Resolved This Week</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100">
                <BarChart3 className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-heading font-bold text-[#1A1D24]">{totalFlags}</p>
                <p className="text-xs text-[#7C818E]">Total Flags (All Time)</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100">
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              </div>
              <div>
                <p className="text-2xl font-heading font-bold text-[#1A1D24]">{totalVerified}</p>
                <p className="text-xs text-[#7C818E]">Records Verified</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* By Entity Type */}
      {summary.length > 0 && (
        <Card>
          <CardContent className="pt-4">
            <h2 className="text-sm font-heading font-bold text-[#1A1D24] mb-3">Flags by Entity Type</h2>
            <div className="flex flex-wrap gap-3">
              {summary.map((s) => (
                <Link
                  key={s.entity_type}
                  href={`/data-quality?entity_type=${s.entity_type}`}
                  className="flex items-center gap-2 rounded-lg border px-3 py-2 hover:bg-gray-50 transition-colors"
                >
                  <span className="text-sm font-medium capitalize">{s.entity_type.replace(/_/g, ' ')}</span>
                  <Badge variant="outline" className="text-orange-600 border-orange-300">
                    {s.unresolved_flags}
                  </Badge>
                  {s.resolved_flags > 0 && (
                    <span className="text-xs text-green-600">({s.resolved_flags} resolved)</span>
                  )}
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-sm text-[#7C818E]">Filter:</span>
        <Link
          href="/data-quality"
          className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
            !entityTypeFilter && !flagTypeFilter
              ? 'bg-[#00B050] text-white'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          All
        </Link>
        {entityTypes.map((et) => (
          <Link
            key={et}
            href={`/data-quality?entity_type=${et}`}
            className={`px-3 py-1 rounded-full text-xs font-medium capitalize transition-colors ${
              entityTypeFilter === et
                ? 'bg-[#00B050] text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {et.replace(/_/g, ' ')}
          </Link>
        ))}
      </div>

      {/* Flags Table */}
      <Card>
        <CardContent className="p-0">
          {flagsList.length === 0 ? (
            <EmptyState
              icon={<Flag className="h-12 w-12" />}
              title="No unresolved flags"
              description="All data issues have been resolved. Nice work!"
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b text-left text-xs font-medium text-[#7C818E]">
                    <th className="px-4 py-3">Entity</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Field</th>
                    <th className="px-4 py-3">Notes</th>
                    <th className="px-4 py-3">Flagged</th>
                    <th className="px-4 py-3">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {flagsList.map((flag: any) => {
                    const linkFn = ENTITY_LINKS[flag.entity_type];
                    const href = linkFn ? linkFn(flag.entity_id) : '#';
                    const typeConfig = FLAG_TYPE_LABELS[flag.flag_type] ?? { label: 'Other', color: 'bg-gray-100 text-gray-700' };

                    return (
                      <tr key={flag.id} className="border-b last:border-0 hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <Link href={href} className="text-sm text-[#00B050] hover:underline capitalize">
                            {flag.entity_type.replace(/_/g, ' ')}
                          </Link>
                          <p className="text-xs text-gray-400 font-mono">{flag.entity_id.slice(0, 8)}...</p>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${typeConfig.color}`}>
                            {typeConfig.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">
                          {flag.field_name ?? '—'}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600 max-w-[300px] truncate">
                          {flag.notes ?? '—'}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-400">
                          {new Date(flag.flagged_at).toLocaleDateString('en-IN', {
                            day: '2-digit', month: 'short',
                          })}
                        </td>
                        <td className="px-4 py-3">
                          <ResolveButton flagId={flag.id} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center gap-2">
          {page > 1 && (
            <Link
              href={`/data-quality?page=${page - 1}${entityTypeFilter ? `&entity_type=${entityTypeFilter}` : ''}${flagTypeFilter ? `&flag_type=${flagTypeFilter}` : ''}`}
              className="px-3 py-1 rounded bg-gray-100 text-sm hover:bg-gray-200"
            >
              Previous
            </Link>
          )}
          <span className="px-3 py-1 text-sm text-[#7C818E]">
            Page {page} of {totalPages}
          </span>
          {page < totalPages && (
            <Link
              href={`/data-quality?page=${page + 1}${entityTypeFilter ? `&entity_type=${entityTypeFilter}` : ''}${flagTypeFilter ? `&flag_type=${flagTypeFilter}` : ''}`}
              className="px-3 py-1 rounded bg-gray-100 text-sm hover:bg-gray-200"
            >
              Next
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
