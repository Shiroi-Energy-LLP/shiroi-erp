-- ============================================================
-- Migration 005c — Training Domain
-- File: supabase/migrations/005c_training.sql
-- Description: Training modules, question bank, employee
--              progress, spaced repetition, onboarding tracks,
--              track assignments, daily delivery log,
--              assessment results, and language training.
-- Date: 2026-03-29
-- Rollback:
--   DROP TABLE IF EXISTS language_training_scenarios CASCADE;
--   DROP TABLE IF EXISTS training_assessment_results CASCADE;
--   DROP TABLE IF EXISTS daily_question_delivery_log CASCADE;
--   DROP TABLE IF EXISTS onboarding_track_assignments CASCADE;
--   DROP TABLE IF EXISTS onboarding_tracks CASCADE;
--   DROP TABLE IF EXISTS employee_question_progress CASCADE;
--   DROP TABLE IF EXISTS training_questions CASCADE;
--   DROP TABLE IF EXISTS training_modules CASCADE;
-- Dependencies: 001_foundation.sql, 005a_hr_master.sql
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. training_modules
-- Top-level grouping of training content.
-- e.g. 'Solar Basics', 'Electrical Safety', 'Customer Handling'
-- ------------------------------------------------------------
CREATE TABLE training_modules (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_name           TEXT NOT NULL UNIQUE,
  description           TEXT,

  module_type           TEXT NOT NULL CHECK (module_type IN (
    'technical', 'safety', 'compliance',
    'customer_handling', 'process', 'language', 'other'
  )),

  target_roles          app_role[] NOT NULL DEFAULT '{}',
  -- Which roles this module applies to.
  -- e.g. '{site_supervisor, om_technician}'

  is_onboarding_required BOOLEAN NOT NULL DEFAULT FALSE,
  -- TRUE: must complete before first site deployment.

  estimated_days        INT,
  -- Approximate days to complete at 3-5 questions/day.

  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  created_by            UUID REFERENCES employees(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER training_modules_updated_at
  BEFORE UPDATE ON training_modules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_training_modules_type   ON training_modules(module_type);
CREATE INDEX idx_training_modules_active ON training_modules(is_active)
  WHERE is_active = TRUE;


-- ------------------------------------------------------------
-- 2. training_questions
-- Individual questions in the microlearning bank.
-- 3-5 delivered per employee per day at 9am via WhatsApp.
-- Time-sensitive questions: accuracy_review_date enforced.
-- Unverified questions auto-suspended from delivery.
-- ------------------------------------------------------------
CREATE TABLE training_questions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id             UUID NOT NULL REFERENCES training_modules(id) ON DELETE RESTRICT,

  question_text         TEXT NOT NULL,
  question_type         TEXT NOT NULL CHECK (question_type IN (
    'multiple_choice', 'true_false', 'short_answer'
  )),

  -- Answer options (for multiple_choice)
  option_a              TEXT,
  option_b              TEXT,
  option_c              TEXT,
  option_d              TEXT,
  correct_answer        TEXT NOT NULL,
  -- For multiple_choice: 'A', 'B', 'C', or 'D'.
  -- For true_false: 'True' or 'False'.
  -- For short_answer: model answer text.

  explanation           TEXT,
  -- Shown to employee after answering. Explains WHY.

  difficulty            TEXT NOT NULL DEFAULT 'medium' CHECK (difficulty IN (
    'easy', 'medium', 'hard'
  )),

  -- Time-sensitive content
  is_time_sensitive     BOOLEAN NOT NULL DEFAULT FALSE,
  -- TRUE for: tariff rates, subsidy amounts, policy details.
  accuracy_review_date  DATE,
  -- Must be verified by this date. If unverified → auto-suspended.
  last_verified_at      DATE,
  last_verified_by      UUID REFERENCES employees(id),

  -- Delivery status
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  is_suspended          BOOLEAN NOT NULL DEFAULT FALSE,
  -- Auto-set when time_sensitive and accuracy_review_date passed.
  suspended_reason      TEXT,

  -- Performance tracking (updated by nightly cron)
  times_delivered       INT NOT NULL DEFAULT 0,
  times_correct         INT NOT NULL DEFAULT 0,
  correct_rate_pct      NUMERIC(5,2) NOT NULL DEFAULT 0,

  created_by            UUID REFERENCES employees(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER training_questions_updated_at
  BEFORE UPDATE ON training_questions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_questions_module    ON training_questions(module_id);
CREATE INDEX idx_questions_active    ON training_questions(is_active, is_suspended)
  WHERE is_active = TRUE AND is_suspended = FALSE;
CREATE INDEX idx_questions_review    ON training_questions(accuracy_review_date)
  WHERE is_time_sensitive = TRUE AND is_suspended = FALSE;
CREATE INDEX idx_questions_suspended ON training_questions(is_suspended)
  WHERE is_suspended = TRUE;


-- ------------------------------------------------------------
-- 3. employee_question_progress
-- Spaced repetition state per employee per question.
-- Wrong → tomorrow.
-- 1 correct → +3 days.
-- 2 correct → +7 days.
-- 3+ correct → +30 days (mastered).
-- ------------------------------------------------------------
CREATE TABLE employee_question_progress (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id           UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  question_id           UUID NOT NULL REFERENCES training_questions(id) ON DELETE CASCADE,

  -- Spaced repetition state
  consecutive_correct   INT NOT NULL DEFAULT 0,
  total_attempts        INT NOT NULL DEFAULT 0,
  total_correct         INT NOT NULL DEFAULT 0,

  last_delivered_date   DATE,
  next_delivery_date    DATE,
  -- Computed after each answer based on spaced repetition rules.

  is_mastered           BOOLEAN NOT NULL DEFAULT FALSE,
  -- TRUE when consecutive_correct >= 3.
  mastered_at           DATE,

  -- Last answer
  last_answer           TEXT,
  last_answer_correct   BOOLEAN,
  last_answered_at      TIMESTAMPTZ,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER question_progress_updated_at
  BEFORE UPDATE ON employee_question_progress
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE UNIQUE INDEX idx_question_progress_unique
  ON employee_question_progress(employee_id, question_id);
CREATE INDEX idx_question_progress_delivery
  ON employee_question_progress(employee_id, next_delivery_date)
  WHERE is_mastered = FALSE;
CREATE INDEX idx_question_progress_mastered
  ON employee_question_progress(employee_id)
  WHERE is_mastered = TRUE;


-- ------------------------------------------------------------
-- 4. onboarding_tracks
-- Structured learning path for new employees.
-- Safety modules must complete before site assignment.
-- Gates deployment via employee_certifications.
-- ------------------------------------------------------------
CREATE TABLE onboarding_tracks (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  track_name            TEXT NOT NULL UNIQUE,
  description           TEXT,

  target_roles          app_role[] NOT NULL DEFAULT '{}',
  -- Roles this track applies to.

  -- Module sequence
  module_sequence       UUID[] NOT NULL DEFAULT '{}',
  -- Ordered array of training_module IDs.
  -- Completion follows this sequence.

  blocks_deployment     BOOLEAN NOT NULL DEFAULT FALSE,
  -- TRUE: employee cannot be assigned to site until complete.

  estimated_days        INT,
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER onboarding_tracks_updated_at
  BEFORE UPDATE ON onboarding_tracks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_onboarding_tracks_active ON onboarding_tracks(is_active)
  WHERE is_active = TRUE;


-- ------------------------------------------------------------
-- 5. onboarding_track_assignments
-- Tracks which onboarding track each employee is on
-- and their progress through it.
-- ------------------------------------------------------------
CREATE TABLE onboarding_track_assignments (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id           UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  track_id              UUID NOT NULL REFERENCES onboarding_tracks(id),
  assigned_by           UUID REFERENCES employees(id),
  assigned_at           DATE NOT NULL DEFAULT CURRENT_DATE,

  -- Progress
  current_module_id     UUID REFERENCES training_modules(id),
  modules_completed     INT NOT NULL DEFAULT 0,
  modules_total         INT NOT NULL DEFAULT 0,
  completion_pct        NUMERIC(5,2) NOT NULL DEFAULT 0,

  started_at            DATE,
  completed_at          DATE,
  is_complete           BOOLEAN NOT NULL DEFAULT FALSE,

  -- Deployment gate
  deployment_cleared    BOOLEAN NOT NULL DEFAULT FALSE,
  -- Set TRUE when is_complete = TRUE and track blocks_deployment = TRUE.
  deployment_cleared_at TIMESTAMPTZ,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER track_assignments_updated_at
  BEFORE UPDATE ON onboarding_track_assignments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE UNIQUE INDEX idx_track_assignments_unique
  ON onboarding_track_assignments(employee_id, track_id);
CREATE INDEX idx_track_assignments_employee
  ON onboarding_track_assignments(employee_id);
CREATE INDEX idx_track_assignments_incomplete
  ON onboarding_track_assignments(employee_id)
  WHERE is_complete = FALSE;


-- ------------------------------------------------------------
-- 6. daily_question_delivery_log
-- Every WhatsApp question delivery logged here.
-- Immutable — Tier 3.
-- n8n sends questions at 9am. Response tracked here.
-- ------------------------------------------------------------
CREATE TABLE daily_question_delivery_log (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id           UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  question_id           UUID NOT NULL REFERENCES training_questions(id),
  progress_id           UUID NOT NULL REFERENCES employee_question_progress(id),

  delivered_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivery_method       TEXT NOT NULL DEFAULT 'whatsapp' CHECK (delivery_method IN (
    'whatsapp', 'app_notification', 'sms'
  )),
  delivery_status       TEXT NOT NULL DEFAULT 'sent' CHECK (delivery_status IN (
    'sent', 'delivered', 'failed'
  )),

  -- Response
  responded_at          TIMESTAMPTZ,
  employee_answer       TEXT,
  is_correct            BOOLEAN,
  response_time_seconds INT,
  -- How quickly employee answered after delivery.

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- Immutable. No updated_at.
);

CREATE INDEX idx_delivery_log_employee ON daily_question_delivery_log(employee_id, delivered_at DESC);
CREATE INDEX idx_delivery_log_question ON daily_question_delivery_log(question_id);
CREATE INDEX idx_delivery_log_pending  ON daily_question_delivery_log(employee_id)
  WHERE responded_at IS NULL;


-- ------------------------------------------------------------
-- 7. training_assessment_results
-- Formal assessments at module completion.
-- Different from daily microlearning — these are scored tests.
-- Immutable — Tier 3.
-- ------------------------------------------------------------
CREATE TABLE training_assessment_results (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id           UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  module_id             UUID NOT NULL REFERENCES training_modules(id),
  assessed_by           UUID REFERENCES employees(id),
  -- NULL for auto-graded assessments.

  assessment_date       DATE NOT NULL DEFAULT CURRENT_DATE,
  score_pct             NUMERIC(5,2) NOT NULL,
  pass_threshold_pct    NUMERIC(5,2) NOT NULL DEFAULT 70,
  passed                BOOLEAN NOT NULL,

  attempt_number        INT NOT NULL DEFAULT 1,
  -- Tracks retakes.

  answers_raw           JSONB,
  -- Full answer record for audit.

  certificate_issued    BOOLEAN NOT NULL DEFAULT FALSE,
  certificate_storage_path TEXT,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- Immutable. No updated_at.
);

CREATE INDEX idx_assessment_results_employee ON training_assessment_results(employee_id);
CREATE INDEX idx_assessment_results_module   ON training_assessment_results(module_id);
CREATE INDEX idx_assessment_results_passed   ON training_assessment_results(employee_id)
  WHERE passed = TRUE;


-- ------------------------------------------------------------
-- 8. language_training_scenarios
-- Bilingual (Tamil/English) customer interaction scripts.
-- Used for: sales calls, site visits, complaint handling.
-- Delivered via WhatsApp training bot.
-- ------------------------------------------------------------
CREATE TABLE language_training_scenarios (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id             UUID NOT NULL REFERENCES training_modules(id),

  scenario_title        TEXT NOT NULL,
  scenario_type         TEXT NOT NULL CHECK (scenario_type IN (
    'sales_pitch', 'site_visit', 'complaint_handling',
    'payment_followup', 'technical_explanation', 'other'
  )),

  -- Bilingual content
  script_english        TEXT NOT NULL,
  script_tamil          TEXT,
  key_phrases_english   TEXT[],
  key_phrases_tamil     TEXT[],

  -- Common mistakes to avoid
  dont_say_english      TEXT[],
  dont_say_tamil        TEXT[],

  target_roles          app_role[] NOT NULL DEFAULT '{}',
  difficulty            TEXT NOT NULL DEFAULT 'medium' CHECK (difficulty IN (
    'easy', 'medium', 'hard'
  )),

  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  created_by            UUID REFERENCES employees(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER language_scenarios_updated_at
  BEFORE UPDATE ON language_training_scenarios
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_language_scenarios_module ON language_training_scenarios(module_id);
CREATE INDEX idx_language_scenarios_type   ON language_training_scenarios(scenario_type);
CREATE INDEX idx_language_scenarios_active ON language_training_scenarios(is_active)
  WHERE is_active = TRUE;


-- ------------------------------------------------------------
-- RLS — training domain
-- ------------------------------------------------------------

ALTER TABLE training_modules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "training_modules_read"
  ON training_modules FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) != 'customer'
  );

CREATE POLICY "training_modules_write"
  ON training_modules FOR ALL
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'hr_manager')
  );

ALTER TABLE training_questions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "training_questions_read"
  ON training_questions FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) != 'customer'
  );

CREATE POLICY "training_questions_write"
  ON training_questions FOR ALL
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'hr_manager')
  );

