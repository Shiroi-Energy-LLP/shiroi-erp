-- =============================================================================
-- Migration 138 — Wave 1: RAG foundation + supporting tables for S3–S7
-- =============================================================================
-- Part A: documents.embedding column swap (1536 → 1024 dims, Jina v3)
-- Part B: rag_chunks table + HNSW index + rag_search RPC
-- Part C: Supporting tables for S3-S7 (rag_query_log, task_suggestion_queue,
--         executive_briefing_log, voice_report_log) + projects BOQ narrative cols
-- =============================================================================

-- Part A: Swap documents embedding from OpenAI 1536-dim to Jina 1024-dim
-- No existing embedding data (COUNT(embedding) = 0 confirmed), safe to drop+re-add.
ALTER TABLE documents DROP COLUMN IF EXISTS embedding;
ALTER TABLE documents ADD COLUMN embedding VECTOR(1024);

-- Part B: rag_chunks table
CREATE TABLE rag_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Source identification
  source_type TEXT NOT NULL CHECK (source_type IN (
    'module_doc',
    'master_reference',
    'claude_md',
    'spec',
    'plan',
    'review',
    'changelog',
    'proposal',
    'service_ticket',
    'lead_activity',
    'price_book_item',
    'project_decision'
  )),
  source_path TEXT NOT NULL,
  source_id   TEXT,
  chunk_index INT NOT NULL,

  -- Content
  content      TEXT NOT NULL,
  heading_path TEXT[],
  metadata     JSONB NOT NULL DEFAULT '{}',

  -- Embedding
  embedding        VECTOR(1024) NOT NULL,
  embedding_model  TEXT NOT NULL DEFAULT 'jina-embeddings-v3',
  embedding_dim    INT  NOT NULL DEFAULT 1024,

  -- Lifecycle
  content_hash    TEXT        NOT NULL,
  last_indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (source_path, chunk_index)
);

-- HNSW index for cosine similarity
CREATE INDEX rag_chunks_embedding_hnsw
  ON rag_chunks USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX idx_rag_source_type ON rag_chunks (source_type);
CREATE INDEX idx_rag_source_path ON rag_chunks (source_path);
CREATE INDEX idx_rag_last_indexed ON rag_chunks (last_indexed_at);

ALTER TABLE rag_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY rag_chunks_read ON rag_chunks FOR SELECT TO authenticated
  USING (
    source_type IN (
      'module_doc','master_reference','claude_md','spec','plan',
      'review','changelog','price_book_item','project_decision'
    )
    OR (source_type = 'proposal' AND EXISTS (
      SELECT 1 FROM proposals p WHERE p.id::text = rag_chunks.source_id
    ))
    OR (source_type = 'service_ticket' AND EXISTS (
      SELECT 1 FROM om_service_tickets t WHERE t.id::text = rag_chunks.source_id
    ))
    OR (source_type = 'lead_activity' AND EXISTS (
      SELECT 1 FROM lead_activities la WHERE la.id::text = rag_chunks.source_id
    ))
  );

CREATE POLICY rag_chunks_service_write ON rag_chunks FOR ALL TO service_role
  USING (TRUE) WITH CHECK (TRUE);

-- rag_search RPC: cosine similarity search over rag_chunks
CREATE OR REPLACE FUNCTION rag_search(
  query_embedding VECTOR(1024),
  top_k           INT     DEFAULT 5,
  source_types    TEXT[]  DEFAULT NULL,
  min_sim         FLOAT   DEFAULT 0.5
)
RETURNS TABLE (
  id              UUID,
  source_type     TEXT,
  source_path     TEXT,
  source_id       TEXT,
  content         TEXT,
  heading_path    TEXT[],
  metadata        JSONB,
  similarity      FLOAT
)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT
    rc.id,
    rc.source_type,
    rc.source_path,
    rc.source_id,
    rc.content,
    rc.heading_path,
    rc.metadata,
    1 - (rc.embedding <=> query_embedding) AS similarity
  FROM rag_chunks rc
  WHERE
    (source_types IS NULL OR rc.source_type = ANY(source_types))
    AND 1 - (rc.embedding <=> query_embedding) >= min_sim
  ORDER BY rc.embedding <=> query_embedding
  LIMIT top_k;
$$;

-- Part C: S3 — rag_query_log
CREATE TABLE rag_query_log (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  caller_id            UUID        REFERENCES profiles(id),
  caller_role          TEXT,
  query_text           TEXT        NOT NULL,
  retrieved_chunk_ids  UUID[]      NOT NULL DEFAULT '{}',
  ai_answer            TEXT,
  ai_tokens_in         INT,
  ai_tokens_out        INT,
  ai_model             TEXT        NOT NULL DEFAULT 'claude-haiku-4-5-20251001',
  thumbs_up_count      INT         NOT NULL DEFAULT 0,
  thumbs_down_count    INT         NOT NULL DEFAULT 0,
  latency_ms           INT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_rag_query_log_caller ON rag_query_log (caller_id, created_at DESC);

ALTER TABLE rag_query_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY rag_query_log_own_read ON rag_query_log FOR SELECT TO authenticated
  USING (
    caller_id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'founder')
  );

