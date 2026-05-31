/**
 * Sanitize user-supplied search input for safe inclusion in a PostgREST .or()
 * filter expression. Strips characters that PostgREST treats as filter syntax
 * (`,` ends a clause; `(`/`)` change precedence; `{` / `}` / `*` likewise).
 * Returns the trimmed safe substring (still wrap in % for ilike at the call site).
 *
 * Security review 2026-05-30 #5 — PostgREST .or() injection class.
 */
export function sanitizeForOr(input: string): string {
  return input.replace(/[,(){}*]/g, '').trim();
}

/** Sanitize + wrap as %query% for ilike. */
export function sanitizeForIlike(input: string): string {
  return `%${sanitizeForOr(input)}%`;
}
