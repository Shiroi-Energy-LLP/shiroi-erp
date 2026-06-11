/**
 * Pure diff builder for BOI/BOQ item edits — feeds the
 * project_boq_item_history.changes JSONB audit column (mig 175).
 * Client-safe: no server imports.
 */

const NUMERIC_FIELDS = ['quantity', 'unit_price', 'gst_rate'] as const;
const TEXT_FIELDS = ['item_description', 'brand', 'model', 'unit'] as const;

type NumericField = (typeof NUMERIC_FIELDS)[number];
type TextField = (typeof TEXT_FIELDS)[number];

export type BoqItemSnapshot = {
  [K in NumericField]: number | null;
} & {
  [K in TextField]: string | null;
};

export type BoqItemPatch = Partial<BoqItemSnapshot>;

export type BoqItemDiff = Record<string, { old: string | number | null; new: string | number | null }>;

function normNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

/**
 * Compare a current row against a patch. Fields absent from the patch are
 * ignored. NUMERIC columns arrive from Postgres as strings — both sides are
 * normalized before comparison so "10" === 10.
 */
export function buildBoqItemDiff(current: BoqItemSnapshot, patch: BoqItemPatch): BoqItemDiff {
  const diff: BoqItemDiff = {};

  for (const f of NUMERIC_FIELDS) {
    if (!(f in patch)) continue;
    const oldV = normNum(current[f]);
    const newV = normNum(patch[f]);
    if (oldV !== newV) diff[f] = { old: oldV, new: newV };
  }
  for (const f of TEXT_FIELDS) {
    if (!(f in patch)) continue;
    const oldV = normText(current[f]);
    const newV = normText(patch[f]);
    if (oldV !== newV) diff[f] = { old: oldV, new: newV };
  }
  return diff;
}
