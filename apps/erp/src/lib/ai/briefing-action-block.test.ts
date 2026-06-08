import { describe, it, expect } from 'vitest';
import { formatActionBlock } from './briefing-action-block';

describe('formatActionBlock', () => {
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
