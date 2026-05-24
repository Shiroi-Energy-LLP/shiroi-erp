# Shiroi RAG — Design Spec

> Spec date: 2026-05-25
> Status: design draft (companion to `docs/superpowers/plans/2026-05-25-ai-roadmap-plan.md` H3 Wave 1)
> Goal: codify the chunking strategy, schema, embedding choice, retrieval API, and re-indexing cadence for a Shiroi-specific RAG layer.

---

## Problem statement

Vivek (founder) is the company's de-facto knowledge base. Employees DM him for "what brand of MMS did we use at X site?", "what's our standard payment terms for industrial?", "how do we handle TNEB delay >30 days?". This doesn't scale as Shiroi grows past 50 employees.

Equally, every AI feature in the H3 roadmap that touches Shiroi-specific knowledge (D1 Q&A, F1 briefing context, F8+ design review, C3 pricing comparable lookup) gets meaningfully better when the LLM has the right Shiroi context injected — and meaningfully worse without it (LLMs without context hallucinate plausible-sounding wrong answers).

A custom RAG over Shiroi's own data:
- Removes the "ask Vivek" bottleneck for routine knowledge
- Makes Haiku 2–3× more accurate on Shiroi-specific tasks (RAG quality > raw model quality for narrow domains)
- Captures institutional knowledge that survives employee turnover
- Becomes a moat as the company scales

## Goals

- **One vector store: Supabase `pgvector`.** No separate vector DB (Pinecone, Weaviate, etc.). Single source of truth, single backup, single ops surface.
- **One embedding provider: Jina AI v3** (1024-dim, multilingual including Tamil). Free tier covers Shiroi's volume entirely. Local fallback path documented for later.
- **Clean `retrieve(query, opts)` API** that any feature can call without knowing about chunking, embedding, or storage internals.
- **Phased ingest** — start with docs only (Phase 1), add structured data as features need it (Phase 2/3).
- **Re-indexing cron** + on-demand re-index for changed sources.

## Non-goals

- Build a full knowledge graph (cypher / Neo4j / RDF). Vector RAG is enough for 90% of use cases.
- Replace Supabase as the data store. RAG is an index over data, not a replacement.
- Build a RAG admin UI in Phase 1. SQL Editor + a `/admin/rag-debug` page (Phase 3) is enough.
- Auto-tune embedding model or rerank model (Phase 3 if needed).

## Architecture overview

```
┌─────────────────────┐      ┌──────────────────┐      ┌────────────────────┐
│ Sources             │      │ Ingest pipeline  │      │ pgvector index     │
│ - docs/modules/*.md │ ───▶ │ scripts/rag/     │ ───▶ │ rag_chunks table   │
│ - docs/spec/* etc.  │      │ ingest-*.ts      │      │ + HNSW index       │
│ - proposals (P2)    │      │ + chunking       │      │                    │
│ - service_tickets   │      │ + Jina embed     │      └─────────┬──────────┘
│   (P2)              │      │ + upsert         │                │
└─────────────────────┘      └──────────────────┘                │
                                                                 │
┌─────────────────────────────────────────┐                      │
│ Consumers                               │                      │
│ - D1 knowledge Q&A (Wave 1)             │ ◀── retrieve(q,opts) ┘
│ - F1 briefing context (Wave 1)          │
│ - H1 catalog match (Wave 1 enhancement) │
│ - C3 pricing comparable (Wave 3)        │
│ - F8+ design review (Wave 4)            │
│ - D2 ticket triage (Wave 4)             │
└─────────────────────────────────────────┘
```

