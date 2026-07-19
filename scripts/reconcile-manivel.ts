/**
 * Phase 1 — Manivel sheet <-> ERP reconciliation AUDIT (read-only) + shared matcher.
 *
 * Reads the source-of-truth workbook (Projects + Budgets) and matches its projects
 * against the ERP `projects` table (dev) by normalized name, with size as a
 * confidence signal. Exposes the matcher (`loadSheet`, `loadErp`, `computeMatches`)
 * for reuse by the seed script so the seeded buckets match this audit exactly.
 *
 * Run directly to (re)generate the report + CSVs:  pnpm exec tsx scripts/reconcile-manivel.ts
 * Makes NO database writes.
 */
import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';
import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';

dotenv.config({ path: 'C:/Users/vivek/Projects/shiroi-erp/.env.local' });

const WB = path.resolve(__dirname, 'data/manivel-project-dashboard-2026-06-15.xlsx');
const OUT_CSV = path.resolve(__dirname, 'data/reconciliation-2026-06-15.csv');
const OUT_ERPONLY = path.resolve(__dirname, 'data/reconciliation-erp-only-2026-06-15.csv');
const OUT_MD = path.resolve(__dirname, '../docs/reviews/2026-06-15-manivel-erp-reconciliation.md');

export const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

// ---------- helpers ----------
const HON = /\b(mr|mrs|ms|dr|prof|messrs|sri|smt|thiru|m\/s)\b/g;
export function norm(s: unknown): string {
  return (s ?? '').toString().toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[._,/\\()\[\]'"`-]/g, ' ')
    .replace(HON, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function tokens(s: string): string[] { return norm(s).split(' ').filter(Boolean); }
function jaccard(a: string, b: string): number {
  const A = new Set(tokens(a)), B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}
function lev(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}
function levRatio(a: string, b: string): number {
  const x = norm(a), y = norm(b); const m = Math.max(x.length, y.length);
  return m ? 1 - lev(x, y) / m : 1;
}
export function score(a: string, b: string): number {
  return Math.max(jaccard(a, b), 0.85 * levRatio(a, b));
}
export function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/[,₹\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}
export function yr(v: unknown): number | null {
  const n = num(v); return n && n > 1990 && n < 2100 ? Math.trunc(n) : null;
}
function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function sizeMatch(a: number | null, b: number | null): boolean {
  if (a == null || b == null) return false;
  const hi = Math.max(a, b); if (hi === 0) return true;
  return Math.abs(a - b) / hi <= 0.1;
}

// ---------- sheet ----------
export interface SheetProj {
  no: number | null; name: string; nameNorm: string; size: number | null; status: string | null;
  location: string | null; year: number | null;
  projectCost: number | null; actualCost: number | null; profitRs: number | null;
}
export function loadSheet(): SheetProj[] {
  const wb = XLSX.readFile(WB, { cellDates: true });
  const projects = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['Projects'], { defval: null });
  const budgets = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['Budgets'], { defval: null });
  const byName = new Map<string, SheetProj>();
  for (const r of projects) {
    const name = (r['Project Name'] ?? '').toString().trim();
    if (!name) continue;
    byName.set(norm(name), {
      no: num(r['S.No']), name, nameNorm: norm(name), size: num(r['Size']),
      status: (r['Status'] ?? null) as string | null,
      location: (r['Location'] ?? null) as string | null,
      year: yr(r['Years']),
      projectCost: null, actualCost: null, profitRs: null,
    });
  }
  for (const r of budgets) {
    const name = (r['Project Name'] ?? '').toString().trim();
    if (!name) continue;
    const key = norm(name);
    const ex = byName.get(key) ?? {
      no: num(r['No']), name, nameNorm: key, size: num(r['Size']), status: (r['Status'] ?? null) as string | null,
      location: null, year: null, projectCost: null, actualCost: null, profitRs: null,
    };
    ex.projectCost = num(r['Project Cost']);
    ex.actualCost = num(r['Actual Cost']);
    ex.profitRs = num(r['Profit In rs']);
    ex.year = ex.year ?? yr(r['Year']);
    byName.set(key, ex);
  }
  return [...byName.values()];
}

// ---------- erp ----------
export interface ErpProj {
  id: string; number: string | null; customer: string | null; projectName: string | null;
  size: number | null; city: string | null; status: string | null;
  orderYear: number | null; contracted: number | null; createdYear: number | null;
}
export async function loadErp(): Promise<ErpProj[]> {
  const { data, error } = await admin.from('projects')
    .select('id, project_number, customer_name, project_name, system_size_kwp, site_city, status, order_date, contracted_value, created_at')
    .is('deleted_at', null);
  if (error) throw new Error(`ERP query failed: ${error.message}`);
  return (data ?? []).map((p: Record<string, unknown>) => ({
    id: p.id as string,
    number: (p.project_number ?? null) as string | null,
    customer: (p.customer_name ?? null) as string | null,
    projectName: (p.project_name ?? null) as string | null,
    size: num(p.system_size_kwp),
    city: (p.site_city ?? null) as string | null,
    status: (p.status ?? null) as string | null,
    orderYear: p.order_date ? new Date(p.order_date as string).getFullYear() : null,
    contracted: num(p.contracted_value),
    createdYear: p.created_at ? new Date(p.created_at as string).getFullYear() : null,
  }));
}
export function erpLabel(e: ErpProj): string {
  return e.projectName || e.customer || e.number || e.id;
}

// ---------- matcher ----------
export type Bucket = 'auto' | 'likely' | 'ambiguous' | 'sheet-only';
export interface ReconRow {
  sheet: SheetProj; erp: ErpProj | null; bucket: Bucket; score: number; nearTie: boolean; sizeMatch: boolean;
}
export function computeMatches(sheet: SheetProj[], erp: ErpProj[]): { rows: ReconRow[]; erpOnly: ErpProj[] } {
  const usedErp = new Set<string>();
  const rows: ReconRow[] = sheet.map((s) => {
    const scored = erp.map((e) => ({ e, sc: score(s.name, erpLabel(e)) })).sort((a, b) => b.sc - a.sc);
    const best = scored[0], second = scored[1];
    const nearTie = best && second ? best.sc - second.sc < 0.06 : false;
    const sm = best ? sizeMatch(s.size, best.e.size) : false;
    let bucket: Bucket;
    if (!best || best.sc < 0.34) bucket = 'sheet-only';
    else if (best.sc >= 0.9) bucket = 'auto';
    else if (best.sc >= 0.6 && sm && !nearTie) bucket = 'auto';
    else if (best.sc >= 0.5 && !nearTie) bucket = 'likely';
    else bucket = 'ambiguous';
    if (best && bucket !== 'sheet-only') usedErp.add(best.e.id);
    return { sheet: s, erp: bucket === 'sheet-only' ? null : best?.e ?? null, bucket, score: best ? +best.sc.toFixed(3) : 0, nearTie, sizeMatch: sm };
  });
  const erpOnly = erp.filter((e) => !usedErp.has(e.id));
  return { rows, erpOnly };
}

// ---------- report (only when run directly) ----------
async function main() {
  const sheet = loadSheet();
  const erp = await loadErp();
  console.log(`Sheet projects: ${sheet.length}   ERP active projects: ${erp.length}`);
  const { rows, erpOnly } = computeMatches(sheet, erp);

  const flat = rows.map((r) => ({
    sheetNo: r.sheet.no, sheetName: r.sheet.name, sheetSize: r.sheet.size, sheetStatus: r.sheet.status,
    sheetYear: r.sheet.year, sheetProjectCost: r.sheet.projectCost, sheetActualCost: r.sheet.actualCost,
    bucket: r.bucket, matchScore: r.score, nearTie: r.nearTie, sizeMatch: r.sizeMatch,
    erpNumber: r.erp?.number ?? '', erpName: r.erp ? erpLabel(r.erp) : '', erpSize: r.erp?.size ?? '',
    erpStatus: r.erp?.status ?? '', erpOrderYear: r.erp?.orderYear ?? '', erpContracted: r.erp?.contracted ?? '',
    valueDiff: r.erp && r.erp.contracted != null && r.sheet.projectCost != null ? +(r.sheet.projectCost - r.erp.contracted).toFixed(2) : '',
    yearDiff: r.erp && r.erp.orderYear != null && r.sheet.year != null && r.erp.orderYear !== r.sheet.year ? `${r.sheet.year}->${r.erp.orderYear}` : '',
  }));

  const head = ['sheetNo', 'sheetName', 'sheetSize', 'sheetStatus', 'sheetYear', 'sheetProjectCost', 'sheetActualCost',
    'bucket', 'matchScore', 'nearTie', 'sizeMatch', 'erpNumber', 'erpName', 'erpSize', 'erpStatus', 'erpOrderYear', 'erpContracted', 'valueDiff', 'yearDiff'];
  fs.writeFileSync(OUT_CSV, [head.join(','), ...flat.map((r) => head.map((h) => csvCell((r as Record<string, unknown>)[h])).join(','))].join('\n'));

  const eh = ['erpNumber', 'erpName', 'customer', 'erpSize', 'erpStatus', 'orderYear', 'createdYear', 'contracted'];
  fs.writeFileSync(OUT_ERPONLY, [eh.join(','), ...erpOnly.map((e) => [e.number, erpLabel(e), e.customer, e.size, e.status, e.orderYear, e.createdYear, e.contracted].map(csvCell).join(','))].join('\n'));

  const by = (b: Bucket) => rows.filter((r) => r.bucket === b).length;
  const counts = { auto: by('auto'), likely: by('likely'), ambiguous: by('ambiguous'), sheetOnly: by('sheet-only') };
  const matched = counts.auto + counts.likely + counts.ambiguous;
  const sheetWithValue = sheet.filter((s) => (s.projectCost ?? 0) > 0).length;
  const valueFlags = flat.filter((r) => typeof r.valueDiff === 'number' && Math.abs(r.valueDiff as number) > 1).length;
  const yearFlags = flat.filter((r) => r.yearDiff !== '').length;

  const md = `# Manivel Sheet ↔ ERP Reconciliation (2026-06-15)

Read-only audit. Source: \`scripts/data/manivel-project-dashboard-2026-06-15.xlsx\` vs ERP dev \`projects\`.
Generated by \`scripts/reconcile-manivel.ts\`. **No data was modified.**

## Match summary
| Bucket | Count | Meaning |
|---|---|---|
| auto | ${counts.auto} | high score (+ size) — safe to confirm |
| likely | ${counts.likely} | probable — quick human glance |
| ambiguous | ${counts.ambiguous} | low score or near-tie siblings — needs Manivel |
| sheet-only | ${counts.sheetOnly} | no ERP match — create/locate in ERP |
| **matched (any)** | **${matched}** / ${sheet.length} | |
| ERP-only (pre-2022 candidates) | ${erpOnly.length} | active ERP projects not in the sheet → "≤2021" bucket |

## Financial / year flags (matched rows)
- Sheet projects with a Project Cost: **${sheetWithValue}** of ${sheet.length}
- Matched rows where sheet Project Cost vs ERP contracted_value differ by >₹1: **${valueFlags}**
- Matched rows where sheet Year ≠ ERP order_date year: **${yearFlags}**

## Sample — ambiguous (first 15, for the reconciliation UI queue)
| Sheet | Size | Best ERP guess | Score | NearTie |
|---|---|---|---|---|
${flat.filter((r) => r.bucket === 'ambiguous').slice(0, 15).map((r) => `| ${r.sheetName} | ${r.sheetSize ?? ''} | ${r.erpName} | ${r.matchScore} | ${r.nearTie ? 'yes' : ''} |`).join('\n')}

## Sample — sheet-only (first 15)
| Sheet | Size | Year | Project Cost |
|---|---|---|---|
${flat.filter((r) => r.bucket === 'sheet-only').slice(0, 15).map((r) => `| ${r.sheetName} | ${r.sheetSize ?? ''} | ${r.sheetYear ?? ''} | ${r.sheetProjectCost ?? ''} |`).join('\n')}

## Files
- \`scripts/data/reconciliation-2026-06-15.csv\` — every sheet project + best ERP match + diffs
- \`scripts/data/reconciliation-erp-only-2026-06-15.csv\` — ERP projects with no sheet match (pre-2022 candidates)

> Matching is a *proposal*. Confirmation/override happens in the Manivel reconciliation UI (Phase 2).
`;
  fs.mkdirSync(path.dirname(OUT_MD), { recursive: true });
  fs.writeFileSync(OUT_MD, md);
  console.log('Buckets:', counts, 'ERP-only:', erpOnly.length, '| value flags:', valueFlags, 'year flags:', yearFlags);
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
