-- Migration 117: Payment tracker follow-up fields on proposal_payment_schedule
-- + get_payments_expected_this_week() RPC
-- Adds: follow_up_date, expected_payment_date, follow_up_note, follow_up_count
-- to proposal_payment_schedule so Prem can track per-milestone follow-up activity.

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. Add columns to proposal_payment_schedule
-- ──────────────────────────────────────────────────────────────────────────────

ALTER TABLE proposal_payment_schedule
  ADD COLUMN IF NOT EXISTS follow_up_date          DATE,
  ADD COLUMN IF NOT EXISTS expected_payment_date   DATE,
  ADD COLUMN IF NOT EXISTS follow_up_note          TEXT,
  ADD COLUMN IF NOT EXISTS follow_up_count         INT NOT NULL DEFAULT 0;

-- Indexes for the two date columns (filterable, joinable)
CREATE INDEX IF NOT EXISTS idx_pps_follow_up_date
  ON proposal_payment_schedule (follow_up_date)
  WHERE follow_up_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pps_expected_payment_date
  ON proposal_payment_schedule (expected_payment_date)
  WHERE expected_payment_date IS NOT NULL;

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. RPC: get_payments_expected_this_week
--    Returns projects where a payment_schedule row has expected_payment_date
--    within the current ISO week (Mon–Sun IST). All aggregation in SQL.
-- ──────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_payments_expected_this_week()
RETURNS TABLE (
  project_id             UUID,
  project_number         TEXT,
  customer_name          TEXT,
  expected_payment_date  DATE,
  amount_due             NUMERIC(14,2),
  follow_up_count        INT,
  milestone_name         TEXT,
  milestone_order        INT,
  week_total             NUMERIC(14,2)
)
LANGUAGE sql STABLE AS $$
  -- IST offset is UTC+5:30 = 330 minutes
  WITH ist_now AS (
    SELECT (NOW() AT TIME ZONE 'Asia/Kolkata')::date AS today_ist
  ),
  iso_week AS (
    SELECT
      -- Monday of current ISO week in IST
      today_ist - EXTRACT(ISODOW FROM today_ist)::int + 1  AS week_start,
      -- Sunday of current ISO week in IST
      today_ist - EXTRACT(ISODOW FROM today_ist)::int + 7  AS week_end
    FROM ist_now
  ),
  filtered AS (
    SELECT
      p.id             AS project_id,
      p.project_number,
      p.customer_name,
      pps.expected_payment_date,
      pps.amount       AS amount_due,
      pps.follow_up_count,
      pps.milestone_name,
      pps.milestone_order
    FROM proposal_payment_schedule pps
    JOIN proposals pr  ON pr.id = pps.proposal_id AND pr.status = 'accepted'
    JOIN projects  p   ON p.lead_id = pr.lead_id
    CROSS JOIN iso_week
    WHERE pps.expected_payment_date IS NOT NULL
      AND pps.expected_payment_date BETWEEN iso_week.week_start AND iso_week.week_end
      -- Exclude milestones already fully covered by received payments
      AND pps.amount > COALESCE(
        (SELECT SUM(cp.amount) FROM customer_payments cp WHERE cp.project_id = p.id),
        0
      )
  )
  SELECT
    project_id,
    project_number,
    customer_name,
    expected_payment_date,
    amount_due,
    follow_up_count,
    milestone_name,
    milestone_order,
    -- SQL-level aggregate so JS never sums raw money rows (NEVER-DO #12)
    SUM(amount_due) OVER () AS week_total
  FROM filtered
  ORDER BY expected_payment_date, project_number;
$$;

GRANT EXECUTE ON FUNCTION get_payments_expected_this_week() TO authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- Comments
-- ──────────────────────────────────────────────────────────────────────────────
COMMENT ON COLUMN proposal_payment_schedule.follow_up_date IS 'Date Prem last followed up on this milestone (IST date)';
COMMENT ON COLUMN proposal_payment_schedule.expected_payment_date IS 'Customer-promised date for this milestone payment';
COMMENT ON COLUMN proposal_payment_schedule.follow_up_note IS 'Optional note on the most recent follow-up conversation';
COMMENT ON COLUMN proposal_payment_schedule.follow_up_count IS 'Number of times this milestone has been followed up';
