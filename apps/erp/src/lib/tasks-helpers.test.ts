import { describe, it, expect, vi, afterEach } from 'vitest';
import { isTaskOverdue, formatEntityType, priorityVariant } from './tasks-helpers';

describe('isTaskOverdue', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns false for null due date', () => {
    expect(isTaskOverdue(null)).toBe(false);
  });

  it('returns false for a future date', () => {
    // Use a date far in the future to avoid timezone edge cases
    expect(isTaskOverdue('2099-12-31')).toBe(false);
  });

  it('returns true for a past date', () => {
    expect(isTaskOverdue('2020-01-01')).toBe(true);
  });

  it('returns false for today\'s date', () => {
    // Get today in IST as YYYY-MM-DD
    const todayIST = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    expect(isTaskOverdue(todayIST)).toBe(false);
  });
});

describe('formatEntityType', () => {
  it('returns "Project" for "project"', () => {
    expect(formatEntityType('project')).toBe('Project');
  });

  it('returns "Service Ticket" for "om_ticket"', () => {
    expect(formatEntityType('om_ticket')).toBe('Service Ticket');
  });

  it('returns raw value for unknown type', () => {
    expect(formatEntityType('some_unknown_type')).toBe('some_unknown_type');
  });
});

describe('priorityVariant', () => {
  it('returns "error" for "high"', () => {
    expect(priorityVariant('high')).toBe('error');
  });

  it('returns "error" for "critical"', () => {
    expect(priorityVariant('critical')).toBe('error');
  });

  it('returns "warning" for "medium"', () => {
    expect(priorityVariant('medium')).toBe('warning');
  });

  it('returns "info" for "low"', () => {
    expect(priorityVariant('low')).toBe('info');
  });
});
