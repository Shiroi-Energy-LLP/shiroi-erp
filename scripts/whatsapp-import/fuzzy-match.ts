// scripts/whatsapp-import/fuzzy-match.ts
import type { ProjectRecord, LeadRecord } from './db.js';

function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b(mr|mrs|ms|dr|sir|smt|shri)\b/g, '')
    .replace(/\b(pvt|ltd|llp|private|limited|constructions?|builders?|developers?|enterprises?|homes?|projects?|apartments?|flats?|nagar|colony|street|site|solar)\b/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function bigramSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  const getBigrams = (s: string): Set<string> => {
    const bigrams = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) bigrams.add(s.slice(i, i + 2));
    return bigrams;
  };

  const aB = getBigrams(a);
  const bB = getBigrams(b);
  let intersection = 0;
  for (const bg of aB) if (bB.has(bg)) intersection++;
  return (2 * intersection) / (aB.size + bB.size);
}

export interface FuzzyMatch {
  id: string;
  type: 'project' | 'lead';
  matched_name: string;
  score: number;
}

export function fuzzyMatchProjects(
  mention: string,
  projects: ProjectRecord[],
  leads: LeadRecord[]
): FuzzyMatch | null {
  if (!mention || mention.trim().length < 3) return null;

  const query = normalise(mention);
  if (!query) return null;

  let best: FuzzyMatch | null = null;
  let bestScore = 0;

  for (const p of projects) {
    const score = bigramSimilarity(query, normalise(p.customer_name));
    const numMatch = p.project_number.toLowerCase().includes(query) ? 0.95 : 0;
    const final = Math.max(score, numMatch);
    if (final > bestScore) {
      bestScore = final;
      best = { id: p.id, type: 'project', matched_name: p.customer_name, score: final };
    }
  }

  for (const l of leads) {
    const score = bigramSimilarity(query, normalise(l.name));
    if (score > bestScore) {
      bestScore = score;
      best = { id: l.id, type: 'lead', matched_name: l.name, score };
    }
  }

  if (!best || bestScore < 0.35) return null;
  return best;
}
