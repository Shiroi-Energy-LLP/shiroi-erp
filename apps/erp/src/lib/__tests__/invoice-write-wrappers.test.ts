/**
 * Regression guard for the 2026-06-19 customer-invoice de-duplication
 * (redundancy sweep §5 / master-ref §4.19). createInvoice + raiseProjectInvoice
 * were byte-identical `invoices` writers (same generate_doc_number('INV'),
 * columns, status='draft', amount_outstanding=total, revalidations); the only
 * difference was the return shape (raiseProjectInvoice also returns invoiceNumber,
 * which the project-detail dialog renders). The merge collapses both into
 * createCustomerInvoice; these tests lock the insert + each wrapper's return shape.
 *
 * Run: pnpm --filter @repo/erp exec vitest run src/lib/__tests__/invoice-write-wrappers.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface InsertCall { table: string; row: Record<string, unknown>; }

interface MockState {
  user: { id: string } | null;
  employee: { id: string } | null;
  insertedInvoiceId: string | null;
  insertError: { code: string; message: string } | null;
  inserts: InsertCall[];
}

const state: MockState = {
  user: { id: 'user-1' },
  employee: { id: 'emp-1' },
  insertedInvoiceId: 'inv-1',
  insertError: null,
  inserts: [],
};

function resetState() {
  state.user = { id: 'user-1' };
  state.employee = { id: 'emp-1' };
  state.insertedInvoiceId = 'inv-1';
  state.insertError = null;
  state.inserts = [];
}

function buildFromMock(table: string) {
  return {
    select: (_cols: string) => {
      const chain: Record<string, unknown> = {
        eq: () => chain,
        single: async () => ({
          data: table === 'employees' ? (state.employee ? { id: state.employee.id } : null) : null,
          error: null,
        }),
        maybeSingle: async () => ({
          data: table === 'employees' ? (state.employee ? { id: state.employee.id } : null) : null,
          error: null,
        }),
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
              : { data: { id: state.insertedInvoiceId }, error: null },
        }),
      };
    },
  };
}

const mockClient = {
  auth: { getUser: async () => ({ data: { user: state.user }, error: null }) },
  from: (table: string) => buildFromMock(table),
  rpc: async (_fn: string, _args: unknown) => ({ data: 'SHIROI/INV/2026/0001', error: null }),
};

vi.mock('@repo/supabase/server', () => ({ createClient: async () => mockClient }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/n8n/emit', () => ({ emitErpEvent: vi.fn(async () => {}) }));

// Import AFTER vi.mock.
import { createInvoice, raiseProjectInvoice } from '../finance-actions';

beforeEach(() => resetState());
afterEach(() => vi.clearAllMocks());

const BASE = {
  projectId: 'proj-1',
  invoiceType: 'tax_invoice' as const,
  subtotalSupply: 100000,
  subtotalWorks: 20000,
  gstSupplyAmount: 13800,
  gstWorksAmount: 3600,
  totalAmount: 137400,
  invoiceDate: '2026-06-19',
  dueDate: '2026-07-19',
};

function lastInvoiceInsert(): InsertCall {
  const i = [...state.inserts].reverse().find((x) => x.table === 'invoices');
  expect(i).toBeDefined();
  return i!;
}

describe('invoice write wrappers — return shapes preserved', () => {
  it('createInvoice inserts a draft invoice and returns just the invoiceId', async () => {
    const res = await createInvoice(BASE);
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.invoiceId).toBe('inv-1');
      // createInvoice's contract is {invoiceId} only.
      expect('invoiceNumber' in res.data).toBe(false);
    }
    const row = lastInvoiceInsert().row;
    expect(row.status).toBe('draft');
    expect(row.amount_outstanding).toBe(137400);
    expect(row.invoice_number).toBe('SHIROI/INV/2026/0001');
    expect(row.raised_by).toBe('emp-1');
    expect(row.erp_created).toBe(true);
  });

  it('raiseProjectInvoice returns invoiceId AND invoiceNumber (project-detail dialog needs it)', async () => {
    const res = await raiseProjectInvoice(BASE);
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.invoiceId).toBe('inv-1');
      expect(res.data.invoiceNumber).toBe('SHIROI/INV/2026/0001');
    }
  });

  it('returns an error when the caller has no employee record', async () => {
    state.employee = null;
    const res = await createInvoice(BASE);
    expect(res.success).toBe(false);
  });
});
