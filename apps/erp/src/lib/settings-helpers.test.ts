import { describe, it, expect } from 'vitest';
import { validateNewPassword, validateBugReport } from './settings-helpers';

describe('validateNewPassword', () => {
  it('rejects empty', () => {
    expect(validateNewPassword('', '')).toEqual({ ok: false, error: 'New password is required' });
  });
  it('rejects mismatched confirmation', () => {
    expect(validateNewPassword('abcdef', 'abcxyz')).toEqual({
      ok: false,
      error: 'Passwords do not match',
    });
  });
  it('rejects too short (< 6 chars — matches Supabase minimum)', () => {
    expect(validateNewPassword('abc', 'abc')).toEqual({
      ok: false,
      error: 'Password must be at least 6 characters',
    });
  });
  it('accepts matching password >= 6 chars', () => {
    expect(validateNewPassword('abcdef', 'abcdef')).toEqual({ ok: true });
  });
  it('prefers mismatch message over length message when both fail', () => {
    expect(validateNewPassword('abc', 'xyz')).toEqual({
      ok: false,
      error: 'Passwords do not match',
    });
  });
});

describe('validateBugReport', () => {
  it('rejects missing description', () => {
    expect(validateBugReport({ category: 'bug', severity: 'low', description: '' })).toEqual({
      ok: false,
      error: 'Description is required',
    });
  });
  it('rejects description under 10 characters', () => {
    expect(validateBugReport({ category: 'bug', severity: 'low', description: 'too short' })).toEqual({
      ok: false,
      error: 'Description must be at least 10 characters',
    });
  });
  it('rejects invalid category', () => {
    expect(
      validateBugReport({ category: 'not_a_category' as never, severity: 'low', description: 'a valid description' }),
    ).toEqual({ ok: false, error: 'Invalid category' });
  });
  it('rejects invalid severity', () => {
    expect(
      validateBugReport({ category: 'bug', severity: 'urgent' as never, description: 'a valid description' }),
    ).toEqual({ ok: false, error: 'Invalid severity' });
  });
  it('accepts a valid payload', () => {
    expect(
      validateBugReport({ category: 'bug', severity: 'medium', description: 'Something is off here.' }),
    ).toEqual({ ok: true });
  });
  it('treats whitespace-only description as missing (not too-short)', () => {
    expect(validateBugReport({ category: 'bug', severity: 'low', description: '     ' })).toEqual({
      ok: false,
      error: 'Description is required',
    });
  });
});
