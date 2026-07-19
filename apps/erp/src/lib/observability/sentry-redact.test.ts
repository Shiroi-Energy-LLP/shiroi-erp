import { describe, it, expect } from 'vitest';
import { SENSITIVE_FIELD_KEYS, redactSensitive, beforeSend } from './sentry-redact';
import type { ErrorEvent, EventHint } from '@sentry/nextjs';

// ---------------------------------------------------------------------------
// redactSensitive — unit tests
// ---------------------------------------------------------------------------

describe('redactSensitive', () => {
  it('redacts top-level sensitive keys', () => {
    const result = redactSensitive({ pan_number: 'ABCDE1234F', name: 'Alice' });
    expect(result).toEqual({ pan_number: '[redacted]', name: 'Alice' });
  });

  it('redacts nested sensitive keys at depth', () => {
    const result = redactSensitive({
      employee: {
        profile: {
          bank_account_number: '1234567890',
          city: 'Chennai',
          ctc_monthly: 50000,
        },
      },
    });
    expect(result).toEqual({
      employee: {
        profile: {
          bank_account_number: '[redacted]',
          city: 'Chennai',
          ctc_monthly: '[redacted]',
        },
      },
    });
  });

  it('redacts sensitive values inside arrays', () => {
    const result = redactSensitive([
      { aadhar_number: '123456789012', role: 'admin' },
      { ctc_annual: 600000, name: 'Bob' },
    ]);
    expect(result).toEqual([
      { aadhar_number: '[redacted]', role: 'admin' },
      { ctc_annual: '[redacted]', name: 'Bob' },
    ]);
  });

  it('redacts all blocklisted keys from SENSITIVE_FIELD_KEYS', () => {
    const obj: Record<string, unknown> = {};
    for (const key of SENSITIVE_FIELD_KEYS) {
      obj[key] = 'some-value';
    }
    const result = redactSensitive(obj) as Record<string, unknown>;
    for (const key of SENSITIVE_FIELD_KEYS) {
      expect(result[key]).toBe('[redacted]');
    }
  });

  it('does NOT redact non-sensitive siblings', () => {
    const result = redactSensitive({
      gross_monthly: 30000,
      project_name: 'Rooftop Solar',
      lead_id: 'abc-123',
    });
    expect(result).toEqual({
      gross_monthly: '[redacted]',
      project_name: 'Rooftop Solar',
      lead_id: 'abc-123',
    });
  });

  it('redacts camelCase variant (panNumber)', () => {
    const result = redactSensitive({ panNumber: 'ABCDE1234F' });
    expect(result).toEqual({ panNumber: '[redacted]' });
  });

  it('redacts UPPER_CASE variant (AADHAR_NUMBER)', () => {
    const result = redactSensitive({ AADHAR_NUMBER: '123456789012' });
    expect(result).toEqual({ AADHAR_NUMBER: '[redacted]' });
  });

  it('redacts mixed variants (BankAccountNumber)', () => {
    const result = redactSensitive({ BankAccountNumber: '9988776655' });
    expect(result).toEqual({ BankAccountNumber: '[redacted]' });
  });

  it('handles a circular reference without throwing or hanging', () => {
    const obj: Record<string, unknown> = { safe: 'value' };
    obj['self'] = obj; // circular
    expect(() => redactSensitive(obj)).not.toThrow();
    const result = redactSensitive(obj) as Record<string, unknown>;
    expect(result['safe']).toBe('value');
  });

  it('does not mutate primitives', () => {
    expect(redactSensitive(42)).toBe(42);
    expect(redactSensitive('hello')).toBe('hello');
    expect(redactSensitive(null)).toBeNull();
    expect(redactSensitive(undefined)).toBeUndefined();
  });

  it('does not mutate boolean', () => {
    expect(redactSensitive(true)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// beforeSend — integration tests
// ---------------------------------------------------------------------------

describe('beforeSend', () => {
  it('redacts extra.pan_number in a Sentry event', () => {
    const event: ErrorEvent = {
      type: undefined,
      extra: { pan_number: 'ABCDE1234F', other: 'ok' },
    };
    const result = beforeSend(event, {} as EventHint) as ErrorEvent;
    expect((result.extra as Record<string, unknown>)['pan_number']).toBe('[redacted]');
    expect((result.extra as Record<string, unknown>)['other']).toBe('ok');
  });

  it('redacts breadcrumb data.aadhar_number', () => {
    const event: ErrorEvent = {
      type: undefined,
      breadcrumbs: [
        {
          data: { aadhar_number: '123456789012', action: 'click' },
          message: 'user action',
        },
      ],
    };
    const result = beforeSend(event, {} as EventHint) as ErrorEvent;
    const breadcrumb = result.breadcrumbs?.[0];
    expect(breadcrumb?.data?.['aadhar_number']).toBe('[redacted]');
    expect(breadcrumb?.data?.['action']).toBe('click');
  });

  it('scrubs exception value string containing pan_number: <value>', () => {
    const event: ErrorEvent = {
      type: undefined,
      exception: {
        values: [
          {
            type: 'Error',
            value: 'Validation failed for pan_number: ABCDE1234F in employee record',
          },
        ],
      },
    };
    const result = beforeSend(event, {} as EventHint) as ErrorEvent;
    const val = result.exception?.values?.[0]?.value ?? '';
    expect(val).toContain('pan_number:');
    expect(val).toContain('[redacted]');
    expect(val).not.toContain('ABCDE1234F');
  });

  it('scrubs exception value string with = syntax', () => {
    const event: ErrorEvent = {
      type: undefined,
      exception: {
        values: [{ type: 'Error', value: 'Error: ctc_monthly=600000 exceeded limit' }],
      },
    };
    const result = beforeSend(event, {} as EventHint) as ErrorEvent;
    const val = result.exception?.values?.[0]?.value ?? '';
    expect(val).toContain('[redacted]');
    expect(val).not.toContain('600000');
  });

  it('scrubs exception value string with JSON "key":"value" syntax', () => {
    const event: ErrorEvent = {
      type: undefined,
      exception: {
        values: [{ type: 'Error', value: '{"bank_account_number":"9988776655","status":"active"}' }],
      },
    };
    const result = beforeSend(event, {} as EventHint) as ErrorEvent;
    const val = result.exception?.values?.[0]?.value ?? '';
    expect(val).toContain('[redacted]');
    expect(val).not.toContain('9988776655');
    expect(val).toContain('status');
  });

  it('redacts event.message with sensitive key=value', () => {
    const event: ErrorEvent = {
      type: undefined,
      message: 'Employee updated: gross_monthly=75000 saved',
    };
    const result = beforeSend(event, {} as EventHint) as ErrorEvent;
    expect(result.message).toContain('[redacted]');
    expect(result.message).not.toContain('75000');
  });

  it('redacts user and contexts', () => {
    const event: ErrorEvent = {
      type: undefined,
      user: { id: 'emp-1', username: 'alice', pan_number: 'ABCDE1234F' } as Record<string, unknown>,
      contexts: {
        payroll: { gross_monthly: 50000, month: 'Jan' },
      },
    };
    const result = beforeSend(event, {} as EventHint) as ErrorEvent;
    expect((result.user as Record<string, unknown>)['pan_number']).toBe('[redacted]');
    expect((result.user as Record<string, unknown>)['id']).toBe('emp-1');
    const payroll = (result.contexts as Record<string, unknown>)['payroll'] as Record<string, unknown>;
    expect(payroll['gross_monthly']).toBe('[redacted]');
    expect(payroll['month']).toBe('Jan');
  });

  it('redacts request.data', () => {
    const event: ErrorEvent = {
      type: undefined,
      request: {
        url: '/api/employees',
        data: { pan_number: 'ABCDE1234F', name: 'Charlie' },
      },
    };
    const result = beforeSend(event, {} as EventHint) as ErrorEvent;
    const data = result.request!.data as Record<string, unknown>;
    expect(data['pan_number']).toBe('[redacted]');
    expect(data['name']).toBe('Charlie');
  });

  it('passes a normal (non-PII) event through unchanged', () => {
    const event: ErrorEvent = {
      type: undefined,
      message: 'Something broke',
      extra: { attempt: 3, route: '/api/projects' },
      exception: {
        values: [{ type: 'TypeError', value: 'Cannot read property of undefined' }],
      },
    };
    const result = beforeSend(event, {} as EventHint) as ErrorEvent;
    expect(result.message).toBe('Something broke');
    expect((result.extra as Record<string, unknown>)['attempt']).toBe(3);
    expect(result.exception?.values?.[0]?.value).toBe('Cannot read property of undefined');
  });

  it('returns an event even when passed a completely empty event', () => {
    const event: ErrorEvent = { type: undefined };
    const result = beforeSend(event, {} as EventHint);
    expect(result).not.toBeNull();
  });
});
