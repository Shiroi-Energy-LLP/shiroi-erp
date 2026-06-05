/**
 * Vitest unit tests for orphan-triage-actions.ts (CRITICAL T4 from the
 * 2026-06-05 test-coverage push; migs 096-101).
 *
 * Covers the 3 SQL-helper-backed actions + the per-payment direct paths:
 *   - assignOrphanInvoice    → assign_orphan_invoice RPC + audit (RPC writes its own audit)
 *   - assignOrphanPayment    → direct UPDATE + audit INSERT
 *   - excludePayment         → direct UPDATE + audit INSERT (excluded_from_cash=true)
 *   - reassignInvoice        → reassign_orphan_invoice RPC
 *   - excludeInvoice         → exclude_orphan_invoice RPC
 *   - undoExclude (invoice)  → flips excluded_from_cash back + cascades
 *
 * Each successful action MUST either invoke an SQL helper that writes the
 * audit, OR write a zoho_attribution_audit row itself.
 *
 * Mocks @repo/supabase/server with a chainable mock that records updates,
 * inserts, and rpc() calls.
 *
 * Run with: pnpm --filter @repo/erp vitest run src/lib/__tests__/orphan-triage-actions.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mock state ───────────────────────────────────────────────────────────

interface UpdateCall {
  table: string;
  patch: Record<string, unknown>;
  filters: Array<{ kind: 'eq' | 'in'; column: string; value: unknown }>;
}

interface InsertCall {
  table: string;
  row: Record<string, unknown>;
}

interface RpcCall {
  name: string;
  args: Record<string, unknown>;
}

interface MockState {
  user: { id: string } | null;
  profile: { role: string } | null;
  employee: { id: string } | null;
  // Payment lookup row used by assign/exclude/defer paths
  paymentRow: {
    id: string;
    source: string;
    attribution_status: string;
  } | null;
  // Invoice lookup row used by deferInvoice
  invoiceRow: {
    id: string;
    source: string;
    attribution_status: string;
  } | null;
  // Result returned from supabase.rpc()
  rpcResult: { data: unknown; error: { code: string; message: string } | null };
  updateError: { code: string; message: string } | null;
  insertError: { code: string; message: string } | null;
  updates: UpdateCall[];
  inserts: InsertCall[];
  rpcs: RpcCall[];
}

const state: MockState = {
  user: null,
  profile: null,
  employee: null,
  paymentRow: null,
  invoiceRow: null,
  rpcResult: { data: null, error: null },
  updateError: null,
  insertError: null,
  updates: [],
  inserts: [],
  rpcs: [],
};

function resetState() {
  state.user = { id: 'user-1' };
  state.profile = { role: 'founder' };
  state.employee = { id: 'emp-vivek' };
  state.paymentRow = {
    id: 'pay-1',
    source: 'zoho_import',
    attribution_status: 'pending',
  };
  state.invoiceRow = {
    id: 'inv-1',
    source: 'zoho_import',
    attribution_status: 'pending',
  };
  state.rpcResult = {
    data: [{ success: true, code: null, cascaded_payment_count: 0 }],
    error: null,
  };
  state.updateError = null;
  state.insertError = null;
  state.updates = [];
  state.inserts = [];
  state.rpcs = [];
}

function buildFromMock(table: string) {
  return {
    select: (_cols: string) => {
      const chain = {
        eq: () => chain,
        single: async () => {
          if (table === 'profiles') return { data: state.profile, error: null };
          if (table === 'employees') return { data: state.employee, error: null };
          if (table === 'customer_payments') {
            return { data: state.paymentRow, error: null };
          }
          if (table === 'invoices') {
            return { data: state.invoiceRow, error: null };
          }
          return { data: null, error: null };
        },
        maybeSingle: async () => {
          if (table === 'profiles') return { data: state.profile, error: null };
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
    insert: (row: Record<string, unknown>) => {
      state.inserts.push({ table, row });
      // The insert is awaited directly in the action.
      return Promise.resolve({ error: state.insertError });
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
    return state.rpcResult;
  },
};

vi.mock('@repo/supabase/server', () => ({
  createClient: async () => mockClient,
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

// Import AFTER vi.mock.
import {
  assignOrphanInvoice,
  assignOrphanPayment,
  excludeInvoice,
  excludePayment,
  reassignInvoice,
  undoExclude,
} from '../orphan-triage-actions';

beforeEach(() => {
  resetState();
});

afterEach(() => {
  vi.clearAllMocks();
});

// Helper: pick the zoho_attribution_audit row from observed inserts
function findAuditRow(): Record<string, unknown> | undefined {
  return state.inserts.find((i) => i.table === 'zoho_attribution_audit')?.row;
}

// ── Auth gate ────────────────────────────────────────────────────────────

describe('orphan-triage actions — auth', () => {
  it('rejects callers with a non-triage role (e.g. sales_engineer)', async () => {
    state.profile = { role: 'sales_engineer' };

    const result = await assignOrphanInvoice('inv-1', 'project-1', null);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('forbidden');
      expect(result.error).toMatch(/triage/i);
    }
    expect(state.rpcs).toHaveLength(0);
    expect(state.inserts).toHaveLength(0);
  });

  it('allows founder, finance, marketing_manager, project_manager', async () => {
    for (const role of ['founder', 'finance', 'marketing_manager', 'project_manager']) {
      resetState();
      state.profile = { role };

      const result = await assignOrphanInvoice('inv-1', 'project-1', null);
      expect(result.success).toBe(true);
    }
  });
});

// ── Assign ──

describe('assignOrphanInvoice', () => {
  it('invokes assign_orphan_invoice RPC with the right args (RPC writes its own audit)', async () => {
    state.rpcResult = {
      data: [{ success: true, code: null, cascaded_payment_count: 3 }],
      error: null,
    };

    const result = await assignOrphanInvoice('inv-42', 'project-7', 'Identified via Zoho ref');

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.cascadedPaymentCount).toBe(3);
    }

    const rpc = state.rpcs.find((r) => r.name === 'assign_orphan_invoice');
    expect(rpc).toBeDefined();
    expect(rpc!.args).toEqual({
      p_invoice_id: 'inv-42',
      p_project_id: 'project-7',
      p_made_by: 'emp-vivek',
      p_notes: 'Identified via Zoho ref',
    });
  });

  it('surfaces precondition failures from the RPC row.code', async () => {
    state.rpcResult = {
      data: [{ success: false, code: 'already_triaged', cascaded_payment_count: 0 }],
      error: null,
    };

    const result = await assignOrphanInvoice('inv-1', 'project-1', null);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('already_triaged');
      expect(result.error).toMatch(/already_triaged/);
    }
  });
});

describe('assignOrphanPayment', () => {
  it('updates project_id + attribution_status=assigned, then writes audit row', async () => {
    const result = await assignOrphanPayment('pay-1', 'project-9', 'Customer confirmed');

    expect(result.success).toBe(true);

    // (1) Direct UPDATE on customer_payments
    const update = state.updates.find((u) => u.table === 'customer_payments');
    expect(update).toBeDefined();
    expect(update!.patch).toEqual({
      project_id: 'project-9',
      attribution_status: 'assigned',
    });
    expect(update!.filters).toEqual(
      expect.arrayContaining([
        { kind: 'eq', column: 'id', value: 'pay-1' },
      ]),
    );

    // (2) Audit row inserted
    const audit = findAuditRow();
    expect(audit).toBeDefined();
    expect(audit).toMatchObject({
      entity_type: 'payment',
      entity_id: 'pay-1',
      to_project_id: 'project-9',
      decision: 'assign',
      made_by: 'emp-vivek',
      notes: 'Customer confirmed',
    });
  });

  it('rejects non-zoho_import payments', async () => {
    state.paymentRow = {
      id: 'pay-1',
      source: 'erp_recorded',
      attribution_status: 'pending',
    };

    const result = await assignOrphanPayment('pay-1', 'project-9', null);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe('not_zoho_import');
    expect(state.updates).toHaveLength(0);
  });

  it('rejects already-triaged payments', async () => {
    state.paymentRow = {
      id: 'pay-1',
      source: 'zoho_import',
      attribution_status: 'assigned',
    };

    const result = await assignOrphanPayment('pay-1', 'project-9', null);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe('already_triaged');
  });
});

// ── Reassign ──

describe('reassignInvoice', () => {
  it('invokes reassign_orphan_invoice RPC and propagates cascaded count', async () => {
    state.rpcResult = {
      data: [{ success: true, code: null, cascaded_payment_count: 2 }],
      error: null,
    };

    const result = await reassignInvoice('inv-1', 'project-new', 'Wrong customer first time');

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.cascadedPaymentCount).toBe(2);

    const rpc = state.rpcs.find((r) => r.name === 'reassign_orphan_invoice');
    expect(rpc).toBeDefined();
    expect(rpc!.args).toEqual({
      p_invoice_id: 'inv-1',
      p_new_project_id: 'project-new',
      p_made_by: 'emp-vivek',
      p_notes: 'Wrong customer first time',
    });
  });
});

// ── Exclude ──

describe('excludeInvoice', () => {
  it('requires notes (notes_required code)', async () => {
    const result = await excludeInvoice('inv-1', '   ');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe('notes_required');
    expect(state.rpcs).toHaveLength(0);
  });

  it('invokes exclude_orphan_invoice RPC with the notes', async () => {
    state.rpcResult = {
      data: [{ success: true, code: null, cascaded_payment_count: 1 }],
      error: null,
    };

    const result = await excludeInvoice('inv-1', 'Cancelled by customer, no work done');

    expect(result.success).toBe(true);
    const rpc = state.rpcs.find((r) => r.name === 'exclude_orphan_invoice');
    expect(rpc).toBeDefined();
    expect(rpc!.args.p_notes).toBe('Cancelled by customer, no work done');
  });
});

describe('excludePayment', () => {
  it('sets excluded_from_cash=true + attribution_status=excluded + writes audit', async () => {
    const result = await excludePayment('pay-1', 'Refund, not a real payment');

    expect(result.success).toBe(true);

    const update = state.updates.find((u) => u.table === 'customer_payments');
    expect(update).toBeDefined();
    expect(update!.patch).toEqual({
      excluded_from_cash: true,
      attribution_status: 'excluded',
    });

    const audit = findAuditRow();
    expect(audit).toBeDefined();
    expect(audit).toMatchObject({
      entity_type: 'payment',
      entity_id: 'pay-1',
      decision: 'exclude',
      made_by: 'emp-vivek',
      notes: 'Refund, not a real payment',
    });
  });

  it('refuses to exclude an already-excluded payment', async () => {
    state.paymentRow = {
      id: 'pay-1',
      source: 'zoho_import',
      attribution_status: 'excluded',
    };

    const result = await excludePayment('pay-1', 'note');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe('already_excluded');
  });
});

// ── Undo (cascades to linked payments) ──

describe('undoExclude (invoice path)', () => {
  it('flips excluded_from_cash on the invoice AND cascades to linked payments', async () => {
    const result = await undoExclude('invoice', 'inv-1');

    expect(result.success).toBe(true);

    // (1) Invoice UPDATE
    const invUpdate = state.updates.find((u) => u.table === 'invoices');
    expect(invUpdate).toBeDefined();
    expect(invUpdate!.patch).toEqual({
      excluded_from_cash: false,
      attribution_status: 'pending',
    });

    // (2) Audit row
    const audit = findAuditRow();
    expect(audit).toMatchObject({
      entity_type: 'invoice',
      entity_id: 'inv-1',
      decision: 'undo_exclude',
      made_by: 'emp-vivek',
    });

    // (3) Cascade UPDATE on customer_payments (matches by invoice_id AND
    //     excluded_from_cash=true so only previously-cascaded payments flip back)
    const cascadeUpdate = state.updates.find(
      (u) =>
        u.table === 'customer_payments' &&
        u.filters.some((f) => f.column === 'invoice_id' && f.value === 'inv-1'),
    );
    expect(cascadeUpdate).toBeDefined();
    expect(cascadeUpdate!.filters).toEqual(
      expect.arrayContaining([
        { kind: 'eq', column: 'invoice_id', value: 'inv-1' },
        { kind: 'eq', column: 'excluded_from_cash', value: true },
      ]),
    );
  });
});
