import { describe, it, expect } from 'vitest';
import { isValidTransition, normalizePhone } from './leads-helpers';

describe('isValidTransition', () => {
  it('allows new → contacted', () => {
    expect(isValidTransition('new', 'contacted')).toBe(true);
  });
  it('blocks contacted → won', () => {
    expect(isValidTransition('contacted', 'won')).toBe(false);
  });
  it('no status → disqualified (hidden terminal state, migration 055)', () => {
    // Marketing revamp tightened VALID_TRANSITIONS to only stepper-visible
    // destinations. disqualified is still in the enum for historical rows
    // + triggers, but the dropdown never offers it.
    expect(isValidTransition('new', 'disqualified')).toBe(false);
    expect(isValidTransition('negotiation', 'disqualified')).toBe(false);
  });
  it('allows any status → on_hold', () => {
    expect(isValidTransition('contacted', 'on_hold')).toBe(true);
  });
  it('allows negotiation → won', () => {
    expect(isValidTransition('negotiation', 'won')).toBe(true);
  });
  it('allows negotiation → lost', () => {
    expect(isValidTransition('negotiation', 'lost')).toBe(true);
  });
  it('blocks won → any', () => {
    expect(isValidTransition('won', 'new')).toBe(false);
    expect(isValidTransition('won', 'contacted')).toBe(false);
  });
  it('blocks disqualified → any', () => {
    expect(isValidTransition('disqualified', 'new')).toBe(false);
  });
  it('allows on_hold → back to pipeline', () => {
    expect(isValidTransition('on_hold', 'contacted')).toBe(true);
    expect(isValidTransition('on_hold', 'negotiation')).toBe(true);
  });
});

describe('normalizePhone', () => {
  it('strips +91 prefix', () => {
    expect(normalizePhone('+919876543210')).toBe('9876543210');
  });
  it('strips spaces and dashes', () => {
    expect(normalizePhone('98765-43210')).toBe('9876543210');
  });
  it('strips 91 prefix from 12 digits', () => {
    expect(normalizePhone('919876543210')).toBe('9876543210');
  });
  it('returns 10 digits unchanged', () => {
    expect(normalizePhone('9876543210')).toBe('9876543210');
  });
});
