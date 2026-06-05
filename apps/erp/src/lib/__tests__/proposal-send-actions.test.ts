/**
 * Vitest unit tests for proposal-send-actions.ts → sendProposalToCustomer
 * (CRITICAL T5 from the 2026-06-05 test-coverage push; shipped May 20).
 *
 * Covers:
 *   - Missing lead.email → clean error (no PDF refresh, no event)
 *   - PDF refresh failure (POST /api/proposals/:id/generate-pdf non-2xx)
 *   - sent_to_customer_at column always stamped on the proposals UPDATE
 *   - Status transition rules:
 *       * draft → sent  (allowed)
 *       * sent  → sent  (status NOT touched, only sent_to_customer_at)
 *       * accepted/rejected → status NOT touched
 *   - proposal.sent_to_customer event fires with the expected payload
 *
 * Mocks:
 *   - @repo/supabase/server   (server client — auth + profile + proposal read)
 *   - @repo/supabase/admin    (admin client — storage signing + proposals UPDATE)
 *   - @/lib/n8n/emit          (event bus — capture emits)
 *   - globalThis.fetch        (PDF generation endpoint)
 *
 * Run with: pnpm --filter @repo/erp vitest run src/lib/__tests__/proposal-send-actions.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mock state ───────────────────────────────────────────────────────────

interface UpdateCall {
  table: string;
  patch: Record<string, unknown>;
  filters: Array<{ kind: 'eq' | 'in'; column: string; value: unknown }>;
}

interface ProposalRow {
  id: string;
  proposal_number: string;
  status: string;
  current_pdf_storage_path: string | null;
  system_size_kwp: number;
  total_after_discount: number;
  lead_id: string;
  leads: {
    customer_name: string | null;
    email: string | null;
    phone: string | null;
    segment: string | null;
  } | null;
}

interface MockState {
  user: { id: string } | null;
  profile: { role: string; full_name: string | null } | null;
  proposal: ProposalRow | null;
  proposalError: { code: string; message: string } | null;
  // createSignedUrl returns
  signedUrlError: { message: string } | null;
  signedUrlValue: string | null;
  // proposals UPDATE result
  updateError: { code: string; message: string; message_only?: boolean } | null;
  // The fetched /generate-pdf response
  pdfFetchOk: boolean;
  pdfFetchBody: Record<string, unknown>;
  pdfFetchStatusText: string;
  updates: UpdateCall[];
  emits: Array<{ event: string; payload: Record<string, unknown> }>;
  fetchCalls: Array<{ url: string; init: { method?: string } | undefined }>;
}

const state: MockState = {
  user: null,
  profile: null,
  proposal: null,
  proposalError: null,
  signedUrlError: null,
  signedUrlValue: 'https://example.com/signed.pdf?token=xyz',
  updateError: null,
  pdfFetchOk: true,
  pdfFetchBody: { storagePath: 'proposal-files/prop-1/v1.pdf' },
  pdfFetchStatusText: 'OK',
  updates: [],
  emits: [],
  fetchCalls: [],
};

function defaultProposal(overrides: Partial<ProposalRow> = {}): ProposalRow {
  return {
    id: 'prop-1',
    proposal_number: 'SHIROI/PROP/2026/001',
    status: 'draft',
    current_pdf_storage_path: 'proposal-files/prop-1/v1.pdf',
    system_size_kwp: 5,
    total_after_discount: 350000,
    lead_id: 'lead-1',
    leads: {
      customer_name: 'Customer One',
      email: 'customer@example.com',
      phone: '9000000001',
      segment: 'residential',
    },
    ...overrides,
  };
}

function resetState() {
  state.user = { id: 'user-1' };
  state.profile = { role: 'founder', full_name: 'Vivek' };
  state.proposal = defaultProposal();
  state.proposalError = null;
  state.signedUrlError = null;
  state.signedUrlValue = 'https://example.com/signed.pdf?token=xyz';
  state.updateError = null;
  state.pdfFetchOk = true;
  state.pdfFetchBody = { storagePath: 'proposal-files/prop-1/v1.pdf' };
  state.pdfFetchStatusText = 'OK';
  state.updates = [];
  state.emits = [];
  state.fetchCalls = [];
}

// Build a single chain that handles select/eq/maybeSingle for both
// the server client (profiles, proposals) and the admin client (update).
function buildFromMock(table: string) {
  return {
    select: (_cols: string) => {
      const chain = {
        eq: () => chain,
        maybeSingle: async () => {
          if (table === 'profiles') return { data: state.profile, error: null };
          if (table === 'proposals') {
            return { data: state.proposal, error: state.proposalError };
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

const mockServerClient = {
  auth: {
    getUser: async () => ({ data: { user: state.user }, error: null }),
  },
  from: (table: string) => buildFromMock(table),
};

const mockAdminClient = {
  from: (table: string) => buildFromMock(table),
  storage: {
    from: (_bucket: string) => ({
      createSignedUrl: async (_path: string, _ttl: number) => {
        if (state.signedUrlError) {
          return { data: null, error: state.signedUrlError };
        }
        return { data: { signedUrl: state.signedUrlValue }, error: null };
      },
    }),
  },
};

vi.mock('@repo/supabase/server', () => ({
  createClient: async () => mockServerClient,
}));

vi.mock('@repo/supabase/admin', () => ({
  createAdminClient: () => mockAdminClient,
}));

vi.mock('../n8n/emit', () => ({
  emitErpEvent: vi.fn(async (event: string, payload: Record<string, unknown>) => {
    state.emits.push({ event, payload });
  }),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

// Stub global fetch — the action calls /api/proposals/:id/generate-pdf when
// current_pdf_storage_path is null.
const fetchSpy = vi.fn(async (url: string, init?: { method?: string }) => {
  state.fetchCalls.push({ url, init });
  return {
    ok: state.pdfFetchOk,
    statusText: state.pdfFetchStatusText,
    json: async () => state.pdfFetchBody,
  } as unknown as Response;
});
vi.stubGlobal('fetch', fetchSpy);

// Import AFTER vi.mock.
import { sendProposalToCustomer } from '../proposal-send-actions';

beforeEach(() => {
  resetState();
});

afterEach(() => {
  vi.clearAllMocks();
});

// Helper: pick the proposals UPDATE
function findProposalUpdate(): UpdateCall {
  const u = state.updates.find((u) => u.table === 'proposals');
  expect(u).toBeDefined();
  return u!;
}

// ── Validation / preconditions ───────────────────────────────────────────

describe('sendProposalToCustomer — validation', () => {
  it('returns err when proposalId is missing', async () => {
    const result = await sendProposalToCustomer('');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/proposalId/i);
    expect(state.emits).toHaveLength(0);
  });

  it('returns clean error when lead.email is missing', async () => {
    state.proposal = defaultProposal({
      leads: {
        customer_name: 'No-Email Customer',
        email: null,
        phone: '9000000000',
        segment: 'residential',
      },
    });

    const result = await sendProposalToCustomer('prop-1');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/email/i);
      expect(result.error).toContain('No-Email Customer');
    }
    // No event emitted, no UPDATE issued
    expect(state.emits).toHaveLength(0);
    expect(state.updates).toHaveLength(0);
  });

  it('rejects callers with disallowed role (e.g. finance)', async () => {
    state.profile = { role: 'finance', full_name: 'Finance Lead' };

    const result = await sendProposalToCustomer('prop-1');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/founder.*marketing_manager.*sales_engineer/i);
    }
  });
});

// ── PDF refresh failure ──────────────────────────────────────────────────

describe('sendProposalToCustomer — PDF refresh', () => {
  it('surfaces error when PDF generation endpoint returns non-2xx', async () => {
    // Force the action down the generate-pdf path
    state.proposal = defaultProposal({ current_pdf_storage_path: null });
    state.pdfFetchOk = false;
    state.pdfFetchStatusText = 'Internal Server Error';
    state.pdfFetchBody = { error: 'PVWatts API timeout' };

    const result = await sendProposalToCustomer('prop-1');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/PDF generation failed/);
      expect(result.error).toMatch(/PVWatts API timeout/);
    }
    expect(state.emits).toHaveLength(0);
    expect(state.updates).toHaveLength(0);
  });

  it('does NOT call generate-pdf when current_pdf_storage_path already exists', async () => {
    state.proposal = defaultProposal({
      current_pdf_storage_path: 'proposal-files/prop-1/v3.pdf',
    });

    const result = await sendProposalToCustomer('prop-1');

    expect(result.success).toBe(true);
    // Fetch was only ever invoked for /generate-pdf — and we skipped it.
    expect(state.fetchCalls).toHaveLength(0);
  });
});

// ── Status transition rules ──────────────────────────────────────────────

describe('sendProposalToCustomer — status transitions', () => {
  it('draft → sent (the only status flip)', async () => {
    state.proposal = defaultProposal({ status: 'draft' });

    const result = await sendProposalToCustomer('prop-1');

    expect(result.success).toBe(true);
    const u = findProposalUpdate();
    expect(u.patch.status).toBe('sent');
    expect(typeof u.patch.sent_to_customer_at).toBe('string');
  });

  it('sent → sent does NOT touch status (only stamps sent_to_customer_at)', async () => {
    state.proposal = defaultProposal({ status: 'sent' });

    const result = await sendProposalToCustomer('prop-1');

    expect(result.success).toBe(true);
    const u = findProposalUpdate();
    expect(Object.prototype.hasOwnProperty.call(u.patch, 'status')).toBe(false);
    expect(typeof u.patch.sent_to_customer_at).toBe('string');
  });

  it('rejected → sent does NOT touch status (only stamps sent_to_customer_at)', async () => {
    state.proposal = defaultProposal({ status: 'rejected' });

    const result = await sendProposalToCustomer('prop-1');

    expect(result.success).toBe(true);
    const u = findProposalUpdate();
    expect(Object.prototype.hasOwnProperty.call(u.patch, 'status')).toBe(false);
    expect(typeof u.patch.sent_to_customer_at).toBe('string');
  });
});

// ── Audit / event ────────────────────────────────────────────────────────

describe('sendProposalToCustomer — sent_to_customer_at + event emit', () => {
  it('stamps sent_to_customer_at as an ISO timestamp', async () => {
    const result = await sendProposalToCustomer('prop-1');

    expect(result.success).toBe(true);
    const u = findProposalUpdate();
    expect(u.patch.sent_to_customer_at).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/,
    );
  });

  it('fires proposal.sent_to_customer with expected payload', async () => {
    const result = await sendProposalToCustomer('prop-1');

    expect(result.success).toBe(true);
    expect(state.emits).toHaveLength(1);
    const emit = state.emits[0]!;
    expect(emit.event).toBe('proposal.sent_to_customer');

    expect(emit.payload).toMatchObject({
      proposal_id: 'prop-1',
      proposal_number: 'SHIROI/PROP/2026/001',
      customer_name: 'Customer One',
      customer_email: 'customer@example.com',
      customer_phone: '9000000001',
      segment: 'residential',
      system_size_kwp: 5,
      total_after_discount: 350000,
      pdf_signed_url: 'https://example.com/signed.pdf?token=xyz',
      from_email: 'prem@shiroienergy.com',
      cc_email: 'svivek.88@gmail.com',
      sent_by_name: 'Vivek',
      sent_by_role: 'founder',
    });
    expect(typeof emit.payload.sent_at).toBe('string');
  });

  it('surfaces signed-URL failure cleanly (no event emitted)', async () => {
    state.signedUrlError = { message: 'storage bucket not found' };

    const result = await sendProposalToCustomer('prop-1');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/Could not sign PDF URL/);
      expect(result.error).toMatch(/storage bucket not found/);
    }
    expect(state.emits).toHaveLength(0);
  });
});
