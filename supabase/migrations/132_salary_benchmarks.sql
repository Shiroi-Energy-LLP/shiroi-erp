-- Migration 132: Salary benchmarking analytics
-- salary_benchmarks holds market data (manual research / report import).
-- RPC get_salary_benchmark_report() compares each employee's gross_monthly to market.

CREATE TABLE IF NOT EXISTS salary_benchmarks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role TEXT NOT NULL,
  designation TEXT,
  market_median NUMERIC(14,2) NOT NULL,
  market_p25 NUMERIC(14,2),
  market_p75 NUMERIC(14,2),
  source TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_salary_benchmarks_role ON salary_benchmarks(role);

-- Seed Chennai 2026 market estimates for common Shiroi roles
INSERT INTO salary_benchmarks (role, designation, market_median, market_p25, market_p75, source) VALUES
  ('marketing_manager', NULL, 65000, 50000, 90000, 'Chennai market estimate 2026'),
  ('project_manager',   NULL, 55000, 40000, 75000, 'Chennai market estimate 2026'),
  ('sales_engineer',    NULL, 35000, 25000, 50000, 'Chennai market estimate 2026'),
  ('designer',          NULL, 32000, 22000, 45000, 'Chennai market estimate 2026'),
  ('om_technician',     NULL, 28000, 18000, 40000, 'Chennai market estimate 2026'),
  ('finance',           NULL, 45000, 30000, 65000, 'Chennai market estimate 2026'),
  ('hr_manager',        NULL, 50000, 35000, 70000, 'Chennai market estimate 2026')
ON CONFLICT DO NOTHING;

-- RPC: benchmark report (founder + hr_manager only, enforced via RLS on profiles query)
CREATE OR REPLACE FUNCTION get_salary_benchmark_report()
RETURNS TABLE (
  employee_id    UUID,
  employee_name  TEXT,
  role           TEXT,
  gross_monthly  NUMERIC,
  market_median  NUMERIC,
  market_p25     NUMERIC,
  market_p75     NUMERIC,
  delta_pct      NUMERIC,
  recommendation TEXT,
  source         TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Guard: caller must be founder or hr_manager
  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
      AND profiles.role IN ('founder', 'hr_manager')
  ) THEN
    RAISE EXCEPTION 'Access denied: founder or hr_manager only';
  END IF;

  RETURN QUERY
  SELECT
    e.id                                             AS employee_id,
    p.full_name                                      AS employee_name,
    p.role                                           AS role,
    e.gross_monthly                                  AS gross_monthly,
    sb.market_median                                 AS market_median,
    sb.market_p25                                    AS market_p25,
    sb.market_p75                                    AS market_p75,
    CASE
      WHEN sb.market_median > 0
        THEN ROUND(((e.gross_monthly - sb.market_median) / sb.market_median * 100)::NUMERIC, 1)
      ELSE NULL
    END                                              AS delta_pct,
    CASE
      WHEN sb.market_p25 IS NOT NULL AND e.gross_monthly < sb.market_p25 THEN 'underpaid'
      WHEN sb.market_p75 IS NOT NULL AND e.gross_monthly > sb.market_p75 THEN 'overpaid'
      ELSE 'fair'
    END                                              AS recommendation,
    sb.source                                        AS source
  FROM employees e
  JOIN profiles p ON p.id = e.profile_id
  LEFT JOIN salary_benchmarks sb
    ON sb.role = p.role AND sb.designation IS NULL
  WHERE e.is_active = TRUE
    AND e.gross_monthly IS NOT NULL
    AND e.gross_monthly > 0
  ORDER BY p.role, p.full_name;
END;
$$;

-- RLS on salary_benchmarks: founder + hr_manager
ALTER TABLE salary_benchmarks ENABLE ROW LEVEL SECURITY;

CREATE POLICY salary_benchmarks_select ON salary_benchmarks
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('founder', 'hr_manager')
    )
  );

CREATE POLICY salary_benchmarks_all ON salary_benchmarks
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'founder'
    )
  );
