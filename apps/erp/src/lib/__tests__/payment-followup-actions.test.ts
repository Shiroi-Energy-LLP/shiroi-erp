/**
 * Vitest unit tests for payment-followup-actions.ts (CRITICAL T3 from the
 * 2026-06-05 test-coverage push; migs 088 + 117).
 *
 * The current production action is `updatePaymentFollowUp(id, input)` which
 * unifies several conceptual verbs onto one UPDATE:
 *   - "snooze"    → set expected_payment_date to a future ISO date
 *   - "clear"     → set expected_payment_date to null
 *   - "escalate"  → increment follow_up_count (every call does this) +
 *                   record a follow_up_note flagging the escalation
 *
 * Tests cover:
 *   - default follow_up_date is today (IST) when not provided
 *   - explicit followUpDate flows through unchanged
 *   - expected_payment_date "snooze" (future date) and "clear" (null)
 *   - note pass-through
 *   - follow_up_count atomic increment (current + 1)
 *   - error surfacing from fetch and update
 *   - row-not-found path
 *
 * Mocks @repo/supabase/server with a chainable query-builder that records
 * .update() calls and replays a fetched count.
 *
 * Run with: pnpm --filter @repo/erp vitest run src/lib/__tests__/payment-followup-actions.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mock state ───────────────────────────────────────────────────────────

interface UpdateCall {
  table: string;
  patch: Record<string, unknown>;
  filters: Array<{ kind: 'eq' | 'in'; column: string; value: unknown }>;
}

interface MockState {
  // Current follow_up_count returned by the pre-update SELECT
  currentRow: { follow_up_count: number | null } | null;
  fetchError: { code: string; message: string } | null;
  updateError: { code: string; message: string } | null;
  updates: UpdateCall[];
}

const state: MockState = {
  currentRow: { follow_up_count: 0 },
  fetchError: null,
  updateError: null,
  updates: [],
};

function resetState() {
  state.currentRow = { follow_up_count: 0 };
  state.fetchError = null;
  state.updateError = null;
  state.updates = [];
}

function buildFromMock(table: string) {
  return {
    select: (_cols: string) => {
      const chain = {
        eq: () => chain,
        single: async () => {
          if (table === 'proposal_payment_schedule') {
            return { data: state.currentRow, error: state.fetchError };
          }
          return { data: null, error: null };
        },
      };
      return chain;
    },
    update: (patch: Record<string, unknown>) => {
      const call: UpdateCall = { table, patch, filters: [] };
      state.updates.push(call);
      const chain = {
        eq(column: string, value: unknown) {
          call.filters.push({ kind: 'eq', column, value });
          return chain;
        },
        in(column: string, value: unknown) {
          call.filters.push({ kind: 'in', column, value });
          return chain;
        },
        then(resolve: (v: { error: unknown }) => void) {
          resolve({ error: state.updateError });
        },
      };
      return chain;
    },
  };
}

const mockClient = {
  from: (table: string) => buildFromMock(table),
};

vi.mock('@repo/supabase/server', () => ({
  createClient: async () => mockClient,
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

// Import AFTER vi.mock.
import { updatePaymentFollowUp } from '../payment-followup-actions';

beforeEach(() => {
  resetState();
});

afterEach(() => {
  vi.clearAllMocks();
});

// Helper: pick the proposal_payment_schedule UPDATE
function findPpsUpdate(): UpdateCall {
  const u = state.updates.find((u) => u.table === 'proposal_payment_schedule');
  expect(u).toBeDefined();
  return u!;
}

// Helper: today's date in IST (matches what the action uses internally)
function todayIST(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

// ── Default follow_up_date ───────────────────────────────────────────────

describe('updatePaymentFollowUp — follow_up_date defaulting', () => {
  it('defaults follow_up_date to today (IST) when not provided', async () => {
    const result = await updatePaymentFollowUp('pps-1', {});

    expect(result.success).toBe(true);
    const u = findPpsUpdate();
    expect(u.patch.follow_up_date).toBe(todayIST());
  });

  it('uses the caller-provided followUpDate when given', async () => {
    const result = await updatePaymentFollowUp('pps-1', {
      followUpDate: '2026-07-15',
    });

    expect(result.success).toBe(true);
    expect(findPpsUpdate().patch.follow_up_date).toBe('2026-07-15');
  });
});

// ── Snooze / clear via expected_payment_date ─────────────────────────────

describe('updatePaymentFollowUp — expected_payment_date (snooze / clear)', () => {
  it('snooze: future expectedPaymentDate flows through to the patch', async () => {
    const future = '2026-09-01';

    const result = await updatePaymentFollowUp('pps-snooze', {
      expectedPaymentDate: future,
    });

    expect(result.success).toBe(true);
    const u = findPpsUpdate();
    expect(u.patch.expected_payment_date).toBe(future);
    expect(u.filters).toEqual(
      expect.arrayContaining([
        { kind: 'eq', column: 'id', value: 'pps-snooze' },
      ]),
    );
  });

  it('clear: expectedPaymentDate=null sets the column to null', async () => {
    const result = await updatePaymentFollowUp('pps-clear', {
      expectedPaymentDate: null,
    });

    expect(result.success).toBe(true);
    const u = findPpsUpdate();
    expect(u.patch.expected_payment_date).toBeNull();
  });

  it('omitting expectedPaymentDate does NOT write the column at all', async () => {
    // The action uses spread-with-condition so the key is absent when the
    // caller didn't pass it — letting Postgres leave the column unchanged.
    const result = await updatePaymentFollowUp('pps-x', {});

    expect(result.success).toBe(true);
    const u = findPpsUpdate();
    expect(Object.prototype.hasOwnProperty.call(u.patch, 'expected_payment_date'))
      .toBe(false);
  });
});

// ── Follow-up count increment (escalation signal) ───────────────────────

describe('updatePaymentFollowUp — follow_up_count atomic increment', () => {
  it('increments follow_up_count by 1 from the fetched current value', async () => {
    state.currentRow = { follow_up_count: 4 };

    const result = await updatePaymentFollowUp('pps-1', {});

    expect(result.success).toBe(true);
    expect(findPpsUpdate().patch.follow_up_count).toBe(5);
  });

  it('treats null follow_up_count as 0 (first follow-up)', async () => {
    state.currentRow = { follow_up_count: null };

    const result = await updatePaymentFollowUp('pps-1', {});

    expect(result.success).toBe(true);
    expect(findPpsUpdate().patch.follow_up_count).toBe(1);
  });
});

// ── Note pass-through ────────────────────────────────────────────────────

describe('updatePaymentFollowUp — note', () => {
  it('writes follow_up_note when provided', async () => {
    const result = await updatePaymentFollowUp('pps-1', {
      note: 'Customer promised by Friday',
    });

    expect(result.success).toBe(true);
    expect(findPpsUpdate().patch.follow_up_note).toBe('Customer promised by Friday');
  });

  it('writes null follow_up_note when explicitly set to null (clear note)', async () => {
    const result = await updatePaymentFollowUp('pps-1', { note: null });

    expect(result.success).toBe(true);
    expect(findPpsUpdate().patch.follow_up_note).toBeNull();
  });
});

// ── Error paths ──────────────────────────────────────────────────────────

describe('updatePaymentFollowUp — error surfacing', () => {
  it('returns err with code when the pre-fetch errors', async () => {
    state.fetchError = { code: '42501', message: 'permission denied' };

    const result = await updatePaymentFollowUp('pps-1', {});

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/permission denied/);
      expect(result.code).toBe('42501');
    }
    expect(state.updates).toHaveLength(0);
  });

  it('returns err("Payment schedule row not found") when the row is missing', async () => {
    state.currentRow = null;

    const result = await updatePaymentFollowUp('pps-missing', {});

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/not found/i);
    expect(state.updates).toHaveLength(0);
  });

  it('returns err with code when the UPDATE fails', async () => {
    state.updateError = { code: '23514', message: 'check constraint failed' };

    const result = await updatePaymentFollowUp('pps-1', {
      expectedPaymentDate: '2026-09-01',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/check constraint/);
      expect(result.code).toBe('23514');
    }
  });
});
