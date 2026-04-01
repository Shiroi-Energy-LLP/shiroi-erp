import { describe, it, expect } from 'vitest';
import {
  getEscalationLevel,
  getEscalationLabel,
  getEscalationVariant,
  classifyCashPosition,
  cashPositionColor,
} from './cash-helpers';

describe('getEscalationLevel', () => {
  it('returns 0 for non-overdue', () => {
    expect(getEscalationLevel(0)).toBe(0);
  });
  it('returns 0 for negative days', () => {
    expect(getEscalationLevel(-5)).toBe(0);
  });
  it('returns 1 for day 1-4', () => {
    expect(getEscalationLevel(1)).toBe(1);
    expect(getEscalationLevel(4)).toBe(1);
  });
  it('returns 2 for day 5-9', () => {
    expect(getEscalationLevel(5)).toBe(2);
    expect(getEscalationLevel(9)).toBe(2);
  });
  it('returns 3 for day 10-29', () => {
    expect(getEscalationLevel(10)).toBe(3);
    expect(getEscalationLevel(29)).toBe(3);
  });
  it('returns 4 for day 30+', () => {
    expect(getEscalationLevel(30)).toBe(4);
    expect(getEscalationLevel(100)).toBe(4);
  });
});

describe('getEscalationLabel', () => {
  it('maps levels to labels', () => {
    expect(getEscalationLabel(0)).toBe('Current');
    expect(getEscalationLabel(1)).toBe('Sales Alert');
    expect(getEscalationLabel(2)).toBe('Manager');
    expect(getEscalationLabel(3)).toBe('Founder');
    expect(getEscalationLabel(4)).toBe('Legal');
  });
  it('returns Unknown for invalid level', () => {
    expect(getEscalationLabel(99)).toBe('Unknown');
  });
});

describe('getEscalationVariant', () => {
  it('returns default for level 0', () => {
    expect(getEscalationVariant(0)).toBe('default');
  });
  it('returns secondary for level 1', () => {
    expect(getEscalationVariant(1)).toBe('secondary');
  });
  it('returns outline for levels 2 and 3', () => {
    expect(getEscalationVariant(2)).toBe('outline');
    expect(getEscalationVariant(3)).toBe('outline');
  });
  it('returns destructive for level 4', () => {
    expect(getEscalationVariant(4)).toBe('destructive');
  });
});

describe('classifyCashPosition', () => {
  it('returns invested for negative', () => {
    expect(classifyCashPosition(-50000)).toBe('invested');
  });
  it('returns positive for positive', () => {
    expect(classifyCashPosition(120000)).toBe('positive');
  });
  it('returns neutral for zero', () => {
    expect(classifyCashPosition(0)).toBe('neutral');
  });
});

describe('cashPositionColor', () => {
  it('returns red for negative', () => {
    expect(cashPositionColor(-10000)).toBe('text-red-600');
  });
  it('returns green for positive', () => {
    expect(cashPositionColor(10000)).toBe('text-green-700');
  });
  it('returns gray for zero', () => {
    expect(cashPositionColor(0)).toBe('text-gray-600');
  });
});
