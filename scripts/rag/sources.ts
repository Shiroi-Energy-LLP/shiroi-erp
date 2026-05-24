/**
 * sources.ts — Source-type to glob mapping for Shiroi RAG ingest.
 *
 * Each entry tells the ingest pipeline which files belong to which source_type.
 * The glob patterns are relative to the repo root.
 *
 * Phase 1 (Wave 1): docs only.
 * Phase 2 (Wave 3): structured DB rows (proposals, service_tickets, lead_activities).
 *   — Those will have separate ingest scripts, not listed here.
 */

export interface RagSource {
  /** Maps to rag_chunks.source_type CHECK constraint */
  type:
    | 'module_doc'
    | 'master_reference'
    | 'claude_md'
    | 'spec'
    | 'plan'
    | 'review'
    | 'changelog';
  /** Glob pattern relative to repo root */
  glob: string;
  /** Human-readable label for logging */
  label: string;
}

export const SOURCES: RagSource[] = [
  {
    type: 'module_doc',
    glob: 'docs/modules/*.md',
    label: 'Module docs',
  },
  {
    type: 'master_reference',
    glob: 'docs/SHIROI_MASTER_REFERENCE.md',
    label: 'Master reference',
  },
  {
    type: 'claude_md',
    glob: 'CLAUDE.md',
    label: 'CLAUDE.md (coding standards)',
  },
  {
    type: 'spec',
    glob: 'docs/superpowers/specs/*.md',
    label: 'Feature specs',
  },
  {
    type: 'plan',
    glob: 'docs/superpowers/plans/*.md',
    label: 'Implementation plans',
  },
  {
    type: 'review',
    glob: 'docs/reviews/*.md',
    label: 'Design reviews',
  },
  {
    type: 'changelog',
    glob: 'docs/CHANGELOG.md',
    label: 'Changelog',
  },
];
