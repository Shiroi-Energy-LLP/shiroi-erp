/**
 * Vitest unit tests for proposal-share-actions.ts acceptProposalFromPortal
 * (CRITICAL #4 from the 2026-05-30 test-coverage review).
 *
 * Covers token validation (length, existence, expiry) and the CAS-style
 * status guard that prevents overwriting a proposal already in 'accepted',
 * 'negotiating', 'rejected', etc.
 *
 * Mocks @repo/supabase/admin and ./n8n/emit. The action's dynamic import
 * of './n8n/emit' is satisfied by the vi.mock factory below.
 *
 * Run with: pnpm --filter @repo/erp vitest run src/lib/__tests__/proposal-share-actions.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mock state ───────────────────────────────────────────────────────────

interface UpdateCall {
  table: string;
  patch: Record<string, unknown>;
  filters: Array<{ kind: 'eq' | 'in'; column: string; value: unknown }>;
  // For the CAS check we need to know whether the row would have been
  // matched (id + status filter). The test rigs that via state.affectedRows.
}

interface MockState {
  // proposal_share_tokens row keyed by token (`null` for unknown token)
  shareRow: {
    proposal_id: string;
    expires_at: string;
  } | null;
  // Error returned from the share lookup (instead of the row)
  shareLookupError: { code: string; message: string } | null;
  // Error returned from the proposals UPDATE
  updateError: { code: string; message: string } | null;
  // Observed UPDATE calls
  updates: UpdateCall[];
  // Observed emitErpEvent calls
  emits: Array<{ event: string; payload: Record<string, unknown> }>;
}

const state: MockState = {
  shareRow: null,
  shareLookupError: null,
  updateError: null,
  updates: [],
  emits: [],
};

function resetState() {
  // Default: valid token, expires far in the future
  state.shareRow = {
    proposal_id: 'proposal-1',
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  };
  state.shareLookupError = null;
  state.updateError = null;
  state.updates = [];
  state.emits = [];
}

function buildFromMock(table: string) {
  return {
    select: (_cols: string) => {
      const chain = {
        eq: () => chain,
        maybeSingle: async () => {
          if (table === 'proposal_share_tokens') {
            return {
              data: state.shareRow,
              error: state.shareLookupError,
            };
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
          // The CAS predicate (status IN [...]) is enforced by Postgres on
          // the real path — here we just report success unless the test
          // wired in an explicit updateError. The "silent no-op" case
          // (proposal already accepted) shows up as updates.length === 1
          // with the right CAS filter present; the action returns ok(null)
          // either way, which is exactly the desired behaviour.
          resolve({ error: state.updateError });
        },
      };
      return chain;
    },
  };
}

const mockAdmin = {
  from: (table: string) => buildFromMock(table),
};

vi.mock('@repo/supabase/admin', () => ({
  createAdminClient: () => mockAdmin,
}));

// The action dynamically imports './n8n/emit'. Stub it so we can assert
// (a) the event was attempted, (b) failures in the bus don't blow up the
// happy path.
vi.mock('../n8n/emit', () => ({
  emitErpEvent: vi.fn(async (event: string, payload: Record<string, unknown>) => {
    state.emits.push({ event, payload });
  }),
}));

// Import AFTER vi.mock — see referral-actions.test.ts comment.
import { acceptProposalFromPortal } from '../proposal-share-actions';

const validToken = 'a'.repeat(64); // 32-byte hex token

beforeEach(() => {
  resetState();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ── Validation ───────────────────────────────────────────────────────────

describe('acceptProposalFromPortal — token validation', () => {
  it('returns err("Invalid token") when token is shorter than 32 chars', async () => {
    const result = await acceptProposalFromPortal('short-token');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe('Invalid token');
    // No DB calls
    expect(state.updates).toHaveLength(0);
    expect(state.emits).toHaveLength(0);
  });

  it('returns err("Invalid token") when token is an empty string', async () => {
    const result = await acceptProposalFromPortal('');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe('Invalid token');
  });

  it('returns err("Link not found") when token does not exist', async () => {
    state.shareRow = null;

    const result = await acceptProposalFromPortal(validToken);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe('Link not found');
    expect(state.updates).toHaveLength(0);
    expect(state.emits).toHaveLength(0);
  });

  it('returns err("Link has expired") when expires_at is in the past', async () => {
    state.shareRow = {
      proposal_id: 'proposal-1',
      // Yesterday
      expires_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    };

    const result = await acceptProposalFromPortal(validToken);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe('Link has expired');
    expect(state.updates).toHaveLength(0);
    expect(state.emits).toHaveLength(0);
  });

  it('propagates DB errors from the share-token lookup', async () => {
    state.shareLookupError = { code: '42P01', message: 'relation not found' };

    const result = await acceptProposalFromPortal(validToken);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/relation not found/);
      expect(result.code).toBe('42P01');
    }
  });
});

// ── Happy + idempotency ──────────────────────────────────────────────────

describe('acceptProposalFromPortal — accept flow', () => {
  it('valid token + proposal in "sent" → updates status to accepted', async () => {
    state.shareRow = {
      proposal_id: 'proposal-1',
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    };

    const result = await acceptProposalFromPortal(validToken);

    expect(result.success).toBe(true);

    // Exactly one UPDATE on proposals
    const update = state.updates.find((u) => u.table === 'proposals');
    expect(update).toBeDefined();
    expect(update!.patch).toEqual({ status: 'accepted' });

    // CAS guard present: id + status IN (sent, viewed, draft)
    expect(update!.filters).toEqual(
      expect.arrayContaining([
        { kind: 'eq', column: 'id', value: 'proposal-1' },
        {
          kind: 'in',
          column: 'status',
          value: ['sent', 'viewed', 'draft'],
        },
      ]),
    );

    // proposal.accepted_by_customer event emitted
    expect(state.emits).toHaveLength(1);
    expect(state.emits[0]!.event).toBe('proposal.accepted_by_customer');
    expect(state.emits[0]!.payload.proposal_id).toBe('proposal-1');
    expect(state.emits[0]!.payload.token).toBe(validToken);
    expect(typeof state.emits[0]!.payload.accepted_at).toBe('string');
  });

  it('valid token + proposal already "accepted" → silent ok (no error to customer)', async () => {
    // The action does NOT pre-fetch the proposal status — it just issues
    // the CAS UPDATE. Postgres returns 0 affected rows because the
    // proposal is no longer in (sent, viewed, draft). The supabase-js
    // client treats 0-rows as success (no error), so the action returns
    // ok(null) and the customer sees a friendly success page rather than
    // a confusing "already accepted" toast.
    state.shareRow = {
      proposal_id: 'proposal-1',
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    };
    // Simulate "no rows affected" → the supabase client returns
    // { error: null } with the same chain we already use, which is
    // what we want.
    state.updateError = null;

    const result = await acceptProposalFromPortal(validToken);
    expect(result.success).toBe(true);

    // The UPDATE was still issued (Postgres decides whether to flip).
    expect(state.updates).toHaveLength(1);
    // And the CAS filter is the one thing that protects the row.
    const update = state.updates[0]!;
    expect(
      update.filters.find((f) => f.kind === 'in' && f.column === 'status'),
    ).toEqual({
      kind: 'in',
      column: 'status',
      value: ['sent', 'viewed', 'draft'],
    });
  });

  it('valid token + proposal in "negotiating" → CAS filter prevents overwrite', async () => {
    // Same shape as "already accepted" — the action cannot distinguish
    // (it never reads proposal.status). The CAS guard in the WHERE clause
    // is the only thing that keeps a stale share link from regressing
    // a negotiating proposal back to accepted.
    state.shareRow = {
      proposal_id: 'proposal-7',
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    };

    const result = await acceptProposalFromPortal(validToken);
    expect(result.success).toBe(true);

    // The CAS filter MUST be present. If a future refactor drops the
    // `.in('status', […])` call, this assertion fails loudly.
    const update = state.updates[0]!;
    const inFilter = update.filters.find(
      (f) => f.kind === 'in' && f.column === 'status',
    );
    expect(inFilter).toBeDefined();
    expect(inFilter!.value).toEqual(['sent', 'viewed', 'draft']);
    // 'negotiating' is deliberately NOT in the list.
    expect(inFilter!.value).not.toContain('negotiating');
    expect(inFilter!.value).not.toContain('accepted');
    expect(inFilter!.value).not.toContain('rejected');
  });

  it('propagates DB errors from the proposals UPDATE', async () => {
    state.shareRow = {
      proposal_id: 'proposal-1',
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    };
    state.updateError = { code: '23514', message: 'check constraint failed' };

    const result = await acceptProposalFromPortal(validToken);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/check constraint/);
      expect(result.code).toBe('23514');
    }
    // No event emitted when the update fails.
    expect(state.emits).toHaveLength(0);
  });
});
