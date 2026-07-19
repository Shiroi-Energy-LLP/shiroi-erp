'use client';

import { BomImportRowCard } from './bom-import-row-card';
import type { BomImportRow, PickerProject } from '@/lib/bom-import-queries';

export function BomImportList({ items, projects }: { items: BomImportRow[]; projects: PickerProject[] }) {
  return (
    <div className="space-y-2">
      {items.map((row) => (
        <BomImportRowCard key={row.id} row={row} projects={projects} />
      ))}
    </div>
  );
}