ALTER TABLE employee_question_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "question_progress_read"
  ON employee_question_progress FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'hr_manager')
    OR employee_id = (SELECT id FROM employees WHERE profile_id = auth.uid())
    OR employee_id IN (
      SELECT id FROM employees
      WHERE reporting_to_id = (SELECT id FROM employees WHERE profile_id = auth.uid())
    )
  );

CREATE POLICY "question_progress_write"
  ON employee_question_progress FOR ALL
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'hr_manager')
    OR employee_id = (SELECT id FROM employees WHERE profile_id = auth.uid())
  );

ALTER TABLE onboarding_tracks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "onboarding_tracks_read"
  ON onboarding_tracks FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) != 'customer'
  );

CREATE POLICY "onboarding_tracks_write"
  ON onboarding_tracks FOR ALL
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'hr_manager')
  );

ALTER TABLE onboarding_track_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "track_assignments_read"
  ON onboarding_track_assignments FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'hr_manager')
    OR employee_id = (SELECT id FROM employees WHERE profile_id = auth.uid())
    OR employee_id IN (
      SELECT id FROM employees
      WHERE reporting_to_id = (SELECT id FROM employees WHERE profile_id = auth.uid())
    )
  );

CREATE POLICY "track_assignments_write"
  ON onboarding_track_assignments FOR ALL
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'hr_manager')
  );

