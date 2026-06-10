/**
 * sentry-redact.ts
 *
 * Provides a Sentry `beforeSend` callback that deep-redacts sensitive PII
 * fields before events are shipped to Sentry.
 *
 * Sensitive fields defined by the project blocklist (CLAUDE.md § "sensitive
 * fields / never in logs"). No existing repo-wide constant was found, so the
 * list is defined here as the single source of truth.
 */

import type { ErrorEvent, EventHint, Breadcrumb } from '@sentry/nextjs';

// ---------------------------------------------------------------------------
// Sensitive-field blocklist
// ---------------------------------------------------------------------------

/**
 * Canonical list of sensitive field names. Keys in event objects whose
 * normalized form (lowercase, non-alphanumeric stripped) matches any entry
 * here will have their values replaced with '[redacted]'.
 */
export const SENSITIVE_FIELD_KEYS: string[] = [
  'bank_account_number',
  'aadhar_number',
  'pan_number',
  'gross_monthly',
  'basic_salary',
  'ctc_monthly',
  'ctc_annual',
  'net_take_home',
  'commission_amount',
  'pf_employee',
];

// Pre-compute normalized versions for fast lookup at runtime.
const NORMALIZED_BLOCKLIST: Set<string> = new Set(
  SENSITIVE_FIELD_KEYS.map(normalizeKey),
);

/** Normalize a key: lowercase + strip all non-alphanumeric characters. */
function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Return true if the given object key matches any blocklisted field. */
function isSensitiveKey(key: string): boolean {
  return NORMALIZED_BLOCKLIST.has(normalizeKey(key));
}

// ---------------------------------------------------------------------------
// Deep redactor
// ---------------------------------------------------------------------------

const MAX_DEPTH = 8;
const REDACTED = '[redacted]';

/**
 * Deep-walk `value` and replace the value of any property whose key is in the
 * sensitive-field blocklist with `'[redacted]'`.
 *
 * - Cycle-safe via a `WeakSet` of visited objects.
 * - Recursion depth is capped at `MAX_DEPTH`.
 * - Primitives are returned as-is.
 * - Does not mutate the original value beyond replacing sensitive fields
 *   in-place on the returned object (objects and arrays are shallow-copied
 *   at each visited level, so the original structure is not modified).
 */
export function redactSensitive(
  value: unknown,
  _visited: WeakSet<object> = new WeakSet(),
  _depth: number = 0,
): unknown {
  // Primitives: return unchanged.
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;

  // Depth guard.
  if (_depth >= MAX_DEPTH) return value;

  // Cycle guard.
  if (_visited.has(value as object)) return '[circular]';
  _visited.add(value as object);

  if (Array.isArray(value)) {
    return value.map((item) => redactSensitive(item, _visited, _depth + 1));
  }

  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (isSensitiveKey(k)) {
      result[k] = REDACTED;
    } else {
      result[k] = redactSensitive(v, _visited, _depth + 1);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// String-level scrub (best-effort for message / exception.value strings)
// ---------------------------------------------------------------------------

/**
 * For each blocklisted key, build a regex that matches the VALUE in the
 * following patterns:
 *   key: value          (e.g. `pan_number: ABCDE1234F`)
 *   key=value           (e.g. `pan_number=ABCDE1234F`)
 *   "key":"value"       (e.g. JSON serialized)
 *   "key": "value"      (e.g. pretty-printed JSON)
 *
 * The regex matches the value up to the next whitespace, comma, `}`, `"`, or
 * end of string. It captures the delimiter so it can be preserved.
 *
 * Note: this is best-effort. A bare interpolated value with no adjacent key
 * cannot be scrubbed this way.
 */
const STRING_SCRUB_PATTERNS: RegExp[] = (() => {
  // For each blocklisted key, accept any normalization (underscored, camel,
  // UPPER). We build patterns for the canonical underscored form; camelCase
  // variants are handled by normalizing the key inside the pattern.
  const patterns: RegExp[] = [];
  for (const key of SENSITIVE_FIELD_KEYS) {
    // Build a regex segment that matches the canonical key in any casing:
    // underscores optional, letters in any case.
    // e.g. pan_number → pan_?number  →  /pan_?number/i
    // We keep it simple: match the key literally (case-insensitive), with
    // optional underscores between words.
    const escaped = key.replace(/_/g, '[_]?');
    // Matches:
    //   key: value   key=value   "key":"value"   "key": "value"
    // Value is non-greedy up to a word boundary, comma, }, whitespace, "
    const src = `("?${escaped}"?\\s*[:=]\\s*"?)([^"\\s,}]+)("?)`;
    patterns.push(new RegExp(src, 'gi'));
  }
  return patterns;
})();

function scrubString(str: string): string {
  let result = str;
  for (const pattern of STRING_SCRUB_PATTERNS) {
    // Reset lastIndex because we reuse these RegExp objects.
    pattern.lastIndex = 0;
    result = result.replace(pattern, (_match, prefix, _value, suffix) => {
      return `${prefix}${REDACTED}${suffix}`;
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// beforeSend callback
// ---------------------------------------------------------------------------

/**
 * Sentry `beforeSend` callback. Applies PII redaction to the structured and
 * string parts of a Sentry `ErrorEvent`.
 *
 * Redaction targets:
 *   - `event.extra`
 *   - `event.contexts`
 *   - `event.request?.data`
 *   - `event.user`
 *   - `event.breadcrumbs[].data`
 *   - `event.message` (string scrub)
 *   - `event.exception.values[].value` (string scrub)
 *
 * Guaranteed never to throw: wrapped in try/catch; on internal error the
 * original event is returned so the error report still reaches Sentry.
 */
export function beforeSend(
  event: ErrorEvent,
  _hint?: EventHint,
): ErrorEvent | null {
  try {
    // Structured deep-redaction.
    if (event.extra != null) {
      event.extra = redactSensitive(event.extra) as typeof event.extra;
    }
    if (event.contexts != null) {
      event.contexts = redactSensitive(event.contexts) as typeof event.contexts;
    }
    if (event.user != null) {
      event.user = redactSensitive(event.user) as typeof event.user;
    }
    if (event.request?.data != null) {
      event.request.data = redactSensitive(event.request.data);
    }
    if (event.breadcrumbs != null) {
      event.breadcrumbs = event.breadcrumbs.map((crumb: Breadcrumb) => {
        if (crumb.data != null) {
          return {
            ...crumb,
            data: redactSensitive(crumb.data) as typeof crumb.data,
          };
        }
        return crumb;
      });
    }

    // Best-effort string scrub for message and exception strings.
    if (typeof event.message === 'string') {
      event.message = scrubString(event.message);
    }
    if (event.exception?.values != null) {
      event.exception.values = event.exception.values.map((ex) => {
        if (typeof ex.value === 'string') {
          return { ...ex, value: scrubString(ex.value) };
        }
        return ex;
      });
    }

    return event;
  } catch {
    // Fallback: return original event untouched to avoid swallowing errors.
    return event;
  }
}
