'use client';

import * as React from 'react';
import Link from 'next/link';
import { Card, CardContent, Badge, Button } from '@repo/ui';
import { ChevronDown, ChevronRight, ExternalLink, CheckCircle2, XCircle, AlertTriangle, Eye, EyeOff, Loader2 } from 'lucide-react';
import { approvePendingImport, rejectPendingImport, updatePendingImportField } from '@/lib/import-review-actions';
import type { PendingImport, PendingChild } from '@/lib/import-review-queries';
import { useRouter } from 'next/navigation';

interface Props {
  row: PendingImport;
  selected: boolean;
  onToggleSelect: () => void;
  fetchChildren: (id: string) => Promise<PendingChild[]>;
}

function formatINR(amt: number | null): string {
  if (amt == null) return '—';
  if (amt >= 10_000_000) return `₹${(amt / 10_000_000).toFixed(2)}Cr`;
  if (amt >= 100_000) return `₹${(amt / 100_000).toFixed(1)}L`;
  return `₹${amt.toLocaleString('en-IN')}`;
}

function matchBadgeVariant(c: string): 'success' | 'warning' | 'outline' {
  if (c === 'exact') return 'success';
  if (c === 'fuzzy') return 'warning';
  return 'outline';
}

function statusBadgeVariant(s: string | null): 'success' | 'info' | 'warning' | 'outline' {
  if (!s) return 'outline';
  const v = s.toLowerCase();
  if (v === 'completed' || v === 'running') return 'success';
  if (v.includes('progress')) return 'info';
  if (v.includes('holding') || v.includes('waiting')) return 'warning';
  return 'outline';
}

