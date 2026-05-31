-- Migration 143 — 2026-05-30 increment_boq_dispatched_qty RPC
-- ============================================================
-- Background: `apps/erp/src/lib/project-step-actions.ts::createDeliveryChallan`
-- previously tried `supabase.rpc('increment_boq_dispatched_qty', …)` and, when
-- (always) it returned a "function not found" error, fell through to a
-- non-atomic read-then-write block:
--
--     SELECT dispatched_qty FROM project_boq_items WHERE id = $1;
--     UPDATE project_boq_items SET dispatched_qty = $old + $delta WHERE id = $1;
--
-- Two delivery challans dispatched in parallel would each read the same
-- starting dispatched_qty and overwrite the other's increment — a classic
-- lost-update race. The fix is a real RPC that does an atomic
-- `dispatched_qty = dispatched_qty + $delta` in a single UPDATE statement.
--
-- Flagged in docs/reviews/sections/2026-05-30-types.md (missing RPC) and the
-- overnight comprehensive review (`project-step-actions.ts:1095`).
--
-- The RPC is SECURITY DEFINER so it bypasses the per-row RLS check that would
-- otherwise require us to evaluate `profiles.role IN ('founder', ...)` on every
-- increment. Instead, the function self-checks `auth.uid() IS NOT NULL` to
-- ensure only authenticated callers can hit it, then runs as the function
-- owner. `SET search_path = public, pg_temp` matches the project-wide hygiene
-- standard (migration 141).

CREATE OR REPLACE FUNCTION public.increment_boq_dispatched_qty(
  p_boq_item_id UUID,
  p_delta       NUMERIC
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_new_qty NUMERIC(10,2);
BEGIN
  -- Authentication gate — anonymous callers can't increment dispatched qty.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'increment_boq_dispatched_qty: caller must be authenticated';
  END IF;

  -- Atomic increment + return the resulting value.
  UPDATE public.project_boq_items
     SET dispatched_qty = dispatched_qty + p_delta
   WHERE id = p_boq_item_id
   RETURNING dispatched_qty INTO v_new_qty;

  IF v_new_qty IS NULL THEN
    RAISE EXCEPTION 'increment_boq_dispatched_qty: project_boq_items row % not found', p_boq_item_id;
  END IF;

  RETURN v_new_qty;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_boq_dispatched_qty(UUID, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_boq_dispatched_qty(UUID, NUMERIC) TO authenticated;

COMMENT ON FUNCTION public.increment_boq_dispatched_qty(UUID, NUMERIC) IS
  'Atomically increment project_boq_items.dispatched_qty by p_delta and return the new value. Called from createDeliveryChallan to avoid lost-update races between parallel challan dispatches.';