ALTER TABLE daily_question_delivery_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "delivery_log_read"
  ON daily_question_delivery_log FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'hr_manager')
    OR employee_id = (SELECT id FROM employees WHERE profile_id = auth.uid())
  );

CREATE POLICY "delivery_log_insert"
  ON daily_question_delivery_log FOR INSERT
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'hr_manager')
    OR employee_id = (SELECT id FROM employees WHERE profile_id = auth.uid())
  );

ALTER TABLE training_assessment_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "assessment_results_read"
  ON training_assessment_results FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'hr_manager')
    OR employee_id = (SELECT id FROM employees WHERE profile_id = auth.uid())
    OR employee_id IN (
      SELECT id FROM employees
      WHERE reporting_to_id = (SELECT id FROM employees WHERE profile_id = auth.uid())
    )
  );

CREATE POLICY "assessment_results_insert"
  ON training_assessment_results FOR INSERT
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'hr_manager')
  );

ALTER TABLE language_training_scenarios ENABLE ROW LEVEL SECURITY;

CREATE POLICY "language_scenarios_read"
  ON language_training_scenarios FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) != 'customer'
  );

CREATE POLICY "language_scenarios_write"
  ON language_training_scenarios FOR ALL
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('founder', 'hr_manager')
  );

COMMIT;