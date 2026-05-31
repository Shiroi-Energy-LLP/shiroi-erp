import { describe, expect, it } from 'vitest';

import { sanitizeForIlike, sanitizeForOr } from './sanitize-or-filter';

describe('sanitizeForOr', () => {
  it('passes clean input through trimmed', () => {
    expect(sanitizeForOr('john doe')).toBe('john doe');
  });

  it('removes commas', () => {
    expect(sanitizeForOr('foo,bar')).toBe('foobar');
  });

  it('removes opening and closing parens', () => {
    expect(sanitizeForOr('foo(bar)baz')).toBe('foobarbaz');
  });

  it('removes opening and closing braces', () => {
    expect(sanitizeForOr('foo{bar}baz')).toBe('foobarbaz');
  });

  it('removes asterisks', () => {
    expect(sanitizeForOr('foo*bar')).toBe('foobar');
  });

  it('trims surrounding whitespace', () => {
    expect(sanitizeForOr('   hello   ')).toBe('hello');
  });

  it('trims after stripping filter syntax', () => {
    expect(sanitizeForOr('  ,foo,  ')).toBe('foo');
  });

  it('neutralizes a combined injection attempt', () => {
    const attack = '%,role.eq.founder,name.ilike.%';
    const result = sanitizeForOr(attack);
    expect(result).not.toContain(',');
    expect(result).not.toContain('(');
    expect(result).not.toContain(')');
    expect(result).not.toContain('{');
    expect(result).not.toContain('}');
    expect(result).not.toContain('*');
    expect(result).toBe('%role.eq.foundername.ilike.%');
  });

  it('returns empty string for input that is only filter syntax', () => {
    expect(sanitizeForOr(',(){}*')).toBe('');
  });

  it('handles empty string', () => {
    expect(sanitizeForOr('')).toBe('');
  });
});

describe('sanitizeForIlike', () => {
  it('wraps clean input with % on both sides', () => {
    expect(sanitizeForIlike('john')).toBe('%john%');
  });

  it('sanitizes and then wraps with %', () => {
    expect(sanitizeForIlike('foo,bar')).toBe('%foobar%');
  });

  it('wraps trimmed input', () => {
    expect(sanitizeForIlike('  hello  ')).toBe('%hello%');
  });

  it('wraps even an empty sanitized result', () => {
    expect(sanitizeForIlike(',(){}*')).toBe('%%');
  });
});
