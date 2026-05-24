/**
 * sales-territories-constants.ts
 *
 * Shared constants for the sales territories domain.
 * Safe to import in both 'use client' and server contexts — no server-only imports here.
 */

export type TerritorySegment = 'residential' | 'commercial' | 'industrial' | 'all';

export const TERRITORY_SEGMENTS: { value: TerritorySegment | ''; label: string }[] = [
  { value: '', label: 'Any segment' },
  { value: 'residential', label: 'Residential' },
  { value: 'commercial', label: 'Commercial' },
  { value: 'industrial', label: 'Industrial' },
  { value: 'all', label: 'All segments' },
];

export const TERRITORY_SEGMENT_LABELS: Record<TerritorySegment | 'all', string> = {
  residential: 'Residential',
  commercial: 'Commercial',
  industrial: 'Industrial',
  all: 'All',
};

/**
 * Normalise a raw cities string (user input or DB value) into a trimmed,
 * lowercase, deduped array.
 */
export function parseCities(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(',')
        .map((c) => c.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}

/**
 * Convert a cities array back to a comma-separated display string.
 */
export function citiesToString(cities: string[]): string {
  return cities.join(', ');
}
