/**
 * Tab 3 — Quote comparison matrix.
 *
 * Server component. Renders the empty state if no quotes have been submitted
 * across any open RFQ for this project; otherwise delegates to the interactive
 * `<ComparisonMatrix>` client component (Phase 4).
 */

import { Card, CardContent } from '@repo/ui';
import { BarChart3 } from 'lucide-react';
import type { Database } from '@repo/types/database';
import type { ComparisonMatrix as ComparisonData } from '@/lib/rfq-queries';
import { ComparisonMatrix } from '../_client/comparison-matrix';

type AppRole = Database['public']['Enums']['app_role'];

interface TabComparisonProps {
  projectId: string;
  comparison: ComparisonData | null;
  viewerRole: AppRole;
}

export function TabComparison({ comparison }: TabComparisonProps) {
  if (!comparison) {
    return (
      <Card>
        <CardContent className="py-16 text-center">
          <BarChart3 className="w-10 h-10 text-n-300 mx-auto mb-2" />
          <p className="text-sm font-medium text-n-700">No quotes to compare yet</p>
          <p className="text-xs text-n-500 mt-1">
            Send an RFQ from the RFQ tab, then return here once vendors submit quotes.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-3">
        <ComparisonMatrix comparison={comparison} />
      </CardContent>
    </Card>
  );
}
