-- 102_project_review_triage.sql
-- Project Data Review triage UI — see spec 2026-05-02-project-data-review-design.md
-- Adds review_status to projects + audit table + 5 helper functions.

BEGIN;

-- ── 1. Add review_status column to projects ──────────────────────────────────

ALTER TABLE projects
  ADD COLUMN review_status TEXT
    NOT NULL
    DEFAULT 'pending'
    CHECK (review_status IN ('pending','confirmed','duplicate'));

-- Index for the "Needs Review" tab (most common query)
CREATE INDEX projects_review_status_idx
  ON projects(review_status)
  WHERE deleted_at IS NULL;

-- ── 2. Update projects UPDATE RLS to include marketing_manager ───────────────

DROP POLICY IF EXISTS projects_update ON projects;

CREATE POLICY projects_update
  ON projects FOR UPDATE
  USING (
    (get_my_role() = ANY (ARRAY['founder'::app_role, 'project_manager'::app_role, 'marketing_manager'::app_role]))
    OR (project_manager_id = get_my_employee_id())
  );

-- ── 3. Audit log table ───────────────────────────────────────────────────────

CREATE TABLE project_review_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  decision TEXT NOT NULL CHECK (decision IN ('confirmed','duplicate','undo')),
  prev_size_kwp NUMERIC(10,2),
  new_size_kwp NUMERIC(10,2),
  prev_contracted_value NUMERIC(14,2),
  new_contracted_value NUMERIC(14,2),
  duplicate_of_project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  -- For duplicate decisions: data-richness scores at decision time
  losing_score INTEGER,
  winning_score INTEGER,
  notes TEXT,
  made_by UUID NOT NULL REFERENCES profiles(id),
  made_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX project_review_audit_project_id_idx ON project_review_audit(project_id);
CREATE INDEX project_review_audit_made_at_idx ON project_review_audit(made_at DESC);

-- ── 4. RLS on audit table ─────────────────────────────────────────────────────

ALTER TABLE project_review_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY project_review_audit_read
  ON project_review_audit FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
      AND p.role IN ('founder','marketing_manager','project_manager')
  ));

CREATE POLICY project_review_audit_insert
  ON project_review_audit FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
      AND p.role IN ('founder','marketing_manager','project_manager')
  ));

-- ── 5. Helper: get_project_review_counts ─────────────────────────────────────

CREATE OR REPLACE FUNCTION get_project_review_counts()
  RETURNS TABLE(needs_review BIGINT, all_projects BIGINT, confirmed BIGINT, duplicate BIGINT)
  LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT
    COUNT(*) FILTER (
      WHERE p.review_status = 'pending'
        AND p.deleted_at IS NULL
        AND (
          pr.financials_invalidated
          OR pr.system_size_uncertain
          OR pr.notes ILIKE '%[Likely-Duplicate-Reconcile]%'
        )
    ) AS needs_review,
    COUNT(*) FILTER (WHERE p.deleted_at IS NULL) AS all_projects,
    COUNT(*) FILTER (WHERE p.review_status = 'confirmed') AS confirmed,
    COUNT(*) FILTER (WHERE p.review_status = 'duplicate') AS duplicate
  FROM projects p
  LEFT JOIN proposals pr ON pr.id = p.proposal_id;
$$;

-- ── 6. Helper: confirm_project_review ────────────────────────────────────────

CREATE OR REPLACE FUNCTION confirm_project_review(
  p_project_id UUID,
  p_new_size_kwp NUMERIC,
  p_new_contracted_value NUMERIC,
  p_made_by UUID
) RETURNS TABLE(success BOOLEAN, code TEXT)
  LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE
  v_project projects%ROWTYPE;
  v_proposal_id UUID;
  v_per_kwp NUMERIC;
