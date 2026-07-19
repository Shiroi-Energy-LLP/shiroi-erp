/**
 * Vitest unit tests for the task-write cluster collapse (2026-06-18 redundancy
 * sweep §3). Three specialised task-write actions are thin wrappers over the
 * universal pair in tasks-actions.ts:
 *
 *   - createQuickTask      (project-milestone-actions.ts) → createTask
 *   - createLeadTask       (leads-task-actions.ts)        → createTask
 *   - toggleTaskCompletion (project-milestone-actions.ts) → toggleTaskStatus
 *
 * The headline assertion is the regression for the dropped `completed_by`
 * write: the old toggleTaskCompletion set is_completed + completed_at but NOT
 * completed_by, so tasks closed from the Execution-tab dropdown never recorded
 * who closed them. Routing through toggleTaskStatus restores that write.
 *
 * Mocks @repo/supabase/server with one chainable query-builder shared by
 * createTask / toggleTaskStatus / getCurrentEmployeeId, recording every
 * tasks insert + update.
 *
 * Run with: pnpm --filter @repo/erp vitest run src/lib/__tests__/task-write-wrappers.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mock state ───────────────────────────────────────────────────────────

interface InsertCall {
  table: string;
  payload: Record<string, unknown>;
}
interface UpdateCall {
  table: string;
  patch: Record<string, unknown>;
  filters: Array<{ column: string; value: unknown }>;
}

interface MockState {
  user: { id: string } | null;
  employeeId: string | null; // employees.id resolved from profile_id
  insertError: { code: string; message: string } | null;
  updateError: { code: string; message: string } | null;
  inserts: InsertCall[];
  updates: UpdateCall[];
}

const state: MockState = {
  user: { id: 'auth-user-1' },
  employeeId: 'emp-self',
  insertError: null,
  updateError: null,
  inserts: [],
  updates: [],
};

function resetState() {
  state.user = { id: 'auth-user-1' };
  state.employeeId = 'emp-self';
  state.insertError = null;
  state.updateError = null;
  state.inserts = [];
  state.updates = [];
}

function buildFromMock(table: string) {
  return {
    select: (_cols: string) => {
      const chain = {
        eq: () => chain,
        maybeSingle: async () => {
          if (table === 'employees') {
            return { data: state.employeeId ? { id: state.employeeId } : null, error: null };
          }
          return { data: null, error: null };
        },
        single: async () => {
          if (table === 'employees') {
            return { data: state.employeeId ? { id: state.employeeId } : null, error: null };
          }
          return { data: null, error: null };
        },
      };
      return chain;
    },
    insert: (payload: Record<string, unknown>) => {
      state.inserts.push({ table, payload });
      const id = (payload.id as string | undefined) ?? 'db-generated-id';
      const result = { data: { id }, error: state.insertError };
      // Support both `await insert(payload)` and `insert(payload).select(...).single()`.
      const chain = {
        select: () => ({
          single: async () => result,
          maybeSingle: async () => result,
        }),
        then(resolve: (v: { error: unknown }) => void) {
          resolve({ error: state.insertError });
        },
      };
      return chain;
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
          resolve({ error: state.updateError });
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

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
}));

// Import AFTER vi.mock.
import { revalidatePath } from 'next/cache';
import { createTask } from '../tasks-actions';
import { createQuickTask, toggleTaskCompletion } from '../project-milestone-actions';
import { createLeadTask } from '../leads-task-actions';

beforeEach(() => {
  resetState();
});

afterEach(() => {
  vi.clearAllMocks();
});

// Helpers
function lastTaskInsert(): InsertCall {
  const i = [...state.inserts].reverse().find((x) => x.table === 'tasks');
  expect(i).toBeDefined();
  return i!;
}
function lastTaskUpdate(): UpdateCall {
  const u = [...state.updates].reverse().find((x) => x.table === 'tasks');
  expect(u).toBeDefined();
  return u!;
}

// ── createTask — now returns the new task id ─────────────────────────────

describe('createTask — returns the created task id', () => {
  it('returns a client-generated taskId that matches the inserted id', async () => {
    const result = await createTask({
      title: 'Universal task',
      entityType: 'project',
      entityId: 'proj-1',
      priority: 'high',
      assignedTo: 'emp-2',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.taskId).toBeTruthy();
      expect(lastTaskInsert().payload.id).toBe(result.data.taskId);
    }
  });

  it('still rejects a task with no assignee', async () => {
    const result = await createTask({
      title: 'No assignee',
      entityType: 'project',
      priority: 'medium',
    });
    expect(result.success).toBe(false);
    expect(state.inserts).toHaveLength(0);
  });
});

// ── toggleTaskCompletion — the completed_by regression ───────────────────

describe('toggleTaskCompletion — records who closed the task (completed_by)', () => {
  it('writes completed_by = the current employee when completing', async () => {
    state.employeeId = 'emp-closer';

    const result = await toggleTaskCompletion({
      taskId: 'task-1',
      isCompleted: true,
      projectId: 'proj-9',
    });

    expect(result.success).toBe(true);
    const u = lastTaskUpdate();
    expect(u.patch.is_completed).toBe(true);
    expect(u.patch.completed_at).toBeTruthy();
    // The bug: the old action omitted this write entirely.
    expect(u.patch.completed_by).toBe('emp-closer');
    expect(u.filters).toContainEqual({ column: 'id', value: 'task-1' });
  });

  it('clears completed_at AND completed_by when re-opening a task', async () => {
    const result = await toggleTaskCompletion({
      taskId: 'task-1',
      isCompleted: false,
      projectId: 'proj-9',
    });

    expect(result.success).toBe(true);
    const u = lastTaskUpdate();
    expect(u.patch.is_completed).toBe(false);
    expect(u.patch.completed_at).toBeNull();
    expect(u.patch.completed_by).toBeNull();
  });

  it('revalidates the project page on success', async () => {
    await toggleTaskCompletion({ taskId: 'task-1', isCompleted: true, projectId: 'proj-9' });
    expect(revalidatePath).toHaveBeenCalledWith('/projects/proj-9');
  });

  it('surfaces an update error without throwing', async () => {
    state.updateError = { code: '23503', message: 'fk violation' };

    const result = await toggleTaskCompletion({ taskId: 'task-1', isCompleted: true });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/fk violation/);
  });
});

// ── createQuickTask — project task, default-to-creator assignee ───────────

describe('createQuickTask — project execution task', () => {
  it('inserts a project-scoped task and returns success', async () => {
    const result = await createQuickTask({
      projectId: 'proj-7',
      milestoneId: 'mile-3',
      title: 'Wire the inverter',
      priority: 'high',
      assignedTo: 'emp-2',
    });

    expect(result.success).toBe(true);
    const ins = lastTaskInsert();
    expect(ins.payload.entity_type).toBe('project');
    expect(ins.payload.entity_id).toBe('proj-7');
    expect(ins.payload.project_id).toBe('proj-7');
    expect(ins.payload.milestone_id).toBe('mile-3');
    expect(ins.payload.assigned_to).toBe('emp-2');
    expect(ins.payload.priority).toBe('high');
  });

  it('defaults the assignee to the current employee when none is given', async () => {
    state.employeeId = 'emp-self';

    const result = await createQuickTask({ projectId: 'proj-7', title: 'Unassigned quick task' });

    expect(result.success).toBe(true);
    expect(lastTaskInsert().payload.assigned_to).toBe('emp-self');
  });

  it('defaults priority to medium', async () => {
    await createQuickTask({ projectId: 'proj-7', title: 't', assignedTo: 'emp-2' });
    expect(lastTaskInsert().payload.priority).toBe('medium');
  });

  it('revalidates the project page', async () => {
    await createQuickTask({ projectId: 'proj-7', title: 't', assignedTo: 'emp-2' });
    expect(revalidatePath).toHaveBeenCalledWith('/projects/proj-7');
  });
});

// ── createLeadTask — lead task, category default, validation ──────────────

describe('createLeadTask — lead task', () => {
  it('inserts a lead-scoped task with category defaulting to general', async () => {
    const result = await createLeadTask({
      leadId: 'lead-5',
      title: 'Call back about site survey',
      assignedTo: 'emp-2',
      dueDate: '2026-07-01',
    });

    expect(result.success).toBe(true);
    const ins = lastTaskInsert();
    expect(ins.payload.entity_type).toBe('lead');
    expect(ins.payload.entity_id).toBe('lead-5');
    expect(ins.payload.assigned_to).toBe('emp-2');
    expect(ins.payload.due_date).toBe('2026-07-01');
    expect(ins.payload.category).toBe('general');
  });

  it('keeps an explicit category', async () => {
    await createLeadTask({
      leadId: 'lead-5',
      title: 'Call',
      assignedTo: 'emp-2',
      dueDate: '2026-07-01',
      category: 'call',
    });
    expect(lastTaskInsert().payload.category).toBe('call');
  });

  it('rejects a blank title / missing assignee / missing due date before any insert', async () => {
    const noTitle = await createLeadTask({ leadId: 'lead-5', title: '   ', assignedTo: 'emp-2', dueDate: '2026-07-01' });
    expect(noTitle.success).toBe(false);
    if (!noTitle.success) expect(noTitle.code).toBe('MISSING_TITLE');

    const noAssignee = await createLeadTask({ leadId: 'lead-5', title: 'x', assignedTo: '', dueDate: '2026-07-01' });
    expect(noAssignee.success).toBe(false);
    if (!noAssignee.success) expect(noAssignee.code).toBe('MISSING_ASSIGNEE');

    const noDue = await createLeadTask({ leadId: 'lead-5', title: 'x', assignedTo: 'emp-2', dueDate: '' });
    expect(noDue.success).toBe(false);
    if (!noDue.success) expect(noDue.code).toBe('MISSING_DUE_DATE');

    expect(state.inserts).toHaveLength(0);
  });

  it('revalidates the lead tasks page', async () => {
    await createLeadTask({ leadId: 'lead-5', title: 'x', assignedTo: 'emp-2', dueDate: '2026-07-01' });
    expect(revalidatePath).toHaveBeenCalledWith('/leads/lead-5/tasks');
  });
});
