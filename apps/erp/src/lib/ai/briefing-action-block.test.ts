import { describe, it, expect } from 'vitest';
import {
  formatActionBlock,
  formatFounderActionBlock,
  formatSalesActionBlock,
} from './briefing-action-block';

describe('formatFounderActionBlock', () => {
  it('renders work-done with lead/project names, won-yesterday, due-before-today, closing-this-week and won-MTD', () => {
    const out = formatFounderActionBlock({
      tasksDone24h: [
        { title: 'to follow', customer_name: 'Vasudevan', project_number: null },
        { title: 'Fix earthing', customer_name: null, project_number: 'SE-042' },
        { title: 'Standalone admin task', customer_name: null, project_number: null },
      ],
      wonYesterday: [{ customer_name: 'Acme', owner_name: 'Prem' }],
      dueBeforeToday: [
        { customer_name: 'Gamma', owner_name: 'Prem', followup_overdue_days: 3, close_overdue_days: 0 },
        { customer_name: 'Delta', owner_name: 'Prem', followup_overdue_days: 0, close_overdue_days: 5 },
      ],
      closingThisWeek: [{ customer_name: 'Beta', owner_name: 'Prem', expected_close_date: '2026-07-08' }],
      wonCount: 4,
      wonValue: 12000000,
    });
    expect(out).toContain('Work done 24h (3)');
    expect(out).toContain('to follow — Vasudevan');
    expect(out).toContain('Fix earthing — SE-042');
    expect(out).toContain('• Standalone admin task');
    expect(out).toContain('Won yesterday (1)');
    expect(out).toContain('Acme (Prem)');
    expect(out).toContain('Due before today (2)');
    expect(out).toContain('Gamma (f/up 3d)');
    expect(out).toContain('Delta (close 5d)');
    expect(out).toContain('Closing this week (1)');
    expect(out).toContain('Beta (08 Jul)');
    expect(out).toContain('Won this month: ₹1.2Cr');
    expect(out).not.toContain('\t');
  });

  it('renders graceful empties', () => {
    const out = formatFounderActionBlock({
      tasksDone24h: [], wonYesterday: [], dueBeforeToday: [], closingThisWeek: [], wonCount: 0, wonValue: 0,
    });
    expect(out).toContain('Work done 24h (0)');
    expect(out).toContain('Won yesterday (0)');
    expect(out).toContain('Due before today (0)');
    expect(out).toContain('(nothing overdue)');
    expect(out).toContain('Closing this week (0)');
    expect(out).toContain('(none forecast)');
  });

  it('caps won-yesterday at 5 and due-before-today at 8 with a +N more tail', () => {
    const wonYesterday = Array.from({ length: 9 }, (_, i) => ({
      customer_name: `W${i}`, owner_name: 'Prem',
    }));
    const dueBeforeToday = Array.from({ length: 11 }, (_, i) => ({
      customer_name: `C${i}`, owner_name: 'Prem', followup_overdue_days: 1, close_overdue_days: 0,
    }));
    const out = formatFounderActionBlock({
      tasksDone24h: [], wonYesterday, dueBeforeToday, closingThisWeek: [], wonCount: 0, wonValue: 0,
    });
    expect(out).toContain('Won yesterday (9)');
    expect(out).toContain('…+4 more');
    expect(out).not.toContain('W5');
    expect(out).toContain('Due before today (11)');
    expect(out).toContain('…+3 more');
    expect(out).not.toContain('C9');
  });
});

describe('formatSalesActionBlock', () => {
  it('flags follow-up-overdue leads and lists closing-this-week reminders', () => {
    const out = formatSalesActionBlock({
      followupOverdue: [
        { customer_name: 'Acme', owner_name: 'Prem', followup_overdue_days: 3, close_overdue_days: 0 },
      ],
      closingThisWeek: [
        { customer_name: 'Beta', owner_name: 'Prem', expected_close_date: '2026-07-10' },
      ],
    });
    expect(out).toContain('⚠ Follow-up overdue (1)');
    expect(out).toContain('Acme — 3d overdue');
    expect(out).toContain('Closing this week (1)');
    expect(out).toContain('Beta (10 Jul)');
  });

  it('renders graceful empties', () => {
    const out = formatSalesActionBlock({ followupOverdue: [], closingThisWeek: [] });
    expect(out).toContain('(all follow-ups on time)');
    expect(out).toContain('(none forecast)');
  });

  it('caps lists at 8 with a +N more tail', () => {
    const followupOverdue = Array.from({ length: 11 }, (_, i) => ({
      customer_name: `C${i}`, owner_name: 'Prem', followup_overdue_days: 1, close_overdue_days: 0,
    }));
    const out = formatSalesActionBlock({ followupOverdue, closingThisWeek: [] });
    expect(out).toContain('Follow-up overdue (11)');
    expect(out).toContain('…+3 more');
    expect(out).not.toContain('C9');
  });
});

describe('formatActionBlock (legacy — project_manager digest)', () => {
  it('renders overdue, today, and won-MTD sections compactly', () => {
    const out = formatActionBlock({
      overdue: [
        { customer_name: 'Acme', owner_name: 'Prem', followup_overdue_days: 3, close_overdue_days: 0 },
      ],
      followupsToday: [{ assignee_name: 'Prem', customer_name: 'Beta', title: 'Call back' }],
      wonCount: 4,
      wonValue: 12000000,
    });
    expect(out).toContain('Overdue (1)');
    expect(out).toContain('Acme');
    expect(out).toContain('f/up 3d');
    expect(out).toContain("Today's follow-ups (1)");
    expect(out).toContain('Beta');
    expect(out).toContain('Won this month: ₹1.2Cr');
    expect(out).not.toContain('\t');
  });

  it('renders graceful empties', () => {
    const out = formatActionBlock({ overdue: [], followupsToday: [], wonCount: 0, wonValue: 0 });
    expect(out).toContain('Overdue (0)');
    expect(out).toContain("Today's follow-ups (0)");
    expect(out).toContain('Won this month: ₹0');
  });

  it('caps long lists at 8 with a +N more tail', () => {
    const overdue = Array.from({ length: 11 }, (_, i) => ({
      customer_name: `C${i}`,
      owner_name: 'Prem',
      followup_overdue_days: 1,
      close_overdue_days: 0,
    }));
    const out = formatActionBlock({ overdue, followupsToday: [], wonCount: 0, wonValue: 0 });
    expect(out).toContain('Overdue (11)');
    expect(out).toContain('…+3 more');
    expect(out).not.toContain('C9');
  });
});
