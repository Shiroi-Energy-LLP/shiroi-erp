import { describe, it, expect } from 'vitest';
import { daysSinceDelivery, getMSMEAlertLevel, getMSMEDueDate } from './msme-calc';

describe('daysSinceDelivery', () => {
  it('calculates days correctly', () => {
    const delivery = new Date('2026-02-15');
    const today = new Date('2026-03-20');
    expect(daysSinceDelivery(delivery, today)).toBe(33);
  });

  it('returns 0 for same day', () => {
    const date = new Date('2026-03-01');
    expect(daysSinceDelivery(date, date)).toBe(0);
  });

  it('returns negative for future delivery', () => {
    const delivery = new Date('2026-04-01');
    const today = new Date('2026-03-20');
    expect(daysSinceDelivery(delivery, today)).toBe(-12);
  });

  it('handles month boundary correctly', () => {
    const delivery = new Date('2026-01-31');
    const today = new Date('2026-02-01');
    expect(daysSinceDelivery(delivery, today)).toBe(1);
  });

  it('handles year boundary correctly', () => {
    const delivery = new Date('2025-12-31');
    const today = new Date('2026-01-01');
    expect(daysSinceDelivery(delivery, today)).toBe(1);
  });
});

describe('getMSMEAlertLevel', () => {
  it('returns none for < 40 days', () => {
    expect(getMSMEAlertLevel(30)).toBe('none');
  });

  it('returns none for 39 days', () => {
    expect(getMSMEAlertLevel(39)).toBe('none');
  });

  it('returns amber for 40 days', () => {
    expect(getMSMEAlertLevel(40)).toBe('amber');
  });

  it('returns amber for 43 days', () => {
    expect(getMSMEAlertLevel(43)).toBe('amber');
  });

  it('returns red for 44 days', () => {
    expect(getMSMEAlertLevel(44)).toBe('red');
  });

  it('returns red for 45 days (due date)', () => {
    expect(getMSMEAlertLevel(45)).toBe('red');
  });

  it('returns overdue for 46 days', () => {
    expect(getMSMEAlertLevel(46)).toBe('overdue');
  });

  it('returns overdue for 60 days', () => {
    expect(getMSMEAlertLevel(60)).toBe('overdue');
  });

  it('returns none for 0 days', () => {
    expect(getMSMEAlertLevel(0)).toBe('none');
  });

  it('returns none for negative days', () => {
    expect(getMSMEAlertLevel(-5)).toBe('none');
  });
});

describe('getMSMEDueDate', () => {
  it('adds 45 days to delivery date', () => {
    const delivery = new Date('2026-02-01');
    const due = getMSMEDueDate(delivery);
    expect(due.getFullYear()).toBe(2026);
    expect(due.getMonth()).toBe(2); // March (0-indexed)
    expect(due.getDate()).toBe(18);
  });

  it('handles month overflow', () => {
    const delivery = new Date('2026-11-20');
    const due = getMSMEDueDate(delivery);
    expect(due.getFullYear()).toBe(2027);
    expect(due.getMonth()).toBe(0); // January
    expect(due.getDate()).toBe(4);
  });
});
