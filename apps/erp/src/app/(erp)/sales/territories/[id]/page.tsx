/**
 * /sales/territories/[id] — Territory detail
 *
 * Server component showing metadata for a single territory:
 *   name, segment, active status, assignee, cities, lead count.
 *
 * Admin page — founder + marketing_manager only (mirrors the parent list page).
 */

import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getUserProfile } from '@/lib/auth';
import { getTerritory, countLeadsInTerritory } from '@/lib/sales-territories-queries';
import {
  TERRITORY_SEGMENT_LABELS,
  type TerritorySegment,
} from '@/lib/sales-territories-constants';
import { Badge, Card, CardContent, CardHeader, CardTitle, Button, Eyebrow } from '@repo/ui';
import { ArrowLeft, Map } from 'lucide-react';

export const dynamic = 'force-dynamic';

interface TerritoryDetailProps {
  params: Promise<{ id: string }>;
}

export default async function TerritoryDetailPage({ params }: TerritoryDetailProps) {
  const profile = await getUserProfile();
  if (!profile) redirect('/login');
  if (profile.role !== 'founder' && profile.role !== 'marketing_manager') {
    redirect('/dashboard');
  }

  const { id } = await params;
  const territory = await getTerritory(id);
  if (!territory) notFound();

  const leadCount = await countLeadsInTerritory(territory.cities);

  const segmentLabel = territory.segment
    ? (TERRITORY_SEGMENT_LABELS[territory.segment as TerritorySegment] ?? territory.segment)
    : 'Any segment';

  // City filter URL — comma-joined query value that /sales already understands
  // for the city filter chain. For now we link to /sales unfiltered since the
  // list page does not currently take a multi-city filter param; users can
  // narrow further from the sales page once they're there.
  const leadsHref = '/sales';

  return (
    <div className="space-y-6">
      {/* Header / breadcrumb */}
      <div className="space-y-2">
        <Link
          href="/sales/territories"
          className="inline-flex items-center gap-1 text-sm text-n-500 hover:text-n-700"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to territories
        </Link>

        <div className="flex items-start justify-between gap-4">
          <div>
            <Eyebrow className="mb-1">TERRITORY</Eyebrow>
            <h1 className="text-2xl font-heading font-bold text-n-900">
              {territory.territory_name}
            </h1>
          </div>
          <Badge variant={territory.active ? 'default' : 'secondary'}>
            {territory.active ? 'Active' : 'Inactive'}
          </Badge>
        </div>
      </div>

      {/* Metadata card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Metadata</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-8 gap-y-4 text-sm">
            <div>
              <dt className="text-xs text-n-500 font-medium uppercase tracking-wider">
                Segment
              </dt>
              <dd className="mt-1 text-n-900">{segmentLabel}</dd>
            </div>
            <div>
              <dt className="text-xs text-n-500 font-medium uppercase tracking-wider">
                Default assignee
              </dt>
              <dd className="mt-1 text-n-900">
                {territory.assignee_name ?? (
                  <span className="text-n-400 italic">Unassigned (fallback routing)</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-n-500 font-medium uppercase tracking-wider">
                Cities ({territory.cities.length})
              </dt>
              <dd className="mt-1">
                {territory.cities.length === 0 ? (
                  <span className="text-n-400 text-xs">No cities</span>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {territory.cities.map((city) => (
                      <span
                        key={city}
                        className="inline-block px-2 py-0.5 rounded bg-n-100 text-n-700 text-xs"
                      >
                        {city}
                      </span>
                    ))}
                  </div>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-n-500 font-medium uppercase tracking-wider">
                Leads in cities
              </dt>
              <dd className="mt-1 text-n-900">
                <span className="font-heading text-lg font-bold">{leadCount}</span>
                <Link
                  href={leadsHref}
                  className="ml-3 text-xs text-shiroi-green hover:underline"
                >
                  View leads →
                </Link>
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      {/* Empty cities help */}
      {territory.cities.length === 0 && (
        <Card className="border-amber-200 bg-amber-50/30">
          <CardContent className="py-4">
            <div className="flex items-start gap-3">
              <Map className="h-5 w-5 text-amber-700 flex-shrink-0 mt-0.5" />
              <div className="space-y-2">
                <p className="text-sm text-amber-900 font-medium">
                  No cities assigned to this territory.
                </p>
                <p className="text-xs text-amber-800">
                  AI routing relies on the cities array — add at least one city for new leads
                  to route here automatically.
                </p>
                <Link href="/sales/territories">
                  <Button variant="outline" size="sm" className="mt-1">
                    Edit territory
                  </Button>
                </Link>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