## Schema (migration 138)

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE rag_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Source identification (composite "where did this come from")
  source_type TEXT NOT NULL CHECK (source_type IN (
    'module_doc',         -- docs/modules/*.md
    'master_reference',   -- docs/SHIROI_MASTER_REFERENCE.md
    'claude_md',          -- CLAUDE.md
    'spec',               -- docs/superpowers/specs/*
    'plan',               -- docs/superpowers/plans/*
    'review',             -- docs/reviews/*
    'changelog',          -- docs/CHANGELOG.md (sliced by entry)
    'proposal',           -- proposals.id (Phase 2)
    'service_ticket',     -- om_service_tickets.id (Phase 2)
    'lead_activity',      -- lead_activities.id (Phase 2)
    'price_book_item',    -- price_book.id (Phase 2)
    'project_decision'    -- handcrafted decision notes (Phase 3)
  )),
  source_path TEXT NOT NULL,  -- file path for docs; "{table}/{id}" for structured rows
  source_id TEXT,             -- the source row's UUID, NULL for docs
  chunk_index INT NOT NULL,   -- 0-based within the source

  -- The actual content
  content TEXT NOT NULL,
  -- Optional structured fields the chunker extracted
  heading_path TEXT[],        -- ['H1', 'H2', 'H3'] breadcrumb for docs
  metadata JSONB NOT NULL DEFAULT '{}',

  -- Embedding
  embedding VECTOR(1024) NOT NULL,
  embedding_model TEXT NOT NULL DEFAULT 'jina-embeddings-v3',
  embedding_dim INT NOT NULL DEFAULT 1024,

  -- Lifecycle
  content_hash TEXT NOT NULL,  -- sha256(content) — used by ingest to skip unchanged
  last_indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (source_path, chunk_index)
);

-- HNSW index for cosine similarity (faster than ivfflat at scale)
CREATE INDEX rag_chunks_embedding_hnsw
  ON rag_chunks USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX idx_rag_source_type ON rag_chunks (source_type);
CREATE INDEX idx_rag_source_path ON rag_chunks (source_path);
CREATE INDEX idx_rag_last_indexed ON rag_chunks (last_indexed_at);

ALTER TABLE rag_chunks ENABLE ROW LEVEL SECURITY;

-- Read: authenticated users get sources their role can see
-- (sensitive data stays at the row level — RAG is just an index)
CREATE POLICY rag_chunks_read ON rag_chunks FOR SELECT TO authenticated
  USING (
    source_type IN (
      'module_doc','master_reference','claude_md','spec','plan',
      'review','changelog','price_book_item','project_decision'
    )
    OR (source_type = 'proposal' AND EXISTS (
      SELECT 1 FROM proposals p WHERE p.id::text = rag_chunks.source_id
      -- proposal RLS handles the access check via the join
    ))
    OR (source_type = 'service_ticket' AND EXISTS (
      SELECT 1 FROM om_service_tickets t WHERE t.id::text = rag_chunks.source_id
    ))
    OR (source_type = 'lead_activity' AND EXISTS (
      SELECT 1 FROM lead_activities la WHERE la.id::text = rag_chunks.source_id
    ))
  );

-- Write: service-role only (ingest pipeline)
CREATE POLICY rag_chunks_service_write ON rag_chunks FOR ALL TO service_role
  USING (TRUE) WITH CHECK (TRUE);
```

**Why HNSW over ivfflat?** HNSW (Hierarchical Navigable Small World) gives ~10× faster query at the dataset sizes we'll hit (~50k chunks Phase 1, ~200k Phase 2). The build cost is higher but we ingest once per file and re-query often.

## Chunking strategy

### Markdown docs (Phase 1: ~50k chunks worth of text)

Algorithm:
1. Parse the markdown via a heading-aware splitter
2. Split at `##` (H2) boundaries first
3. If an H2 section is >1000 tokens, recursively split at `###` (H3)
4. If a leaf section is still >1000 tokens, hard-split with 800-token chunks + 100-token overlap
5. Each chunk records its `heading_path` (e.g., `['Projects', 'Tabs (13 — in order)', '6. Execution']`) for retrieval context

Why this approach:
- Heading-aware preserves semantic boundaries (you don't get a chunk that ends mid-thought)
- 800-token chunks fit comfortably in any LLM context (Haiku's 200k is overkill — small chunks let us retrieve 5-8 and still fit)
- Overlap means a chunk boundary doesn't cut an idea in half
- `heading_path` lets us show "from Projects module / Execution stage" with each retrieved chunk

Library: `js-tiktoken` for token counting + custom heading splitter.

### Structured rows (Phase 2)

Each row becomes 1 chunk. Content = a flattened text representation:

**proposal example** (`source_type='proposal'`, `source_path='proposals/abc-123'`):
```
Proposal PV/2026-27/0042 (sent 2026-05-15, accepted 2026-05-20)
Customer: VAF Industries (commercial)
Location: Coimbatore
System: 150 kWp on-grid flush-mount
Total: ₹52,40,000 (after ₹2,60,000 discount)
BOM line items:
  - 300× Trina 545 W panels (₹14/Wp)
  - 2× Sungrow 60kW string inverter (₹6,80,000 each)
  - DC cable 6mm² 800m
  - Liaison + CEIG
Margin: 18.2%
Notes: Builder-driven; civil scope client.
```

**service_ticket example**:
```
Ticket SVC-2024-0156 (resolved 2025-08-12, took 3h SLA, ₹2,800)
Project: Radiance Splendour (residential, 5 kWp)
Issue: Inverter offline since morning
Diagnosis: PCB capacitor blown — humidity ingress past gasket
Resolution: Replaced board under warranty; resealed enclosure
Tags: humidity, capacitor, growatt
```

### Why per-row chunking for structured data

A single proposal is a coherent unit. Splitting it loses the "this proposal won at this price for this customer" gestalt. Per-row also makes metadata filtering easy: "find proposals from commercial customers >50 kWp in Tamil Nadu" filters on row metadata before similarity search.

## Embedding model — Jina v3

**Choice: `jina-embeddings-v3`** (1024-dim, multilingual including Tamil).

Why:
- **Quality**: matches OpenAI text-embedding-3-small on standard benchmarks (MTEB), better on multilingual
- **Tamil support**: explicit (Cohere multilingual is the only other option that's good at Tamil)
- **Pricing**: free tier 10M tokens/month — Shiroi's expected volume is ~2M/month at peak (well within free tier even at Phase 3 scale)
- **Latency**: ~150ms per batch of 100 chunks (acceptable for cron ingest)
- **Pluggable**: Single env var `JINA_API_KEY`; can swap to Cohere (`embed-multilingual-v3.0`, 1024-dim) or local (`bge-m3`, 1024-dim) with a one-file client swap

**Fallback chain** (in `apps/erp/src/lib/rag/embed.ts`):
```ts
async function embed(text: string): Promise<number[]> {
  try { return await jinaEmbed(text); }
  catch (e) {
    console.warn('Jina failed, falling back to Cohere', { error: e });
    return await cohereEmbed(text);  // requires COHERE_API_KEY
  }
}
```

If both fail, the ingest job marks the chunk as `pending_re_embed` and moves on; a nightly cleanup retries.

## Retrieval API

Single function, single contract:

```ts
// apps/erp/src/lib/rag/retrieve.ts

export interface RagChunk {
  id: string;
  source_type: SourceType;
  source_path: string;
  source_id: string | null;
  content: string;
  heading_path: string[] | null;
  metadata: Record<string, unknown>;
  similarity: number;  // 0–1, cosine
}

export interface RetrieveOptions {
  top_k?: number;                // default 5
  source_types?: SourceType[];   // filter (e.g., docs only)
  min_similarity?: number;       // default 0.5
  metadata_filter?: Record<string, unknown>;  // JSONB match
}

export async function retrieve(query: string, opts: RetrieveOptions = {}): Promise<RagChunk[]> {
  // 1. Embed the query (single Jina call, ~50ms)
  // 2. SELECT ... ORDER BY embedding <=> $1 LIMIT top_k
  // 3. Apply source_types + metadata filters
  // 4. Filter by min_similarity
  // 5. Return chunks
}
```

Consumers never touch the database directly. They call `retrieve()` and feed the result into their Haiku prompt.

Example use in D1:
```ts
const chunks = await retrieve(userQuestion, { top_k: 5 });
const context = chunks
  .map(c => `[${c.source_path}${c.heading_path?.join(' > ') ?? ''}]\n${c.content}`)
  .join('\n---\n');

const answer = await callAi(`Answer based on this Shiroi documentation:
${context}

Question: ${userQuestion}

If the docs don't have the answer, say so. Include source paths in your answer.`,
  { model: 'claude-haiku-4-5-20251001', maxTokens: 800 }
);
```

## Ingest pipeline

### Phase 1 (Wave 1 of H3) — docs only

```
scripts/rag/
  ├── ingest-docs.ts        # Main entry point — walks markdown files
  ├── chunk-markdown.ts     # Heading-aware chunking + token counting
  ├── embed.ts              # Jina client with Cohere fallback
  ├── upsert.ts             # Batch upsert to rag_chunks
  └── sources.ts            # Source-type to glob mapping
```

Flow:
1. `sources.ts` defines what files belong to which `source_type`:
   ```ts
   const SOURCES = [
     { type: 'module_doc',      glob: 'docs/modules/*.md' },
     { type: 'master_reference', glob: 'docs/SHIROI_MASTER_REFERENCE.md' },
     { type: 'claude_md',        glob: 'CLAUDE.md' },
     { type: 'spec',             glob: 'docs/superpowers/specs/*.md' },
     { type: 'plan',             glob: 'docs/superpowers/plans/*.md' },
     { type: 'review',           glob: 'docs/reviews/*.md' },
   ];
   ```
2. For each file: read → chunk → compute `content_hash` per chunk → diff against existing `rag_chunks` rows by `(source_path, chunk_index)` → embed only new/changed chunks → upsert.
3. Delete chunks for files that no longer exist (handles renamed/deleted docs).

**Idempotency**: `content_hash` means re-running the full ingest is cheap — only re-embeds genuine changes. Safe to run on every commit.

**Cron schedule** (added in Phase 1):
- **Manual**: `pnpm rag:ingest-docs` for one-shot re-index
- **Cron**: pg_cron daily at 02:00 IST hits an Edge Function that pulls the latest main, walks docs/, and re-ingests changed files
- **Alternative cron via n8n**: workflow `63-rag-ingest-cron.json` calls the script via SSH (cleaner if we don't want git access from Supabase)

### Phase 2 (Wave 3) — structured data

```
scripts/rag/
  ├── ingest-proposals.ts
  ├── ingest-service-tickets.ts
  ├── ingest-lead-activities.ts
  └── ingest-price-book.ts
```

Pattern:
- Each script `SELECT`s rows updated since last successful ingest (`last_indexed_at` tracking per source_type in a small `rag_ingest_state` table)
- Builds the flattened text representation per row
- Hash + diff + embed (same as docs)
- Run as a 6-hour cron OR triggered on row UPDATE via pg_notify + n8n listener

## Retrieval quality strategy

### Phase 1 — eyeball + hit-rate

Create `apps/erp/src/app/(erp)/admin/rag-debug/page.tsx` (founder-only):
- Text input → run `retrieve()` → show top-5 chunks with similarity score
- "Was this useful? (👍 / 👎)" per chunk → logs to `rag_query_log` table
- Vivek tests with 30 real questions: "what's our standard payment terms?", "which brand of MMS at industrial sites?", "TNEB delay handling?"
- Target: 80%+ thumbs-up on top-3 results

### Phase 3 — rerank (if quality stalls)

If naive cosine retrieval misses too often, add a reranking step:
- Top-20 vector results → Cohere Rerank API → top-5 by rerank score
- Cohere Rerank is ~$0.001/search; even at 1000 queries/day = ₹30/month
- Only do this if Phase 1 shows clear failure modes

## Re-indexing cadence

| Source type | Trigger | Frequency |
|-------------|---------|-----------|
| All docs/* | Git commit to main (via post-receive hook OR daily cron) | Daily 02:00 IST + on-demand |
| proposals | Row UPDATE (Supabase trigger → pg_notify → ingestor) | Real-time (eventual ≤5 min) |
| service_tickets | Same | Real-time |
| lead_activities | Daily batch | Daily 03:00 IST |
| price_book | Weekly batch | Weekly Sunday |

## What this enables — per H3 feature

| Feature | RAG use |
|---------|---------|
| **D1 internal knowledge Q&A** | Retrieves top-5 doc chunks → Haiku synthesizes answer with citations |
| **F1 daily executive briefing** | Retrieves "what's normal at Shiroi" chunks for context (e.g., typical residential margin, average days-to-handover) — makes the AI narrative more grounded |
| **H1 WhatsApp catalog match** | Phase-2 enhancement — semantic match against catalog descriptions (handles synonyms better than keyword match) |
| **C3 pricing comparable lookup** | Phase 2 — retrieves top-N similar past proposals; gives the AI "you've done 8 similar deals at ₹X-Y" |
| **F8+ design review** | Retrieves past projects with similar BOMs to surface "we had issues with this combo at X site" |
| **D2 ticket triage** | Retrieves similar past tickets + their resolutions to suggest likely diagnosis |

## Cost summary

| Item | Monthly cost | Notes |
|------|--------------|-------|
| Jina embedding API | **₹0** (free tier 10M tokens/month covers Shiroi at all phases) | Move to paid only if volume 5×s |
| Cohere fallback API | ₹0 (rarely triggers) | |
| Cohere rerank (Phase 3, optional) | ~₹30 at 1000 queries/day | Skip until needed |
| `pgvector` storage + compute | ~₹0 incremental (already in Supabase plan) | |
| **Total** | **~₹0–30/month** | RAG infra is essentially free at Shiroi's scale |

The cost of RAG isn't the embeddings; it's the **engineering time** (~1 week for Phase 1, ~2 weeks for Phase 2). That investment unlocks 5+ downstream features.

## Build sequence (lives inside the H3 Wave 1 plan)

| Session | What |
|---------|------|
| S2 of H3 Wave 1 | Mig 138 + ingest-docs script + retrieve API + Jina client + admin/rag-debug page |

Phase 2 + 3 land in subsequent H3 waves as features need them.

## Open questions

1. **Should RAG include the CHANGELOG?** Pro: lots of context on "when did X ship". Con: bloats noise on lookup. Recommendation: yes, but chunk per entry, source_type='changelog'.
2. **Should sensitive customer notes (e.g., `leads.notes`, `projects.notes`) be indexed?** Recommend: NO for Phase 1. Founder-only RLS on the row doesn't translate cleanly to "founder-only on the chunk." Revisit when D1 needs it.
3. **Vendor RFQ history (proposals from vendors)?** Defer to Phase 3.
4. **Drive folder backfilled content** (the 1,353 historical proposal Drive folders, design note at `docs/reviews/2026-05-25-drive-folder-backfill-design.md`)? Becomes valuable once Drive backfill runs. Defer to Phase 3.

## Ready-to-execute checklist (Phase 1)

- [ ] `JINA_API_KEY` set in `.env.local` + Vercel + turbo.json globalEnv
- [ ] `COHERE_API_KEY` (optional fallback) — defer if Jina is reliable in week 1
- [ ] `pgvector` extension enabled on dev (verify via `\dx vector` in SQL Editor)
- [ ] Migration 138 applied to dev
- [ ] Initial ingest run: `pnpm rag:ingest-docs` — expect ~50k chunks
- [ ] Founder smoke test: 10 sample queries via `/admin/rag-debug` — eyeball top-5
- [ ] D1 feature wires in `retrieve()` and shows citations in WhatsApp replies
