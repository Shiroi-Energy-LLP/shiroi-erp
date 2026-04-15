import type { ItemCategory } from '@/lib/boi-constants';

export interface ItemSuggestion {
  description: string;
  category: ItemCategory;
  unit: string;
  base_price: number;
  source: 'price_book' | 'boq';
}

/**
 * Ranks suggestions against a query.
 *
 * Exact prefix > substring > Jaccard token overlap.
 * Price Book rows get a +5 bonus so curated entries win ties.
 */
export function filterAndRank(
  query: string,
  suggestions: ItemSuggestion[],
  limit = 8,
): ItemSuggestion[] {
  const q = query.trim().toLowerCase();
  if (!q) return suggestions.slice(0, limit);

  const scored = suggestions.map((s) => {
    const desc = s.description.toLowerCase();
    let score = 0;
    if (desc.startsWith(q)) {
      score = 100;
    } else if (desc.includes(q)) {
      score = 50;
    } else {
      const qTokens = new Set(q.split(/\s+/).filter(Boolean));
      const dTokens = new Set(desc.split(/\s+/).filter(Boolean));
      const intersection = [...qTokens].filter((t) => dTokens.has(t)).length;
      const union = new Set([...qTokens, ...dTokens]).size;
      const jaccard = union > 0 ? intersection / union : 0;
      score = jaccard * 30;
    }
    // Only apply price_book bonus if there's a real match (score > 0)
    if (score > 0 && s.source === 'price_book') score += 5;
    return { s, score };
  });

  return scored
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.s);
}
