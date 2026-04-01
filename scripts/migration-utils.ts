/**
 * Migration Utilities — shared helpers for all data migration scripts.
 *
 * Usage: --dry-run flag is MANDATORY before any prod run.
 */

export function normalizePhone(phone: string): string {
  const op = '[normalizePhone]';
  // Strip all non-digit characters
  const digits = phone.replace(/[^0-9]/g, '');

  // Handle +91 or 91 prefix (Indian numbers)
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  if (digits.length === 10) return digits;

  console.warn(`${op} Unusual phone length: ${digits.length} digits for input "${phone}"`);
  return digits;
}

export function deduplicateByPhone<T extends { phone: string }>(
  records: T[]
): { unique: T[]; duplicates: T[] } {
  const seen = new Map<string, T>();
  const duplicates: T[] = [];

  for (const record of records) {
    const normalized = normalizePhone(record.phone);
    if (seen.has(normalized)) {
      duplicates.push(record);
      console.warn(`[deduplicateByPhone] Duplicate phone rejected: ${normalized} (original: "${record.phone}")`);
    } else {
      seen.set(normalized, { ...record, phone: normalized });
    }
  }

  return { unique: Array.from(seen.values()), duplicates };
}

export function isDryRun(): boolean {
  return process.argv.includes('--dry-run');
}

export function logMigrationStart(scriptName: string, recordCount: number): void {
  const mode = isDryRun() ? 'DRY RUN' : 'LIVE';
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  ${scriptName} — ${mode}`);
  console.log(`  Records to process: ${recordCount}`);
  console.log(`  Started at: ${new Date().toISOString()}`);
  console.log(`${'='.repeat(60)}\n`);
}

export function logMigrationEnd(scriptName: string, stats: {
  processed: number;
  inserted: number;
  skipped: number;
  errors: number;
}): void {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  ${scriptName} — COMPLETE`);
  console.log(`  Processed: ${stats.processed}`);
  console.log(`  Inserted:  ${stats.inserted}`);
  console.log(`  Skipped:   ${stats.skipped}`);
  console.log(`  Errors:    ${stats.errors}`);
  console.log(`  Finished at: ${new Date().toISOString()}`);
  console.log(`${'='.repeat(60)}\n`);
}

/**
 * Parse a CSV string into an array of objects using the first row as headers.
 */
export function parseCSV(csvContent: string): Record<string, string>[] {
  const lines = csvContent.trim().split('\n');
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const records: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
    const record: Record<string, string> = {};
    headers.forEach((header, j) => {
      record[header] = values[j] ?? '';
    });
    records.push(record);
  }

  return records;
}

/**
 * Validate that a date string is in YYYY-MM-DD format.
 */
export function isValidDate(dateStr: string): boolean {
  const match = dateStr.match(/^\d{4}-\d{2}-\d{2}$/);
  if (!match) return false;
  const date = new Date(dateStr);
  return !isNaN(date.getTime());
}
