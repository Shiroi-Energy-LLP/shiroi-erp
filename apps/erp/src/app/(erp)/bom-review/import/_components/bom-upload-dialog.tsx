'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Button,
} from '@repo/ui';
import { Upload, FileSpreadsheet, AlertTriangle } from 'lucide-react';
import { parseBomWorkbook, type ParsedBomSheet } from '@/lib/bom-sheet-parser';
import { seedBomImports } from '@/lib/bom-import-actions';

export function BomUploadDialog() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [file, setFile] = React.useState<File | null>(null);
  const [sheets, setSheets] = React.useState<ParsedBomSheet[]>([]);
  const [warnings, setWarnings] = React.useState<string[]>([]);
  const [parsing, setParsing] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  function reset() {
    setFile(null);
    setSheets([]);
    setWarnings([]);
    setError(null);
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    reset();
    setFile(f);
    if (!f) return;
    setParsing(true);
    try {
      const buf = await f.arrayBuffer();
      const parsed = await parseBomWorkbook(buf);
      setSheets(parsed.sheets);
      setWarnings(parsed.warnings);
      if (parsed.sheets.length === 0) setError('No parseable BOM sheets found in this workbook.');
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : 'Failed to parse file');
    }
    setParsing(false);
  }

  async function handleSubmit() {
    if (!file || sheets.length === 0) return;
    setUploading(true);
    setError(null);
    const res = await seedBomImports({
      fileName: file.name,
      sheets: sheets.map((s) => ({
        sheetName: s.sheetName,
        projectName: s.projectName,
        normalizedName: s.normalizedName,
        header: s.header,
        summary: s.summary,
        lines: s.lines,
      })),
    });
    setUploading(false);
    if (!res.success) {
      setError(res.error);
      return;
    }
    setOpen(false);
    reset();
    router.refresh();
  }

  const totalLines = sheets.reduce((n, s) => n + s.lines.length, 0);

  return (
    <>
      <Button size="sm" className="h-8 text-xs gap-1.5" onClick={() => setOpen(true)}>
        <Upload className="h-3.5 w-3.5" />
        Import from Excel
      </Button>

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold">Import BOM from Excel</DialogTitle>
            <DialogDescription className="text-xs text-n-500">
              Upload the master workbook (one sheet per project) or a single project sheet. Each
              sheet is parsed and auto-matched to a project — you confirm or fix each match below.
            </DialogDescription>
          </DialogHeader>

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

          {warnings.length > 0 && (
            <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2">
              <div className="flex items-center gap-1.5 mb-1">
                <AlertTriangle className="h-3 w-3 text-amber-600" />
                <span className="text-[11px] font-medium text-amber-800">
                  {warnings.length} warning{warnings.length === 1 ? '' : 's'}
                </span>
              </div>
              <ul className="text-[10px] text-amber-700 space-y-0.5 list-disc ml-4 max-h-24 overflow-y-auto">
                {warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          )}

          {sheets.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 mb-1">
                <FileSpreadsheet className="h-3 w-3 text-p-600" />
                <span className="text-[11px] font-medium text-n-700">
                  {sheets.length} sheet{sheets.length === 1 ? '' : 's'} · {totalLines} line items
                </span>
              </div>
              <div className="border border-n-200 rounded max-h-56 overflow-y-auto">
                <table className="w-full text-[11px]">
                  <thead className="bg-n-50 sticky top-0">
                    <tr>
                      <th className="px-2 py-1 text-left text-[10px] font-semibold text-n-500 uppercase">Sheet</th>
                      <th className="px-2 py-1 text-left text-[10px] font-semibold text-n-500 uppercase">Project name</th>
                      <th className="px-2 py-1 text-right text-[10px] font-semibold text-n-500 uppercase">Lines</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sheets.map((s, i) => (
                      <tr key={i} className="border-t border-n-100">
                        <td className="px-2 py-1 text-n-600">{s.sheetName}</td>
                        <td className="px-2 py-1">{s.projectName}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{s.lines.length}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {error && <p className="text-[11px] text-red-600">{error}</p>}

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => { setOpen(false); reset(); }} disabled={uploading} className="h-8 text-[11px]">
              Cancel
            </Button>
            <Button size="sm" onClick={handleSubmit} disabled={uploading || parsing || sheets.length === 0} className="h-8 text-[11px] gap-1">
              <Upload className="h-3 w-3" />
              {uploading ? 'Staging…' : `Stage ${sheets.length} sheet${sheets.length === 1 ? '' : 's'} for review`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