function PasswordField({ value, label }: { value: string | null; label: string }) {
  const [revealed, setRevealed] = React.useState(false);
  React.useEffect(() => {
    if (!revealed) return;
    const t = setTimeout(() => setRevealed(false), 30_000);
    return () => clearTimeout(t);
  }, [revealed]);
  if (!value) return null;
  return (
    <div className="flex items-center gap-1.5 text-[11px]">
      <span className="text-n-500 w-24 flex-shrink-0">{label}:</span>
      <span className={`font-mono ${revealed ? 'text-n-900' : 'text-n-500 tracking-widest'}`}>
        {revealed ? value : '••••••••'}
      </span>
      <button onClick={() => setRevealed((r) => !r)} className="text-n-400 hover:text-n-700" aria-label={revealed ? 'Hide' : 'Show'}>
        {revealed ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
      </button>
    </div>
  );
}

export function ImportRowCard({ row, selected, onToggleSelect, fetchChildren }: Props) {
  const router = useRouter();
  const [expanded, setExpanded] = React.useState(false);
  const [pendingAction, setPendingAction] = React.useState<'approve' | 'reject' | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [children, setChildren] = React.useState<PendingChild[] | null>(null);

  React.useEffect(() => {
    if (expanded && row.child_count > 0 && children === null) {
      void fetchChildren(row.id).then(setChildren);
    }
  }, [expanded, row.child_count, row.id, children, fetchChildren]);

  async function handleApprove() {
    setPendingAction('approve');
    setActionError(null);
    const result = await approvePendingImport(row.id);
    setPendingAction(null);
    if (!result.success) {
      setActionError(result.error);
      return;
    }
    router.refresh();
  }

  async function handleReject() {
    const reason = window.prompt('Reason for rejection (optional):');
    if (reason === null) return;
    setPendingAction('reject');
    setActionError(null);
    const result = await rejectPendingImport(row.id, reason.trim() || null);
    setPendingAction(null);
    if (!result.success) {
      setActionError(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            disabled={row.status_review !== 'pending'}
            className="mt-1 flex-shrink-0"
            aria-label="Select row"
          />
          <button onClick={() => setExpanded((e) => !e)} className="text-n-500 hover:text-n-900 mt-0.5">
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-medium text-n-900">{row.project_name}</h3>
              {row.source_status && (
                <Badge variant={statusBadgeVariant(row.source_status)} className="text-[10px] px-1.5 py-0">
                  {row.source_status}
                </Badge>
              )}
              {row.source_year && (
                <span className="text-[10px] text-n-500">{row.source_year}</span>
              )}
              {row.system_size_kwp && (
                <span className="text-[10px] text-n-700 font-medium">{row.system_size_kwp} kWp</span>
              )}
              <Badge variant={matchBadgeVariant(row.match_confidence)} className="text-[10px] px-1.5 py-0">
                {row.match_confidence === 'none' ? 'no match' : `${row.match_confidence} ${row.match_confidence === 'exact' ? '1.00' : row.match_score.toFixed(2)}`}
              </Badge>
              {row.matched_project_id && row.matched_customer_name && (
                <Link
                  href={`/projects/${row.matched_project_id}`}
                  className="text-[10px] text-shiroi-gold-dark hover:underline inline-flex items-center gap-0.5"
                  target="_blank"
                >
                  → {row.matched_customer_name}
                  <ExternalLink className="h-2.5 w-2.5" />
                </Link>
              )}
              {row.child_count > 0 && (
                <Badge variant="info" className="text-[10px] px-1.5 py-0">
                  +{row.child_count} inverters
                </Badge>
              )}
              {row.portal_brand && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 capitalize">
                  {row.portal_brand}
                </Badge>
              )}
            </div>

            <div className="flex items-center gap-2 text-[11px] text-n-600 mt-1 flex-wrap">
              {row.city && <span>{row.city}</span>}
              {row.contact_name && <span>· {row.contact_name}</span>}
              {row.contact_phone && <span>· {row.contact_phone}</span>}
              {row.contact_email && <span>· {row.contact_email}</span>}
              {row.commissioning_date && <span>· commissioned {row.commissioning_date}</span>}
            </div>

            {row.source_sheets.length > 0 && (
              <div className="text-[10px] text-n-400 mt-0.5 truncate">
                Sources: {row.source_sheets.map((s) => s.sheet).join(' · ')}
              </div>
            )}
          </div>

          <div className="flex flex-col items-end gap-1 flex-shrink-0">
            {row.status_review === 'pending' && (
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="default"
                  onClick={handleApprove}
                  disabled={pendingAction !== null}
                  className="h-7 text-xs"
                >
                  {pendingAction === 'approve' ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3 mr-1" />}
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleReject}
                  disabled={pendingAction !== null}
                  className="h-7 text-xs"
                >
                  {pendingAction === 'reject' ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3 mr-1" />}
                  Reject
                </Button>
              </div>
            )}
            {row.status_review === 'imported' && row.imported_project_id && (
              <Link href={`/projects/${row.imported_project_id}`} className="text-[#16A34A] text-[11px] hover:underline inline-flex items-center gap-1" target="_blank">
                <CheckCircle2 className="h-3 w-3" /> Imported
              </Link>
            )}
            {row.status_review === 'rejected' && (
              <span className="text-[11px] text-red-600">Rejected{row.rejection_reason ? `: ${row.rejection_reason}` : ''}</span>
            )}
            {row.status_review === 'error' && (
              <span className="text-[11px] text-amber-600 inline-flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                Error
              </span>
            )}
            {actionError && (
              <span className="text-[10px] text-red-600 max-w-[280px] text-right">{actionError}</span>
            )}
          </div>
        </div>

        {expanded && (
          <ExpandedDetails row={row} children_={children} />
        )}
      </CardContent>
    </Card>
  );
}

function ExpandedDetails({ row, children_ }: { row: PendingImport; children_: PendingChild[] | null }) {
  return (
    <div className="mt-3 pt-3 border-t border-n-100 grid grid-cols-2 gap-3 text-[11px]">
      <div className="space-y-1.5">
        <SectionTitle>Hardware</SectionTitle>
        <KV label="Panel" value={[row.panel_make, row.panel_wattage ? `${row.panel_wattage}Wp` : null, row.panel_qty ? `×${row.panel_qty}` : null].filter(Boolean).join(' ')} />
        <KV label="Inverter" value={[row.inverter_make, row.inverter_capacity_kw ? `${row.inverter_capacity_kw}kW` : null, row.inverter_qty ? `×${row.inverter_qty}` : null].filter(Boolean).join(' ')} />
        <KV label="Inverter SN" value={row.inverter_serial_number} />
        <KV label="System type" value={row.system_type} />
        <KV label="Mounting" value={row.mounting_type} />

        <SectionTitle className="mt-3">Financial</SectionTitle>
        <KV label="Project cost" value={formatINR(row.project_cost)} />
        <KV label="Actual cost" value={formatINR(row.actual_cost)} />
        <KV label="Profit" value={formatINR(row.profit_inr)} />
        <KV label="Industry" value={row.industry} />
        <KV label="Category" value={row.category} />

        <SectionTitle className="mt-3">Location</SectionTitle>
        <KV label="Address" value={row.address_line1} />
        <KV label="City/State" value={[row.city, row.state, row.pincode].filter(Boolean).join(', ')} />
        {row.google_maps_url && (
          <KV label="Map" value={<a href={row.google_maps_url} target="_blank" rel="noopener noreferrer" className="text-shiroi-gold-dark hover:underline inline-flex items-center gap-0.5">link <ExternalLink className="h-2.5 w-2.5" /></a>} />
        )}
        {row.folder_link && (
          <KV label="Folder" value={<a href={row.folder_link} target="_blank" rel="noopener noreferrer" className="text-shiroi-gold-dark hover:underline inline-flex items-center gap-0.5">link <ExternalLink className="h-2.5 w-2.5" /></a>} />
        )}
      </div>

      <div className="space-y-1.5">
        <SectionTitle>Portal credentials</SectionTitle>
        <KV label="Brand" value={row.portal_brand} />
        {row.portal_url && (
          <KV label="URL" value={<a href={row.portal_url} target="_blank" rel="noopener noreferrer" className="text-shiroi-gold-dark hover:underline inline-flex items-center gap-0.5 break-all">{row.portal_url} <ExternalLink className="h-2.5 w-2.5 flex-shrink-0" /></a>} />
        )}
        <KV label="Username" value={<span className="font-mono">{row.portal_username}</span>} />
        <PasswordField label="Password" value={row.portal_password} />

        {(row.local_login_ip || row.local_admin_user) && (
          <>
            <SectionTitle className="mt-3">Local LAN</SectionTitle>
            <KV label="IP" value={row.local_login_ip} />
            <KV label="Admin user" value={row.local_admin_user} />
            <PasswordField label="Admin pwd" value={row.local_admin_password} />
            <KV label="User" value={row.local_user} />
            <PasswordField label="User pwd" value={row.local_user_password} />
          </>
        )}

        {(row.internet_type || row.jio_primary_sim || row.datalogger_mac) && (
          <>
            <SectionTitle className="mt-3">Internet + datalogger</SectionTitle>
            <KV label="Type" value={row.internet_type} />
            <KV label="Jio primary" value={row.jio_primary_sim} />
            <KV label="Jio backup" value={row.jio_backup_sim} />
            <PasswordField label="Jio pwd" value={row.jio_password} />
            <KV label="MAC" value={<span className="font-mono">{row.datalogger_mac}</span>} />
            <KV label="PK" value={<span className="font-mono">{row.datalogger_pk}</span>} />
            <KV label="ACDB SN" value={row.acdb_sn} />
            <KV label="DCDB SN" value={row.dcdb_sn} />
          </>
        )}

        {row.amc_type && (
          <>
            <SectionTitle className="mt-3">AMC schedule</SectionTitle>
            <KV label="Type" value={row.amc_type} />
            {(row.amc_visits ?? []).map((v, i) => (
              <KV key={i} label={`AMC ${i + 1}`} value={`${v.scheduled ?? '—'}${v.completed ? ` · done ${v.completed}` : ''}`} />
            ))}
          </>
        )}

        {row.remarks && (
          <>
            <SectionTitle className="mt-3">Remarks</SectionTitle>
            <div className="text-n-700">{row.remarks}</div>
          </>
        )}

        {row.import_error && (
          <div className="mt-3 p-2 bg-red-50 border border-red-200 rounded text-[11px] text-red-800">
            <strong>Import error:</strong> {row.import_error}
          </div>
        )}
      </div>

      {row.child_count > 0 && (
        <div className="col-span-2 mt-3 pt-3 border-t border-n-100">
          <SectionTitle>Multi-inverter cluster ({row.child_count} sub-inverters)</SectionTitle>
          {children_ === null ? (
            <div className="text-n-400 mt-1">Loading...</div>
          ) : (
            <div className="grid grid-cols-3 gap-2 mt-1">
              {children_.map((c) => (
                <div key={c.id} className="border border-n-100 rounded p-2">
                  <div className="font-medium text-n-700">{c.project_name}</div>
                  <div className="text-n-500 mt-0.5">
                    {c.inverter_capacity_kw ? `${c.inverter_capacity_kw}kW` : '—'}
                    {c.inverter_serial_number ? ` · SN ${c.inverter_serial_number}` : ''}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SectionTitle({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`text-[10px] font-semibold text-n-500 uppercase tracking-wider ${className}`}>{children}</div>;
}

function KV({ label, value }: { label: string; value: React.ReactNode }) {
  if (value == null || value === '' || value === '—') return null;
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-n-500 w-24 flex-shrink-0">{label}:</span>
      <span className="text-n-800 break-words flex-1 min-w-0">{value}</span>
    </div>
  );
}
