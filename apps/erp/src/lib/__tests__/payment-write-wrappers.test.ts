/**
 * Regression guard for the 2026-06-19 customer-payment de-duplication
 * (redundancy sweep §5 / perf-audit §4.19). recordPayment + recordProjectPayment
 * were byte-identical copies whose ONLY behavioural difference was the n8n emit:
 * recordPayment fires `customer_payment.received` (salesperson commission tracking
 * + customer ping); recordProjectPayment did NOT. The merge collapses both into
 * recordCustomerPayment(input, { notify }) — these tests lock that the emit still
 * fires for the /payments flow and is still suppressed for the project-detail flow.
 *
 * Run: pnpm --filter @repo/erp exec vitest run src/lib/__tests__/payment-write-wrappers.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface InsertCall { table: string; row: Record<string, unknown>; }
interface UpdateCall { table: string; payload: Record<string, unknown>; }

interface MockState {
  user: { id: string } | null;
  employee: { id: string } | null;
  insertedPaymentId: string | null;
  insertError: { code: string; message: string } | null;
  invoice: { amount_paid: number; total_amount: number } | null;
  enrichedProject: Record<string, unknown> | null;
  inserts: InsertCall[];
  updates: UpdateCall[];
}

const state: MockState = {
  user: { id: 'user-1' },
  employee: { id: 'emp-1' },
  insertedPaymentId: 'pay-1',
  insertError: null,
  invoice: { amount_paid: 0, total_amount: 1000 },
  enrichedProject: null,
  inserts: [],
  updates: [],
};

function resetState() {
  state.user = { id: 'user-1' };
  state.employee = { id: 'emp-1' };
  state.insertedPaymentId = 'pay-1';
  state.insertError = null;
  state.invoice = { amount_paid: 0, total_amount: 1000 };
  // Present so emitCustomerPaymentReceived's enrichment resolves and the emit fires.
  state.enrichedProject = {
    project_number: 'SE-26-001',
    customer_name: 'Acme Industries',
    customer_phone: '+919000000001',
    lead_id: 'lead-1',
  };
  state.inserts = [];
  state.updates = [];
}

function selectResult(table: string) {
  if (table === 'employees') {
    return {
      data: state.employee
        ? { id: state.employee.id, full_name: 'Sales Person', whatsapp_number: '+919000000002' }
        : null,
      error: null,
    };
  }
  if (table === 'invoices') return { data: state.invoice, error: null };
  if (table === 'customer_payments') {
    return {
      data: state.enrichedProject
        ? {
            id: state.insertedPaymentId,
            receipt_number: 'SHIROI/REC/2026/0001',
            amount: 1000,
            payment_date: '2026-06-19',
            payment_method: 'upi',
            is_advance: false,
            invoice: null,
            project: state.enrichedProject,
          }
        : null,
      error: null,
    };
  }
  if (table === 'leads') return { data: { assigned_to: 'emp-1' }, error: null };
  return { data: null, error: null };
}

function buildFromMock(table: string) {
  return {
    select: (_cols: string) => {
      const chain: Record<string, unknown> = {
        eq: () => chain,
        order: () => chain,
        limit: () => chain,
        single: async () => selectResult(table),
        maybeSingle: async () => selectResult(table),
      };
      return chain;
    },
    insert: (row: Record<string, unknown>) => {
      state.inserts.push({ table, row });
      return {
        select: () => ({
          single: async () =>
            state.insertError
              ? { data: null, error: state.insertError }
              : { data: { id: state.insertedPaymentId }, error: null },
        }),
      };
    },
    update: (payload: Record<string, unknown>) => {
      state.updates.push({ table, payload });
      return { eq: async () => ({ data: null, error: null }) };
    },
  };
}

const { emitSpy } = vi.hoisted(() => ({ emitSpy: vi.fn(async () => {}) }));

const mockClient = {
  auth: { getUser: async () => ({ data: { user: state.user }, error: null }) },
  from: (table: string) => buildFromMock(table),
  rpc: async (_fn: string, _args: unknown) => ({ data: 'SHIROI/REC/2026/0001', error: null }),
};

vi.mock('@repo/supabase/server', () => ({ createClient: async () => mockClient }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/n8n/emit', () => ({ emitErpEvent: emitSpy }));

// Import AFTER vi.mock.
import { recordPayment, recordProjectPayment, recordCustomerPayment } from '../finance-actions';

beforeEach(() => {
  resetState();
  emitSpy.mockClear();
});
afterEach(() => {
  vi.clearAllMocks();
});

function lastPaymentInsert(): InsertCall {
  const i = [...state.inserts].reverse().find((x) => x.table === 'customer_payments');
  expect(i).toBeDefined();
  return i!;
}

describe('payment write wrappers — notify divergence preserved', () => {
  it('recordPayment inserts a customer_payments row and emits the n8n event (notify: true)', async () => {
    const res = await recordPayment({
      projectId: 'proj-1',
      amount: 1000,
      paymentDate: '2026-06-19',
      paymentMethod: 'upi',
    });
    expect(res.success).toBe(true);
    expect(lastPaymentInsert().row.project_id).toBe('proj-1');
    expect(lastPaymentInsert().row.recorded_by).toBe('emp-1');
    expect(lastPaymentInsert().row.erp_recorded).toBe(true);
    // The emit is fire-and-forget — wait for it to land.
    await vi.waitFor(() =>
      expect(emitSpy).toHaveBeenCalledWith('customer_payment.received', expect.anything()),
    );
  });

  it('recordProjectPayment inserts but does NOT emit the n8n event (notify: false)', async () => {
    const res = await recordProjectPayment({
      projectId: 'proj-1',
      invoiceId: 'inv-1',
      amount: 500,
      paymentDate: '2026-06-19',
      paymentMethod: 'bank_transfer',
    });
    expect(res.success).toBe(true);
    expect(lastPaymentInsert().row.project_id).toBe('proj-1');
    // Give any scheduled microtask a chance to fire; it must not.
    await new Promise((r) => setTimeout(r, 25));
    expect(emitSpy).not.toHaveBeenCalled();
  });

  it('updates the linked invoice balance + status when invoiceId is present', async () => {
    state.invoice = { amount_paid: 0, total_amount: 1000 };
    await recordCustomerPayment(
      { projectId: 'proj-1', invoiceId: 'inv-1', amount: 1000, paymentDate: '2026-06-19', paymentMethod: 'upi' },
      { notify: false },
    );
    const u = [...state.updates].reverse().find((x) => x.table === 'invoices');
    expect(u).toBeDefined();
    expect(u!.payload.amount_paid).toBe(1000);
    expect(u!.payload.amount_outstanding).toBe(0);
    expect(u!.payload.status).toBe('paid');
  });

  it('recordCustomerPayment with notify:false does not emit', async () => {
    await recordCustomerPayment(
      { projectId: 'proj-1', amount: 250, paymentDate: '2026-06-19', paymentMethod: 'cash' },
      { notify: false },
    );
    await new Promise((r) => setTimeout(r, 25));
    expect(emitSpy).not.toHaveBeenCalled();
  });

  it('returns an error when the caller has no employee record', async () => {
    state.employee = null;
    const res = await recordProjectPayment({
      projectId: 'proj-1',
      amount: 100,
      paymentDate: '2026-06-19',
      paymentMethod: 'cash',
    });
    expect(res.success).toBe(false);
  });
});