BEGIN
  SELECT * INTO v_project FROM projects WHERE id = p_project_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT FALSE, 'not_found'::TEXT; RETURN; END IF;
  IF v_project.review_status <> 'pending' THEN RETURN QUERY SELECT FALSE, 'already_triaged'::TEXT; RETURN; END IF;

  -- Sanity checks
  IF p_new_size_kwp <= 0 THEN RETURN QUERY SELECT FALSE, 'size_must_be_positive'::TEXT; RETURN; END IF;
  IF p_new_contracted_value < 0 THEN RETURN QUERY SELECT FALSE, 'value_must_be_non_negative'::TEXT; RETURN; END IF;
  IF p_new_contracted_value > 0 THEN
    v_per_kwp := p_new_contracted_value / p_new_size_kwp;
    IF v_per_kwp > 500000 THEN RETURN QUERY SELECT FALSE, 'still_implausible'::TEXT; RETURN; END IF;
  END IF;

  v_proposal_id := v_project.proposal_id;

  -- Audit row first (so it survives even if the UPDATE chain hits a constraint)
  INSERT INTO project_review_audit(project_id, decision, prev_size_kwp, new_size_kwp, prev_contracted_value, new_contracted_value, made_by)
  VALUES (p_project_id, 'confirmed', v_project.system_size_kwp, p_new_size_kwp, v_project.contracted_value, p_new_contracted_value, p_made_by);

  UPDATE projects SET
    system_size_kwp = p_new_size_kwp,
    contracted_value = p_new_contracted_value,
    review_status = 'confirmed'
  WHERE id = p_project_id;

  IF v_proposal_id IS NOT NULL THEN
    UPDATE proposals SET
      system_size_kwp = p_new_size_kwp,
      total_before_discount = p_new_contracted_value,
      total_after_discount = p_new_contracted_value,
      shiroi_revenue = p_new_contracted_value,
      financials_invalidated = FALSE,
      system_size_uncertain = FALSE
    WHERE id = v_proposal_id;
  END IF;

  RETURN QUERY SELECT TRUE, 'ok'::TEXT;
END;
$$;

-- ── 7. Helper: score_project_data_richness ────────────────────────────────────
-- Note: bom_items does not exist in this schema; uses expenses instead.

CREATE OR REPLACE FUNCTION score_project_data_richness(p_project_id UUID)
  RETURNS INTEGER LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT
    COALESCE((SELECT COUNT(*) FROM invoices WHERE project_id = p_project_id), 0) +
    COALESCE((SELECT COUNT(*) FROM customer_payments WHERE project_id = p_project_id), 0) +
    COALESCE((SELECT COUNT(*) FROM purchase_orders WHERE project_id = p_project_id), 0) +
    COALESCE((SELECT COUNT(*) FROM vendor_bills WHERE project_id = p_project_id), 0) +
    COALESCE((SELECT COUNT(*) FROM expenses WHERE project_id = p_project_id), 0);
$$;

-- ── 8. Helper: mark_project_duplicate ────────────────────────────────────────

CREATE OR REPLACE FUNCTION mark_project_duplicate(
  p_project_a_id UUID,
  p_project_b_id UUID,
  p_notes TEXT,
  p_made_by UUID
) RETURNS TABLE(success BOOLEAN, code TEXT, kept_project_id UUID, deleted_project_id UUID, kept_score INTEGER, deleted_score INTEGER)
  LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE
  v_a projects%ROWTYPE;
  v_b projects%ROWTYPE;
  v_score_a INTEGER;
  v_score_b INTEGER;
  v_kept_id UUID;
  v_deleted_id UUID;
  v_kept_score INTEGER;
  v_deleted_score INTEGER;
