// scripts/zoho-import/parse-xls.ts
import * as XLSX from 'xlsx';
import * as path from 'path';

export const ZOHO_DIR = path.resolve(__dirname, '../../docs/Zoho data');

export function loadSheet<T extends Record<string, unknown>>(fileName: string): T[] {
  const fullPath = path.join(ZOHO_DIR, fileName);
  const wb = XLSX.readFile(fullPath, { cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json<T>(sheet, { defval: null });
}

export function toNumber(v: unknown, fallback = 0): number {
  if (v === null || v === undefined || v === '') return fallback;
  if (v instanceof Date) return fallback;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, '').replace(/^INR\s*/i, ''));
  return Number.isFinite(n) ? n : fallback;
}

export function toDateISO(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) {
    if (!Number.isFinite(v.getTime())) return null;
    return v.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  if (!s) return null;
  // Zoho exports sometimes use "DD MMM YYYY" or "YYYY-MM-DD" or ISO with time
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : null;
}

export function toStr(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}
