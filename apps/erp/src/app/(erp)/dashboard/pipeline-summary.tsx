'use client';

import { Card, CardHeader, CardTitle, CardContent } from '@repo/ui';
import { shortINR } from '@repo/ui/formatters';

interface PipelineData {
  count: number;
  totalValue: number;
}

export function PipelineSummary({ pipeline }: { pipeline: PipelineData }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Pipeline</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          <div>
            <p className="text-3xl font-bold">{shortINR(pipeline.totalValue)}</p>
            <p className="text-sm text-muted-foreground">Total pipeline value</p>
          </div>
          <div>
            <p className="text-lg font-semibold">{pipeline.count}</p>
            <p className="text-sm text-muted-foreground">Active proposals</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
