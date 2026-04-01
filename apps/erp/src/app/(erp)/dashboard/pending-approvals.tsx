'use client';

import { Card, CardHeader, CardTitle, CardContent, Badge } from '@repo/ui';
import { formatINR, toIST } from '@repo/ui/formatters';

interface PendingProposal {
  id: string;
  proposal_number: string;
  total_after_discount: number;
  created_at: string;
  leads: { customer_name: string } | null;
}

export function PendingApprovals({ proposals }: { proposals: PendingProposal[] }) {
  if (proposals.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pending Approvals</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No proposals waiting for approval.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Pending Approvals
          <Badge variant="warning" className="ml-2">{proposals.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {proposals.map((p) => (
          <div key={p.id} className="flex justify-between items-start text-sm border-b border-border pb-2 last:border-0 last:pb-0">
            <div>
              <p className="font-medium">{p.proposal_number}</p>
              <p className="text-muted-foreground">{p.leads?.customer_name ?? 'Unknown lead'}</p>
            </div>
            <div className="text-right">
              <p className="font-mono font-medium">{formatINR(p.total_after_discount)}</p>
              <p className="text-xs text-muted-foreground">{toIST(p.created_at)}</p>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
