import { EmptyState, Button } from '@repo/ui';
import { FileText } from 'lucide-react';

export function NoProposals() {
  return (
    <div style={{ maxWidth: 440, border: '1px solid #E5DFD3', borderRadius: 12, background: '#fff' }}>
      <EmptyState
        icon={<FileText size={40} strokeWidth={1.5} />}
        title="No proposals yet"
        description="Create your first proposal to send a quote and move this lead forward."
        action={<Button variant="default" size="sm">Create proposal</Button>}
      />
    </div>
  );
}

export function NoResults() {
  return (
    <div style={{ maxWidth: 440, border: '1px solid #E5DFD3', borderRadius: 12, background: '#fff' }}>
      <EmptyState
        title="No projects match these filters"
        description="Try widening the date range or clearing the stage filter."
        action={<Button variant="outline" size="sm">Clear filters</Button>}
      />
    </div>
  );
}