BEGIN
  IF p_project_a_id = p_project_b_id THEN
    RETURN QUERY SELECT FALSE, 'self_reference'::TEXT, NULL::UUID, NULL::UUID, 0, 0;
    RETURN;
  END IF;
  IF p_notes IS NULL OR length(trim(p_notes)) = 0 THEN
    RETURN QUERY SELECT FALSE, 'notes_required'::TEXT, NULL::UUID, NULL::UUID, 0, 0;
    RETURN;
  END IF;

  SELECT * INTO v_a FROM projects WHERE id = p_project_a_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'a_not_found'::TEXT, NULL::UUID, NULL::UUID, 0, 0;
    RETURN;
  END IF;
  SELECT * INTO v_b FROM projects WHERE id = p_project_b_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'b_not_found'::TEXT, NULL::UUID, NULL::UUID, 0, 0;
    RETURN;
  END IF;

  v_score_a := score_project_data_richness(p_project_a_id);
  v_score_b := score_project_data_richness(p_project_b_id);

  -- Pick canonical: higher score wins; tie → older created_at wins
  IF v_score_a > v_score_b OR (v_score_a = v_score_b AND v_a.created_at <= v_b.created_at) THEN
    v_kept_id := p_project_a_id; v_deleted_id := p_project_b_id;
    v_kept_score := v_score_a; v_deleted_score := v_score_b;
  ELSE
    v_kept_id := p_project_b_id; v_deleted_id := p_project_a_id;
    v_kept_score := v_score_b; v_deleted_score := v_score_a;
  END IF;

  -- Audit the deleted project so its history shows the merge
  INSERT INTO project_review_audit(project_id, decision, duplicate_of_project_id, losing_score, winning_score, notes, made_by)
  VALUES (v_deleted_id, 'duplicate', v_kept_id, v_deleted_score, v_kept_score, p_notes, p_made_by);

  UPDATE projects SET review_status = 'duplicate', deleted_at = NOW() WHERE id = v_deleted_id;
  -- The kept project flips from pending to confirmed — the duplicate-merge counts as a review
  UPDATE projects SET review_status = 'confirmed' WHERE id = v_kept_id AND review_status = 'pending';

  RETURN QUERY SELECT TRUE, 'ok'::TEXT, v_kept_id, v_deleted_id, v_kept_score, v_deleted_score;
END;
$$;

-- ── 9. Helper: undo_project_review ───────────────────────────────────────────

CREATE OR REPLACE FUNCTION undo_project_review(
  p_project_id UUID,
  p_made_by UUID
) RETURNS TABLE(success BOOLEAN, code TEXT)
  LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE
  v_audit project_review_audit%ROWTYPE;
BEGIN
  SELECT * INTO v_audit FROM project_review_audit
    WHERE project_id = p_project_id AND decision <> 'undo'
    ORDER BY made_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN QUERY SELECT FALSE, 'no_decision_to_undo'::TEXT; RETURN; END IF;

  -- Revert based on the original decision
  IF v_audit.decision = 'confirmed' THEN
    -- Restore prev values + flip back to pending
    UPDATE projects SET
      system_size_kwp = COALESCE(v_audit.prev_size_kwp, system_size_kwp),
      contracted_value = COALESCE(v_audit.prev_contracted_value, contracted_value),
      review_status = 'pending'
    WHERE id = p_project_id;
    -- Restore proposal flags (we lose info on the original flag state — set both to TRUE so banner reappears)
    UPDATE proposals pr SET
      system_size_kwp = COALESCE(v_audit.prev_size_kwp, pr.system_size_kwp),
      total_before_discount = COALESCE(v_audit.prev_contracted_value, pr.total_before_discount),
      total_after_discount = COALESCE(v_audit.prev_contracted_value, pr.total_after_discount),
      shiroi_revenue = COALESCE(v_audit.prev_contracted_value, pr.shiroi_revenue),
      financials_invalidated = TRUE,
      system_size_uncertain = TRUE
    WHERE pr.id = (SELECT proposal_id FROM projects WHERE id = p_project_id);
  ELSIF v_audit.decision = 'duplicate' THEN
    -- Restore the deleted project + flip canonical back to pending if it was pending before
    UPDATE projects SET deleted_at = NULL, review_status = 'pending' WHERE id = p_project_id;
    UPDATE projects SET review_status = 'pending'
      WHERE id = v_audit.duplicate_of_project_id AND review_status = 'confirmed';
  END IF;

  INSERT INTO project_review_audit(project_id, decision, made_by, notes)
  VALUES (p_project_id, 'undo', p_made_by, 'Undo of audit row ' || v_audit.id);

  RETURN QUERY SELECT TRUE, 'ok'::TEXT;
END;
$$;

COMMIT;
