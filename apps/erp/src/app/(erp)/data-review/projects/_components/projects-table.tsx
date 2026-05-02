'use client';

// apps/erp/src/app/(erp)/data-review/projects/_components/projects-table.tsx
// Expandable row list. Click a row header → expand ProjectEditRow below.

import { useState } from 'react';
import { Card, CardContent, Badge } from '@repo/ui';
import { formatINR } from '@repo/ui/formatters';
import { ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react';
import type { ReviewProjectRow } from '@/lib/data-review-queries';
import { ProjectEditRow } from './project-edit-row';

interface Props {
  rows: ReviewProjectRow[];
  showActions?: boolean;
}

export function ProjectsTable({ rows, showActions = true }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-[#7C818E]">
          No projects in this tab.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="rounded-md border border-[#E5E7EB] overflow-hidden">
      {/* Header */}
      <div className="grid grid-cols-[2fr_3fr_1fr_2fr_2fr_1fr] gap-3 bg-[#F9FAFB] px-4 py-2 text-xs font-semibold text-[#7C818E] uppercase tracking-wide">
        <span>Project #</span>
        <span>Customer</span>
        <span>kWp</span>
        <span>₹ Order Value</span>
        <span>Flags</span>
        <span />
      </div>

      {rows.map((row) => (
        <div key={row.id} className="border-t border-[#E5E7EB]">
          {/* Clickable row header */}
          <button
            type="button"
            className="w-full grid grid-cols-[2fr_3fr_1fr_2fr_2fr_1fr] gap-3 px-4 py-3 text-left hover:bg-[#F9FAFB] transition-colors"
            onClick={() =>
              setExpandedId(expandedId === row.id ? null : row.id)
            }
          >
            {/* Project # */}
            <span className="text-sm font-medium text-[#1A1D24] font-mono">
              {row.project_number}
            </span>
            {/* Customer */}
            <span className="text-sm text-[#1A1D24] truncate">{row.customer_name}</span>
            {/* kWp */}
            <span className={`text-sm tabular-nums ${row.system_size_uncertain ? 'text-amber-600 font-semibold' : 'text-[#1A1D24]'}`}>
              {row.system_size_kwp > 0 ? row.system_size_kwp : '—'}
            </span>
            {/* ₹ */}
            <span className={`text-sm tabular-nums ${row.financials_invalidated ? 'text-red-600 font-semibold' : 'text-[#1A1D24]'}`}>
              {row.contracted_value > 0 ? formatINR(row.contracted_value) : '—'}
            </span>
            {/* Flags */}
            <span className="flex flex-wrap gap-1 items-center">
              {row.is_likely_duplicate && (
                <Badge variant="destructive" className="text-[10px] px-1 py-0">LikelyDup</Badge>
              )}
              {row.hubspot_deal_id && (
                <Badge variant="secondary" className="text-[10px] px-1 py-0">HubSpot</Badge>
              )}
              {row.pv_ref_in_notes && (
                <span className="text-[10px] text-[#7C818E] font-mono">{row.pv_ref_in_notes}</span>
              )}
              {(row.financials_invalidated || row.system_size_uncertain) && (
                <AlertTriangle className="h-3 w-3 text-amber-500" />
              )}
            </span>
            {/* Chevron */}
            <span className="flex items-center justify-end">
              {expandedId === row.id ? (
                <ChevronDown className="h-4 w-4 text-[#7C818E]" />
              ) : (
                <ChevronRight className="h-4 w-4 text-[#7C818E]" />
              )}
            </span>
          </button>

          {/* Expanded edit row */}
          {expandedId === row.id && (
            <div className="bg-[#F9FAFB] border-t border-[#E5E7EB] px-4 py-4">
              {showActions ? (
                <ProjectEditRow
                  row={row}
                  onDone={() => setExpandedId(null)}
                />
              ) : (
                <ReadOnlyDetails row={row} />
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ReadOnlyDetails({ row }: { row: ReviewProjectRow }) {
  return (
    <div className="text-sm text-[#7C818E] space-y-1">
      {row.pv_ref_in_notes && <p>PV ref: <span className="font-mono">{row.pv_ref_in_notes}</span></p>}
      {row.drive_link && (
        <p>Drive: <a href={row.drive_link} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">link</a></p>
      )}
      <p>Status: <span className="font-medium text-[#1A1D24]">{row.review_status}</span></p>
    </div>
  );
}
