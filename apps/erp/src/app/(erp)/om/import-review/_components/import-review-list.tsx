'use client';

import * as React from 'react';
import { ImportRowCard } from './import-row-card';
import { BulkApproveBar } from './bulk-approve-bar';
import type { PendingImport, PendingChild } from '@/lib/import-review-queries';
import { getPendingChildren } from '@/lib/import-review-queries';

interface ProjectOpt {
  id: string;
  customer_name: string;
  project_number: string | null;
  project_name?: string | null;
}

interface Props {
  items: PendingImport[];
  projects: ProjectOpt[];
}

export function ImportReviewList({ items, projects }: Props) {
  const [selected, setSelected] = React.useState<Set<string>>(new Set());

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Set());
  }

  // Server action wrapper for child fetch
  async function fetchChildren(id: string): Promise<PendingChild[]> {
    return await getPendingChildren(id);
  }

  return (
    <>
      <div className="space-y-2">
        {items.map((row) => (
          <ImportRowCard
            key={row.id}
            row={row}
            selected={selected.has(row.id)}
            onToggleSelect={() => toggle(row.id)}
            fetchChildren={fetchChildren}
            projects={projects}
          />
        ))}
      </div>
      <BulkApproveBar selectedIds={[...selected]} onClear={clearSelection} />
    </>
  );
}
