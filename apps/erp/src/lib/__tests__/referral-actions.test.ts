/**
 * Vitest unit tests for referral-actions.ts state machine (CRITICAL #1 from
 * the 2026-05-30 test-coverage review).
 *
 * Covers role gating, status transitions (pending → approved → paid;
 * pending → rejected; rejected blocks paid), and the
 * increment_partner_commission RPC call shape.
 *
 * Mocks @repo/supabase/server with a chainable query-builder that records
 * the calls, so assertions can verify "did the action UPDATE with the right
 * WHERE clause" without touching a real DB.
 *
 * Run with: pnpm --filter @repo/erp vitest run src/lib/__tests__/referral-actions.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mock state ───────────────────────────────────────────────────────────
// Module-level so the tests can rewire per-case responses before calling
// the action under test.

type SupabaseUser = { id: string } | null;

interface UpdateCall {
  table: string;
  patch: Record<string, unknown>;
  // .eq() / .in() filters collected in order
  filters: Array<{ kind: 'eq' | 'in'; column: string; value: unknown }>;
}

interface RpcCall {
  name: string;
  args: Record<string, unknown>;
}

interface MockState {
  // auth.getUser() result
  user: SupabaseUser;
  // profiles.select(...).eq(id).maybeSingle() result
  profile: { id: string; role: string } | null;
  // referral_payouts.select(...).eq(id).maybeSingle() result
  payout: {
    channel_partner_id: string;
    commission_amount: number;
    status: string;
  } | null;
  // .update(...).eq(...) result — { error: null } for success
  updateResult: { error: { code: string; message: string } | null };
  // rpc(...) result
  rpcResult: { error: { code: string; message: string } | null };
  // Observed calls (for assertions)
  updates: UpdateCall[];
  rpcs: RpcCall[];
}

const state: MockState = {
  user: null,
  profile: null,
  payout: null,
  updateResult: { error: null },
  rpcResult: { error: null },
  updates: [],
  rpcs: [],
};

function resetState() {
  state.user = { id: 'user-1' };
  state.profile = { id: 'user-1', role: 'founder' };
  state.payout = {
    channel_partner_id: 'partner-1',
    commission_amount: 12500,
    status: 'approved',
  };
  state.updateResult = { error: null };
  state.rpcResult = { error: null };
  state.updates = [];
  state.rpcs = [];
}

// Build a chainable mock for `from(table).select|update().eq()...maybeSingle()`.
// SELECT path returns either `state.profile` or `state.payout` based on the
// table — referral-actions only reads from those two tables.
function buildFromMock(table: string) {
  // For UPDATE we need to record the patch, then return a thenable that
  // collects subsequent .eq()/.in() filters and resolves to state.updateResult.
  return {
    select: (_cols: string) => {
      // SELECT then .eq(...).maybeSingle()
      const chain = {
        eq: () => chain,
        maybeSingle: async () => {
          if (table === 'profiles') return { data: state.profile, error: null };
          if (table === 'referral_payouts')
            return { data: state.payout, error: null };
          return { data: null, error: null };
        },
      };
      return chain;
    },
    update: (patch: Record<string, unknown>) => {
      const call: UpdateCall = { table, patch, filters: [] };
      state.updates.push(call);
      // The action awaits the result of the final .eq()/.in() — vitest
      // resolves via the .then() on the chainable.
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
          resolve(state.updateResult);
        },
      };
      return chain;
    },
  };
}

const mockClient = {
  auth: {
    getUser: async () => ({ data: { user: state.user }, error: null }),
  },
  from: (table: string) => buildFromMock(table),
  rpc: async (name: string, args: Record<string, unknown>) => {
    state.rpcs.push({ name, args });
    return { data: null, error: state.rpcResult.error };
  },
};

vi.mock('@repo/supabase/server', () => ({
  createClient: async () => mockClient,
}));

// next/cache is a server-only module — stub revalidatePath() out.
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

// Import AFTER vi.mock — vitest hoists the mocks but the import binding
// needs the mocks to be wired first.
import {
  approveReferralPayout,
  markReferralPaid,
  rejectReferralPayout,
} from '../referral-actions';

beforeEach(() => {
  resetState();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ── approveReferralPayout ────────────────────────────────────────────────

describe('approveReferralPayout', () => {
  it('flips status pending → approved when caller is founder', async () => {
    state.profile = { id: 'user-1', role: 'founder' };

    const result = await approveReferralPayout('payout-1');

    expect(result.success).toBe(true);
    expect(state.updates).toHaveLength(1);
    const update = state.updates[0]!;
    expect(update.table).toBe('referral_payouts');
    expect(update.patch.status).toBe('approved');
    expect(update.patch.approved_by).toBe('user-1');
    expect(typeof update.patch.approved_at).toBe('string');
    // CAS: must filter on id AND status='pending' so we don't overwrite
    // an already-approved/paid/rejected row.
    expect(update.filters).toEqual(
      expect.arrayContaining([
        { kind: 'eq', column: 'id', value: 'payout-1' },
        { kind: 'eq', column: 'status', value: 'pending' },
      ]),
    );
  });

  it('rejects non-founder callers (finance cannot approve)', async () => {
    state.profile = { id: 'user-1', role: 'finance' };

    const result = await approveReferralPayout('payout-1');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/founder/i);
    }
    // No UPDATE issued
    expect(state.updates).toHaveLength(0);
  });

  it('returns err when payoutId is missing', async () => {
    const result = await approveReferralPayout('');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/payoutId/i);
    expect(state.updates).toHaveLength(0);
  });
});

// ── markReferralPaid ─────────────────────────────────────────────────────

describe('markReferralPaid', () => {
  it('flips status approved → paid when caller is finance', async () => {
    state.profile = { id: 'user-1', role: 'finance' };
    state.payout = {
      channel_partner_id: 'partner-1',
      commission_amount: 12500,
      status: 'approved',
    };

    const result = await markReferralPaid('payout-1', 'NEFT/UTR-12345');

    expect(result.success).toBe(true);
    const update = state.updates.find(
      (u) => u.table === 'referral_payouts' && u.patch.status === 'paid',
    );
    expect(update).toBeDefined();
    expect(update!.patch.payment_reference).toBe('NEFT/UTR-12345');
    expect(typeof update!.patch.paid_at).toBe('string');
  });

  it('flips status approved → paid when caller is founder', async () => {
    state.profile = { id: 'user-1', role: 'founder' };
    state.payout = {
      channel_partner_id: 'partner-1',
      commission_amount: 7000,
      status: 'approved',
    };

    const result = await markReferralPaid('payout-1', 'CHQ-001');
    expect(result.success).toBe(true);
  });

  it('rejects callers who are neither finance nor founder', async () => {
    state.profile = { id: 'user-1', role: 'sales_engineer' };

    const result = await markReferralPaid('payout-1', 'NEFT/UTR-12345');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/finance|founder/i);
    }
    expect(state.updates).toHaveLength(0);
    expect(state.rpcs).toHaveLength(0);
  });

  it('rejects when payout was previously rejected (status !== approved)', async () => {
    state.profile = { id: 'user-1', role: 'finance' };
    state.payout = {
      channel_partner_id: 'partner-1',
      commission_amount: 5000,
      status: 'rejected',
    };

    const result = await markReferralPaid('payout-1', 'NEFT/UTR-12345');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/approved/i);
    }
    expect(state.updates).toHaveLength(0);
    expect(state.rpcs).toHaveLength(0);
  });

  it('rejects when payout is already paid', async () => {
    state.profile = { id: 'user-1', role: 'finance' };
    state.payout = {
      channel_partner_id: 'partner-1',
      commission_amount: 5000,
      status: 'paid',
    };

    const result = await markReferralPaid('payout-1', 'NEFT/UTR-12345');

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/already/i);
    expect(state.updates).toHaveLength(0);
    expect(state.rpcs).toHaveLength(0);
  });

  it('calls increment_partner_commission once with the exact commission_amount', async () => {
    state.profile = { id: 'user-1', role: 'finance' };
    state.payout = {
      channel_partner_id: 'partner-42',
      commission_amount: 12500,
      status: 'approved',
    };

    const result = await markReferralPaid('payout-1', 'NEFT/UTR-12345');
    expect(result.success).toBe(true);

    const incrementCalls = state.rpcs.filter(
      (r) => r.name === 'increment_partner_commission',
    );
    expect(incrementCalls).toHaveLength(1);
    expect(incrementCalls[0]!.args).toEqual({
      p_partner_id: 'partner-42',
      p_amount: 12500,
    });
  });

  it('rejects empty payment reference', async () => {
    state.profile = { id: 'user-1', role: 'finance' };

    const result = await markReferralPaid('payout-1', '   ');
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error).toMatch(/payment reference/i);
    expect(state.updates).toHaveLength(0);
    expect(state.rpcs).toHaveLength(0);
  });
});

// ── rejectReferralPayout ─────────────────────────────────────────────────

describe('rejectReferralPayout', () => {
  it('flips status pending → rejected when caller is founder', async () => {
    state.profile = { id: 'user-1', role: 'founder' };

    const result = await rejectReferralPayout('payout-1', 'duplicate referral');

    expect(result.success).toBe(true);
    const update = state.updates[0]!;
    expect(update.patch.status).toBe('rejected');
    expect(update.patch.notes).toBe('duplicate referral');
    // CAS: only flip if status is currently pending or approved.
    expect(
      update.filters.find((f) => f.kind === 'in' && f.column === 'status'),
    ).toEqual({ kind: 'in', column: 'status', value: ['pending', 'approved'] });
  });

  it('rejects non-founder callers', async () => {
    state.profile = { id: 'user-1', role: 'finance' };

    const result = await rejectReferralPayout('payout-1', 'reason');

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/founder/i);
    expect(state.updates).toHaveLength(0);
  });

  it('stores null for notes when reason is empty string', async () => {
    state.profile = { id: 'user-1', role: 'founder' };

    const result = await rejectReferralPayout('payout-1', '');
    expect(result.success).toBe(true);
    const update = state.updates[0]!;
    expect(update.patch.notes).toBeNull();
  });
});
