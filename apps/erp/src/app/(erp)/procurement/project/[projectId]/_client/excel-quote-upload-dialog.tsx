'use client';

/**
 * Excel Quote Upload Dialog.
 *
 * Opened from `/procurement/rfq/[id]` (Phase 4 detail page) when the vendor
 * sends an Excel quote file. The Purchase Engineer uploads the file, we parse
 * it client-side with `parseQuoteExcel` (uses xlsx lib), preview the rows, and
 * submit via `submitQuoteFromExcel` server action which matches rows to
 * rfq_items by normalised description and stores the file in the
 * `rfq-excel-uploads` bucket for audit.
 *
 * Self-contained so Phase 4 wiring is a single import.
 */

import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Button,
} from '@repo/ui';
import { formatINR } from '@repo/ui/formatters';
import { Upload, FileSpreadsheet, AlertTriangle } from 'lucide-react';
import { parseQuoteExcel, type ParsedQuoteRow } from '@/lib/excel-quote-parser';
import { submitQuoteFromExcel, uploadRfqQuoteFile } from '@/lib/rfq-actions';

interface ExcelQuoteUploadDialogProps {
  invitationId: string;
  vendorName: string;
  rfqId: string;
  onClose: () => void;
  onSubmitted: () => void;
}

export function ExcelQuoteUploadDialog({
  invitationId,
  vendorName,
  rfqId,
  onClose,
  onSubmitted,
}: ExcelQuoteUploadDialogProps) {
  const [file, setFile] = React.useState<File | null>(null);
  const [parsedRows, setParsedRows] = React.useState<ParsedQuoteRow[]>([]);
  const [warnings, setWarnings] = React.useState<string[]>([]);
  const [parsing, setParsing] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [paymentTerms, setPaymentTerms] = React.useState('100% advance');
  const [deliveryPeriodDays, setDeliveryPeriodDays] = React.useState('14');
  const [error, setError] = React.useState<string | null>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setParsedRows([]);
    setWarnings([]);
    setError(null);

    if (!f) return;

    setParsing(true);
    try {
      const buffer = await f.arrayBuffer();
      const parsed = await parseQuoteExcel(buffer);
      if (!parsed.ok) {
        setError(parsed.error);
      } else {
        setParsedRows(parsed.rows);
        setWarnings(parsed.warnings);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to parse file');
    }
    setParsing(false);
  }

  async function handleSubmit() {
    setError(null);
    if (!file) {
      setError('Select an Excel file first');
      return;
    }
    if (parsedRows.length === 0) {
      setError('No rows parsed from the file');
      return;
    }
    const delDays = Number(deliveryPeriodDays);
    if (!Number.isFinite(delDays) || delDays <= 0) {
      setError('Delivery period must be a positive number of days');
      return;
    }

    setUploading(true);
    try {
      // 1) Upload the raw file via server action (Storage write is server-side
      //    so components don't need an inline Supabase client — CLAUDE.md #15).
      const uploadRes = await uploadRfqQuoteFile({
        rfqId,
        invitationId,
        fileName: file.name,
        file,
      });

      if (!uploadRes.success) {
        setUploading(false);
        setError(`Upload failed: ${uploadRes.error}`);
        return;
      }

      // 2) Submit the parsed rows via server action
      const res = await submitQuoteFromExcel({
        invitationId,
        filePath: uploadRes.data.filePath,
        parsedRows,
        paymentTerms,
        deliveryPeriodDays: delDays,
      });

      setUploading(false);
      if (!res.success) {
        setError(res.error);
        return;
      }
      onSubmitted();
    } catch (e) {
      setUploading(false);
      setError(e instanceof Error ? e.message : 'Submit failed');
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">
            Upload Excel quote from {vendorName}
          </DialogTitle>
          <DialogDescription className="text-xs text-n-500">
            Column layout: S.No • Item Description • Unit Price • GST % (optional, defaults to 18).
          </DialogDescription>
        </DialogHeader>

        {/* File input */}
        <div>
          <label className="block text-[10px] uppercase tracking-wide text-n-500 font-medium mb-1">
            Excel file (.xlsx / .xls)
          </label>
          <input
            type="file"
            accept=".xlsx,.xls,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={handleFileChange}
            disabled={parsing || uploading}
            className="block w-full text-[11px] file:mr-3 file:py-1 file:px-2 file:text-[11px] file:border file:border-n-200 file:rounded file:bg-white hover:file:bg-n-50"
          />
          {parsing && <p className="text-[10px] text-n-500 mt-1">Parsing…</p>}
        </div>

        {/* Warnings */}
        {warnings.length > 0 && (
          <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2">
            <div className="flex items-center gap-1.5 mb-1">
              <AlertTriangle className="h-3 w-3 text-amber-600" />
              <span className="text-[11px] font-medium text-amber-800">
                {warnings.length} warning{warnings.length === 1 ? '' : 's'}
              </span>
            </div>
            <ul className="text-[10px] text-amber-700 space-y-0.5 list-disc ml-4">
              {warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          </div>
        )}

        {/* Parsed preview */}
        {parsedRows.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <FileSpreadsheet className="h-3 w-3 text-p-600" />
              <span className="text-[11px] font-medium text-n-700">
                {parsedRows.length} row{parsedRows.length === 1 ? '' : 's'} parsed
              </span>
            </div>
            <div className="border border-n-200 rounded max-h-48 overflow-y-auto">
              <table className="w-full text-[11px]">
                <thead className="bg-n-50 sticky top-0">
                  <tr>
                    <th className="px-2 py-1 text-left text-[10px] font-semibold text-n-500 uppercase w-10">#</th>
                    <th className="px-2 py-1 text-left text-[10px] font-semibold text-n-500 uppercase">Description</th>
                    <th className="px-2 py-1 text-right text-[10px] font-semibold text-n-500 uppercase">Unit Price</th>
                    <th className="px-2 py-1 text-right text-[10px] font-semibold text-n-500 uppercase">GST %</th>
                  </tr>
                </thead>
                <tbody>
                  {parsedRows.map((r, i) => (
                    <tr key={i} className="border-t border-n-100">
                      <td className="px-2 py-1 text-n-600 tabular-nums">{r.sNo}</td>
                      <td className="px-2 py-1">{r.itemDescription}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{formatINR(r.unitPrice)}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{r.gstRate ?? 18}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Payment + delivery */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] uppercase tracking-wide text-n-500 font-medium mb-1">
              Payment terms
            </label>
            <input
              type="text"
              value={paymentTerms}
              onChange={(e) => setPaymentTerms(e.target.value)}
              className="w-full h-8 text-[11px] border border-n-200 rounded px-2"
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wide text-n-500 font-medium mb-1">
              Delivery period (days)
            </label>
            <input
              type="number"
              min="1"
              value={deliveryPeriodDays}
              onChange={(e) => setDeliveryPeriodDays(e.target.value)}
              className="w-full h-8 text-[11px] border border-n-200 rounded px-2"
            />
          </div>
        </div>

        {error && <p className="text-[11px] text-red-600">{error}</p>}

        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={uploading}
            className="h-8 text-[11px]"
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={uploading || parsing || parsedRows.length === 0}
            className="h-8 text-[11px] gap-1"
          >
            <Upload className="h-3 w-3" />
            {uploading ? 'Uploading…' : 'Upload & submit'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
