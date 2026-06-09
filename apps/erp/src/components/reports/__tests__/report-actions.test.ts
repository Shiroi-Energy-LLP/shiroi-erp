/**
 * Vitest tests for the daily-site-report write actions:
 *   - submitReportAction      (components/reports/report-actions.ts)
 *   - submitCorrectionAction  (components/reports/correction-actions.ts)
 *
 * Regression guard for the 2026-06-09 "Manivel can't add daily reports" bug.
 * The report pages passed the caller's profiles/auth UID (getUserProfile().id)
 * into columns that are FKs to employees(id):
 *   - daily_site_reports.submitted_by
 *   - site_photos.uploaded_by
 *   - site_report_corrections.requested_by
 * Because employees.id != profiles.id, every insert died on a foreign-key
 * violation. The actions must resolve the *employee* id from the authenticated
 * session and write THAT — never a profile/auth uid passed from the client.
 *
 * Run with:
 *   pnpm --filter @repo/erp vitest run src/components/reports/__tests__/report-actions.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mock state ───────────────────────────────────────────────────────────

interface InsertCall {
  table: string;
  row: Record<string, unknown>;
}

interface UpdateCall {
  table: string;
  patch: Record<string, unknown>;
  filters: Array<{ column: string; value: unknown }>;
}

interface MockState {
  user: { id: string } | null;
  employee: { id: string } | null;
  employeeError: { code: string; message: string } | null;
  inserts: InsertCall[];
  updates: UpdateCall[];
}

const state: MockState = {
  user: null,
  employee: null,
  employeeError: null,
  inserts: [],
  updates: [],
};

function resetState() {
  // Two deliberately-distinct ids: the auth/profiles uid vs the employee id.
  state.user = { id: 'profile-uid-abc' };
  state.employee = { id: 'employee-id-xyz' };
  state.employeeError = null;
  state.inserts = [];
  state.updates = [];
}

function buildFromMock(table: string) {
  return {
    select: (_cols: string) => {
      const chain = {
        eq: () => chain,
        maybeSingle: async () => {
          if (table === 'employees') return { data: state.employee, error: state.employeeError };
          return { data: null, error: null };
        },
        single: async () => ({ data: null, error: null }),
      };
      return chain;
    },
    insert: (row: Record<string, unknown>) => {
      state.inserts.push({ table, row });
      return {
        select: (_cols: string) => ({
          single: async () => ({
            data: { id: (row.id as string) ?? `${table}-1`, storage_path: row.storage_path ?? null },
            error: null,
          }),
        }),
      };
    },
    update: (patch: Record<string, unknown>) => {
      const call: UpdateCall = { table, patch, filters: [] };
      state.updates.push(call);
      const chain = {
        eq(column: string, value: unknown) {
          call.filters.push({ column, value });
          return chain;
        },
        then(resolve: (v: { error: unknown }) => void) {
          resolve({ error: null });
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
};

vi.mock('@repo/supabase/server', () => ({
  createClient: async () => mockClient,
}));

// Import AFTER vi.mock.
import { submitReportAction } from '@/components/reports/report-actions';
import { submitCorrectionAction } from '@/components/reports/correction-actions';

beforeEach(() => {
  resetState();
});

afterEach(() => {
  vi.clearAllMocks();
});

function baseReportInput() {
  return {
    projectId: 'proj-1',
    reportDate: '2026-06-09',
    panelsInstalledToday: 5,
    panelsInstalledCumulative: 5,
    workersCount: 3,
    supervisorsCount: 1,
    weather: 'clear',
    weatherDelay: false,
    weatherDelayHours: null,
    workDescription: 'Installed 5 panels',
    structureProgress: null,
    electricalProgress: null,
    materialsReceived: false,
    materialsSummary: null,
    issuesReported: false,
    issueSummary: null,
    pmVisited: false,
    otherVisitors: null,
    photos: [] as Array<{
      storagePath: string;
      fileName: string;
      caption: string;
      fileSizeBytes: number;
    }>,
  };
}

describe('submitReportAction — identity resolution', () => {
  it('writes submitted_by = resolved employee id, never the profiles/auth uid', async () => {
    const result = await submitReportAction(baseReportInput());

    expect(result.success).toBe(true);
    const insert = state.inserts.find((i) => i.table === 'daily_site_reports');
    expect(insert).toBeDefined();
    expect(insert!.row.submitted_by).toBe('employee-id-xyz');
    expect(insert!.row.submitted_by).not.toBe('profile-uid-abc');
  });

  it('writes uploaded_by = resolved employee id on linked photos', async () => {
    const result = await submitReportAction({
      ...baseReportInput(),
      photos: [
        {
          storagePath: 'projects/proj-1/whatsapp/1.jpg',
          fileName: '1.jpg',
          caption: '',
          fileSizeBytes: 1234,
        },
      ],
    });

    expect(result.success).toBe(true);
    const photo = state.inserts.find((i) => i.table === 'site_photos');
    expect(photo).toBeDefined();
    expect(photo!.row.uploaded_by).toBe('employee-id-xyz');
    expect(photo!.row.uploaded_by).not.toBe('profile-uid-abc');
  });

  it('fails cleanly (NO_EMPLOYEE) and writes nothing when the user has no employee record', async () => {
    state.employee = null;

    const result = await submitReportAction(baseReportInput());

    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe('NO_EMPLOYEE');
    expect(state.inserts.find((i) => i.table === 'daily_site_reports')).toBeUndefined();
  });
});

describe('submitCorrectionAction — identity resolution', () => {
  it('writes requested_by = resolved employee id, never the profiles/auth uid', async () => {
    const result = await submitCorrectionAction({
      originalReportId: 'report-1',
      projectId: 'proj-1',
      fieldCorrected: 'workers_count',
      originalValue: '3',
      correctedValue: '4',
      correctionReason: 'Miscounted at end of day',
    });

    expect(result.success).toBe(true);
    const insert = state.inserts.find((i) => i.table === 'site_report_corrections');
    expect(insert).toBeDefined();
    expect(insert!.row.requested_by).toBe('employee-id-xyz');
    expect(insert!.row.requested_by).not.toBe('profile-uid-abc');
  });

  it('fails cleanly (NO_EMPLOYEE) when the user has no employee record', async () => {
    state.employee = null;

    const result = await submitCorrectionAction({
      originalReportId: 'report-1',
      projectId: 'proj-1',
      fieldCorrected: 'workers_count',
      originalValue: '3',
      correctedValue: '4',
      correctionReason: 'Miscounted at end of day',
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe('NO_EMPLOYEE');
    expect(state.inserts.find((i) => i.table === 'site_report_corrections')).toBeUndefined();
  });
});
