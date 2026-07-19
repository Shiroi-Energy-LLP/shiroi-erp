'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, Button, Badge } from '@repo/ui';
import { ChevronDown, ChevronRight, Check, X, CheckCircle2, AlertTriangle } from 'lucide-react';
import { ProjectCombobox } from '@/components/forms/project-combobox';
import type { ParsedBomLine } from '@/lib/bom-sheet-parser';
import type { BomImportRow, PickerProject } from '@/lib/bom-import-queries';
import { approveBomImport, rejectBomImport } from '@/lib/bom-import-actions';
import { BILL_STATUS_OPTIONS, MATCH_CONFIDENCE_CLASS, MATCH_CONFIDENCE_LABEL } from '@/lib/bom-import-constants';

interface Props {
  row: BomImportRow;
  projects: PickerProject[];
}

const numInput = 'w-16 h-7 px-1 text-[11px] text-right tabular-nums border border-n-200 rounded';
const txtInput = 'h-7 px-1.5 text-[11px] border border-n-200 rounded';

export function BomImportRowCard({ row, projects }: Props) {
  const router = useRouter();
  const [expanded, setExpanded] = React.useState(false);
  const [projectId, setProjectId] = React.useState(row.matched_project_id ?? '');
  const [lines, setLines] = React.useState<ParsedBomLine[]>(row.lines);
  const [busy, setBusy] = React.useState<null | 'confirm' | 'skip'>(null);
  const [error, setError] = React.useState<string | null>(null);

  const readOnly = row.status_review !== 'pending';

  function patch(i: number, field: keyof ParsedBomLine, value: string) {
    setLines((prev) => {
      const next = [...prev];
      const numeric = ['quantity', 'unit_price', 'gst_rate', 'total_price', 'actual_quantity', 'actual_unit_price', 'actual_total_price'];
      const v: unknown = numeric.includes(field as string) ? (value === '' ? null : Number(value)) : value === '' ? null : value;
      next[i] = { ...next[i], [field]: v } as ParsedBomLine;
      return next;
    });
  }

  async function handleConfirm() {
    if (!projectId) { setError('Pick a project first'); return; }
    setBusy('confirm');
    setError(null);
    const res = await approveBomImport(row.id, projectId, lines);
    setBusy(null);
    if (!res.success) { setError(res.error); return; }
    router.refresh();
  }

  async function handleSkip() {
    setBusy('skip');
    setError(null);
    const res = await rejectBomImport(row.id, null);
    setBusy(null);
    if (!res.success) { setError(res.error); return; }
    router.refresh();
  }

  const conTotal = lines.reduce((n, l) => n + (l.total_price ?? 0), 0);
  const actTotal = lines.reduce((n, l) => n + (l.actual_total_price ?? 0), 0);

  return (
    <Card>
      <CardContent className="py-3 space-y-2">
        {/* Header row */}
        <div className="flex items-start gap-3">
          <button onClick={() => setExpanded((e) => !e)} className="mt-0.5 text-n-400 hover:text-n-700" aria-label="Toggle lines">
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium text-n-900">{row.project_name}</span>
              <span className="text-[10px] text-n-400 font-mono">{row.sheet_name}</span>
              <Badge className={`text-[10px] ${MATCH_CONFIDENCE_CLASS[row.match_confidence] ?? ''}`}>
                {MATCH_CONFIDENCE_LABEL[row.match_confidence]} {row.match_score > 0 ? row.match_score.toFixed(2) : ''}
              </Badge>
              <span className="text-[10px] text-n-500">{row.line_count} lines</span>
              {row.status_review === 'imported' && (
                <span className="inline-flex items-center gap-1 text-[10px] text-[#16A34A]"><CheckCircle2 className="h-3 w-3" /> Imported</span>
              )}
              {row.status_review === 'error' && (
                <span className="inline-flex items-center gap-1 text-[10px] text-red-600"><AlertTriangle className="h-3 w-3" /> {row.import_error}</span>
              )}
            </div>

            {!readOnly && (
              <div className="mt-2 flex items-center gap-2 flex-wrap">
                <ProjectCombobox
                  projects={projects}
                  value={projectId}
                  onChange={setProjectId}
                  placeholder="Match to project…"
                  className="w-80"
                  inputClassName="h-8 text-xs"
                />
                {/* candidate chips */}
                {row.match_candidates.slice(0, 4).map((c) => (
                  <button
                    key={c.project_id}
                    onClick={() => setProjectId(c.project_id)}
                    className={`px-2 py-0.5 rounded-full text-[10px] border transition-colors ${
                      projectId === c.project_id ? 'bg-shiroi-gold/20 border-shiroi-gold text-shiroi-ink' : 'border-n-200 text-n-600 hover:bg-n-50'
                    }`}
                    title={c.project_number}
                  >
                    {c.customer_name} · {c.score.toFixed(2)}
                  </button>
                ))}
              </div>
            )}
          </div>

          {!readOnly && (
            <div className="flex items-center gap-2 flex-shrink-0">
              <Button size="sm" variant="outline" className="h-8 text-[11px] gap-1" onClick={handleSkip} disabled={busy !== null}>
                <X className="h-3 w-3" /> Skip
              </Button>
              <Button size="sm" className="h-8 text-[11px] gap-1" onClick={handleConfirm} disabled={busy !== null || !projectId}>
                <Check className="h-3 w-3" /> {busy === 'confirm' ? 'Importing…' : 'Confirm'}
              </Button>
            </div>
          )}
        </div>

        {error && <p className="text-[11px] text-red-600 ml-7">{error}</p>}

        {/* Editable line table */}
        {expanded && (
          <div className="ml-7 border border-n-200 rounded overflow-x-auto">
            <table className="text-[11px] min-w-[1100px] w-full">
              <thead className="bg-n-50">
                <tr className="text-[9px] uppercase tracking-wide text-n-500">
                  <th className="px-1.5 py-1 text-left">Category</th>
                  <th className="px-1.5 py-1 text-left">Description</th>
                  <th className="px-1.5 py-1 text-left">Make</th>
                  <th className="px-1.5 py-1 text-right" colSpan={4}>Contracted (qty · unit · rate · total)</th>
                  <th className="px-1.5 py-1 text-right" colSpan={3}>Actual (qty · rate · total)</th>
                  <th className="px-1.5 py-1 text-left">Voucher</th>
                  <th className="px-1.5 py-1 text-left">Bill</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i} className="border-t border-n-100 align-top">
                    <td className="px-1 py-1"><input className={`${txtInput} w-28`} value={l.item_category ?? ''} onChange={(e) => patch(i, 'item_category', e.target.value)} disabled={readOnly} /></td>
                    <td className="px-1 py-1"><input className={`${txtInput} w-52`} value={l.item_description ?? ''} onChange={(e) => patch(i, 'item_description', e.target.value)} disabled={readOnly} /></td>
                    <td className="px-1 py-1"><input className={`${txtInput} w-20`} value={l.make ?? ''} onChange={(e) => patch(i, 'make', e.target.value)} disabled={readOnly} /></td>
                    <td className="px-1 py-1"><input className={numInput} value={l.quantity ?? ''} onChange={(e) => patch(i, 'quantity', e.target.value)} disabled={readOnly} /></td>
                    <td className="px-1 py-1"><input className={`${txtInput} w-14`} value={l.unit ?? ''} onChange={(e) => patch(i, 'unit', e.target.value)} disabled={readOnly} /></td>
                    <td className="px-1 py-1"><input className={numInput} value={l.unit_price ?? ''} onChange={(e) => patch(i, 'unit_price', e.target.value)} disabled={readOnly} /></td>
                    <td className="px-1 py-1"><input className={numInput} value={l.total_price ?? ''} onChange={(e) => patch(i, 'total_price', e.target.value)} disabled={readOnly} /></td>
                    <td className="px-1 py-1"><input className={numInput} value={l.actual_quantity ?? ''} onChange={(e) => patch(i, 'actual_quantity', e.target.value)} disabled={readOnly} /></td>
                    <td className="px-1 py-1"><input className={numInput} value={l.actual_unit_price ?? ''} onChange={(e) => patch(i, 'actual_unit_price', e.target.value)} disabled={readOnly} /></td>
                    <td className="px-1 py-1"><input className={numInput} value={l.actual_total_price ?? ''} onChange={(e) => patch(i, 'actual_total_price', e.target.value)} disabled={readOnly} /></td>
                    <td className="px-1 py-1"><input className={`${txtInput} w-20`} value={l.voucher_no ?? ''} onChange={(e) => patch(i, 'voucher_no', e.target.value)} disabled={readOnly} placeholder="MT/VN" /></td>
                    <td className="px-1 py-1">
                      <select className={`${txtInput} w-24`} value={l.bill_status} onChange={(e) => patch(i, 'bill_status', e.target.value)} disabled={readOnly}>
                        {BILL_STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-n-200 bg-n-50 text-[10px] font-medium text-n-600">
                  <td className="px-1.5 py-1" colSpan={6}>Totals (incl. GST)</td>
                  <td className="px-1.5 py-1 text-right tabular-nums">{Math.round(conTotal).toLocaleString('en-IN')}</td>
                  <td className="px-1.5 py-1" colSpan={2} />
                  <td className="px-1.5 py-1 text-right tabular-nums">{Math.round(actTotal).toLocaleString('en-IN')}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
