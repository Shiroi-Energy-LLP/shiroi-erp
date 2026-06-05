/**
 * Vitest unit tests for receivables-reconciliation-queries.ts (CRITICAL T2
 * from the 2026-06-05 test-coverage push; mig 118).
 *
 * The reconciliation lives behind a SQL RPC (get_receivables_reconciliation)
 * because all monetary aggregation must happen in SQL (NEVER-DO #12). These
 * tests mock the .rpc() call result and verify the caller correctly:
 *   - shapes the row data (NUMERIC → number coercion, null pass-through)
 *   - handles RPC errors by throwing (this is a *queries* file — throws are
 *     fine here since it's not a server action; the RSC boundary is held
 *     by the calling page)
 *   - returns [] on empty data
 *   - the KPI computer (computeReconciliationKpis) sums correctly without
 *     mutating its input
 *
 * Run with: pnpm --filter @repo/erp vitest run src/lib/__tests__/get-receivables-reconciliation.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mock state ───────────────────────────────────────────────────────────

interface RpcCall {
  name: string;
  args: Record<string, unknown> | undefined;
}

interface MockState {
  // Result returned from supabase.rpc()
  rpcResult: { data: unknown; error: { code: string; message: string } | null };
  // Observed RPC calls (for assertions)
  rpcs: RpcCall[];
}

const state: MockState = {
  rpcResult: { data: [], error: null },
  rpcs: [],
};

function resetState() {
  state.rpcResult = { data: [], error: null };
  state.rpcs = [];
}

const mockClient = {
  rpc: async (name: string, args?: Record<string, unknown>) => {
    state.rpcs.push({ name, args });
    return state.rpcResult;
  },
};

vi.mock('@repo/supabase/server', () => ({
  createClient: async () => mockClient,
}));

// Import AFTER vi.mock.
import {
  getReceivablesReconciliation,
  computeReconciliationKpis,
  type ReconciliationRow,
} from '../receivables-reconciliation-queries';

beforeEach(() => {
  resetState();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ── getReceivablesReconciliation ────────────────────────────────────────

describe('getReceivablesReconciliation', () => {
  it('calls the correct RPC name (get_receivables_reconciliation)', async () => {
    await getReceivablesReconciliation();
    expect(state.rpcs).toHaveLength(1);
    expect(state.rpcs[0]!.name).toBe('get_receivables_reconciliation');
  });

  it('returns [] when RPC returns null/empty', async () => {
    state.rpcResult = { data: null, error: null };
    const out = await getReceivablesReconciliation();
    expect(out).toEqual([]);

    state.rpcResult = { data: [], error: null };
    const out2 = await getReceivablesReconciliation();
    expect(out2).toEqual([]);
  });

  it('throws (with the RPC error message) on RPC error', async () => {
    state.rpcResult = {
      data: null,
      error: { code: '42883', message: 'function does not exist' },
    };

    await expect(getReceivablesReconciliation()).rejects.toThrow(
      /function does not exist/,
    );
  });

  it('coerces numeric strings/numbers to numbers and preserves null last_payment_date', async () => {
    // The Postgres RPC returns NUMERIC values that arrive as numbers OR
    // strings depending on the postgres driver path. The caller must coerce.
    state.rpcResult = {
      data: [
        {
          project_id: 'p-1',
          project_number: 'SE/26/001',
          customer_name: 'Alpha',
          project_status: 'in_progress',
          total_invoiced: '500000.00',
          total_paid: '200000.50',
          outstanding: '299999.50',
          invoice_count: '3',
          overdue_count: '1',
          last_payment_date: '2026-05-15',
        },
        {
          project_id: 'p-2',
          project_number: 'SE/26/002',
          customer_name: 'Beta',
          project_status: 'completed',
          total_invoiced: 100000,
          total_paid: 100000,
          outstanding: 0,
          invoice_count: 1,
          overdue_count: 0,
          last_payment_date: null,
        },
      ],
      error: null,
    };

    const rows = await getReceivablesReconciliation();

    expect(rows).toHaveLength(2);
    expect(rows[0]!.total_invoiced).toBe(500000);
    expect(rows[0]!.total_paid).toBe(200000.5);
    expect(rows[0]!.outstanding).toBe(299999.5);
    expect(rows[0]!.invoice_count).toBe(3);
    expect(rows[0]!.overdue_count).toBe(1);
    expect(rows[0]!.last_payment_date).toBe('2026-05-15');

    // Row 2: null pass-through and zero coercion both work.
    expect(rows[1]!.outstanding).toBe(0);
    expect(rows[1]!.last_payment_date).toBeNull();
  });

  it('passes no args to the RPC (function has no parameters)', async () => {
    await getReceivablesReconciliation();
    expect(state.rpcs[0]!.args).toBeUndefined();
  });
});

// ── computeReconciliationKpis ───────────────────────────────────────────

describe('computeReconciliationKpis', () => {
  // The KPI computer is a pure function over already-aggregated rows
  // (NOT a money sum over raw payment events). Acceptable per NEVER-DO #12
  // because the underlying row.outstanding is itself a SQL-aggregated number.

  const today = new Date('2026-06-05T12:00:00.000Z');

  function row(overrides: Partial<ReconciliationRow>): ReconciliationRow {
    return {
      project_id: 'p',
      project_number: 'SE/26/000',
      customer_name: 'X',
      project_status: 'in_progress',
      total_invoiced: 0,
      total_paid: 0,
      outstanding: 0,
      invoice_count: 0,
      overdue_count: 0,
      last_payment_date: null,
      ...overrides,
    };
  }

  it('returns zeros for empty input', () => {
    const kpis = computeReconciliationKpis([], today);
    expect(kpis).toEqual({
      total_outstanding: 0,
      overdue_60d: 0,
      projects_no_invoice: 0,
    });
  });

  it('sums total_outstanding across all rows', () => {
    const rows = [
      row({ outstanding: 100000, invoice_count: 2, last_payment_date: '2026-05-01' }),
      row({ outstanding: 50000, invoice_count: 1, last_payment_date: '2026-04-01' }),
      row({ outstanding: 0, invoice_count: 1, last_payment_date: '2026-05-30' }),
    ];

    const kpis = computeReconciliationKpis(rows, today);
    expect(kpis.total_outstanding).toBe(150000);
  });

  it('counts projects with zero invoices as projects_no_invoice', () => {
    const rows = [
      row({ outstanding: 0, invoice_count: 0 }),
      row({ outstanding: 0, invoice_count: 0 }),
      row({ outstanding: 5000, invoice_count: 1, last_payment_date: '2026-06-01' }),
    ];

    const kpis = computeReconciliationKpis(rows, today);
    expect(kpis.projects_no_invoice).toBe(2);
  });

  it('overdue_60d aggregates outstanding for projects with last_payment >= 60d old', () => {
    // today = 2026-06-05 → 60 days ago = 2026-04-06
    const rows = [
      // 65 days old → counts
      row({ outstanding: 100000, invoice_count: 1, last_payment_date: '2026-04-01' }),
      // 30 days old → does NOT count
      row({ outstanding: 50000, invoice_count: 1, last_payment_date: '2026-05-06' }),
      // No payment ever, outstanding > 0 → counts (daysSincePayment = 999)
      row({ outstanding: 25000, invoice_count: 2, last_payment_date: null }),
      // outstanding = 0 → never counts regardless of age
      row({ outstanding: 0, invoice_count: 1, last_payment_date: '2025-01-01' }),
    ];

    const kpis = computeReconciliationKpis(rows, today);
    expect(kpis.overdue_60d).toBe(125000);
  });

  it('does not mutate the input rows array', () => {
    const rows = [
      row({ outstanding: 100000, invoice_count: 1, last_payment_date: '2026-04-01' }),
    ];
    const frozen = JSON.stringify(rows);
    computeReconciliationKpis(rows, today);
    expect(JSON.stringify(rows)).toBe(frozen);
  });

  it('handles a mix of projects (no-invoice + overdue + recent) cleanly', () => {
    const rows = [
      row({ outstanding: 200000, invoice_count: 2, last_payment_date: '2026-03-01' }), // overdue 90+
      row({ outstanding: 0, invoice_count: 0, last_payment_date: null }),               // no invoice
      row({ outstanding: 75000, invoice_count: 1, last_payment_date: '2026-06-01' }),  // recent
      row({ outstanding: 0, invoice_count: 1, last_payment_date: '2025-01-01' }),       // paid up
    ];

    const kpis = computeReconciliationKpis(rows, today);
    expect(kpis.total_outstanding).toBe(275000);
    expect(kpis.projects_no_invoice).toBe(1);
    expect(kpis.overdue_60d).toBe(200000);
  });
});