CREATE POLICY rag_query_log_service_write ON rag_query_log FOR ALL TO service_role
  USING (TRUE) WITH CHECK (TRUE);

-- S4 — task_suggestion_queue
CREATE TABLE task_suggestion_queue (
  id                             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type                    TEXT        NOT NULL CHECK (entity_type IN ('lead','project','service_ticket')),
  entity_id                      UUID        NOT NULL,
  staleness_signal               TEXT        NOT NULL,
  suggested_assignee_employee_id UUID        REFERENCES employees(id),
  ai_task_title                  TEXT,
  ai_task_description            TEXT,
  ai_tokens_used                 INT,
  status                         TEXT        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','generated','task_created','dismissed','expired')),
  created_task_id                UUID        REFERENCES tasks(id),
  created_at                     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at                   TIMESTAMPTZ
);

CREATE INDEX idx_task_sugg_queue_status ON task_suggestion_queue (status, created_at);

ALTER TABLE task_suggestion_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY task_sugg_queue_read ON task_suggestion_queue FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('founder','marketing_manager','project_manager','om_technician')
    )
  );

CREATE POLICY task_sugg_queue_service_write ON task_suggestion_queue FOR ALL TO service_role
  USING (TRUE) WITH CHECK (TRUE);

-- S5 — BOQ variance narrative columns on projects
ALTER TABLE projects ADD COLUMN IF NOT EXISTS boq_variance_narrative       TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS boq_variance_narrative_at    TIMESTAMPTZ;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS boq_variance_narrative_model TEXT;

-- S6 — executive_briefing_log
CREATE TABLE executive_briefing_log (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  briefing_date    DATE        NOT NULL,
  recipient_role   TEXT        NOT NULL,
  kpi_snapshot     JSONB       NOT NULL,
  ai_narrative     TEXT        NOT NULL,
  ai_tokens_in     INT,
  ai_tokens_out    INT,
  ai_model         TEXT        NOT NULL,
  sent_at          TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (briefing_date, recipient_role)
);

CREATE INDEX idx_exec_briefing_date ON executive_briefing_log (briefing_date DESC);

ALTER TABLE executive_briefing_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY exec_briefing_read ON executive_briefing_log FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('founder','marketing_manager','project_manager')
    )
  );

CREATE POLICY exec_briefing_service_write ON executive_briefing_log FOR ALL TO service_role
  USING (TRUE) WITH CHECK (TRUE);

-- S7 — voice_report_log
CREATE TABLE voice_report_log (
  id                       UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_phone             TEXT           NOT NULL,
  sender_employee_id       UUID           REFERENCES employees(id),
  audio_storage_path       TEXT,
  raw_transcript           TEXT,
  detected_project_id      UUID           REFERENCES projects(id),
  project_match_confidence NUMERIC(3,2),
  structured_json          JSONB,
  detected_actions         JSONB          NOT NULL DEFAULT '[]',
  status                   TEXT           NOT NULL DEFAULT 'awaiting_confirmation'
    CHECK (status IN (
      'transcribing','awaiting_confirmation','confirmed_applied',
      'rejected','expired','error'
    )),
  daily_site_report_id     UUID           REFERENCES daily_site_reports(id),
  asr_provider             TEXT           NOT NULL DEFAULT 'sarvam',
  asr_cost_inr             NUMERIC(8,2),
  llm_tokens_in            INT,
  llm_tokens_out           INT,
  error_message            TEXT,
  expires_at               TIMESTAMPTZ    NOT NULL DEFAULT (NOW() + INTERVAL '10 minutes'),
  applied_at               TIMESTAMPTZ,
  created_at               TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_voice_report_sender   ON voice_report_log (sender_phone, created_at DESC);
CREATE INDEX idx_voice_report_awaiting ON voice_report_log (status) WHERE status = 'awaiting_confirmation';

ALTER TABLE voice_report_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY voice_report_read ON voice_report_log FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'founder')
    OR sender_employee_id = (SELECT id FROM employees WHERE profile_id = auth.uid())
  );

CREATE POLICY voice_report_service_write ON voice_report_log FOR ALL TO service_role
  USING (TRUE) WITH CHECK (TRUE);

-- Storage bucket for voice reports
INSERT INTO storage.buckets (id, name, public)
  VALUES ('voice-reports', 'voice-reports', false)
  ON CONFLICT (id) DO NOTHING;
