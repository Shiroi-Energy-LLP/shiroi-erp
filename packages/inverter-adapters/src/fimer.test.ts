/**
 * FIMER (Aurora Vision) adapter tests.
 *
 * Auth model:
 *   - api_key       → header X-AuroraVision-ApiKey on every call
 *   - oauth_token   → header X-AuroraVision-Token (acquired via /authenticate)
 *
 * Telemetry shape:
 *   GET /v1/stats/power/aggregated/{eid}/GenerationPower/average?...
 *     → { result: { units: "watts", value: 7164.9 } }
 *   GET /v1/plant/{eid}/dailyProduction?startDate=&endDate=
 *     → { result: { dailyValues: [{date:'YYYYMMDD', value:'95.952'}, ...] } }
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fimerAdapter, fimerAuthenticate, _statusFromPower } from './fimer';
import { InvalidCredentialsError, AdapterError } from './base';

const VALID_CREDS = {
  api_key: 'fa1d0f38-cf72-4257-95d3-66a13d55cba6-0c81',
  oauth_token: 'session-token-abc123',
  api_base: 'https://api.auroravision.net/api/rest',
  rated_capacity_kw: '25',
};

const VALID_INPUT = {
  credentials: VALID_CREDS,
  monitoring_site_id: '20030256',     // Schangalaya_25 KWp (real eid)
  monitoring_device_id: null,
  since: null,
};

const TODAY_YYYYMMDD = (() => {
  const d = new Date();
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
})();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('_statusFromPower', () => {
  it('null → null (unknown)', () => {
    expect(_statusFromPower(null)).toBeNull();
  });
  it('positive power → active', () => {
    expect(_statusFromPower(7.16)).toBe('active');
    expect(_statusFromPower(0.06)).toBe('active');
  });
  it('zero / near-zero → offline (covers night-time)', () => {
    expect(_statusFromPower(0)).toBe('offline');
    expect(_statusFromPower(0.04)).toBe('offline');
  });
});

describe('fimerAuthenticate', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
  afterEach(() => vi.restoreAllMocks());

  it('sends Basic auth + ApiKey header and returns the token from result field', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce(jsonResponse({ result: 'Kl0V4qUUpr5b...real-token' }));
    vi.stubGlobal('fetch', mockFetch);

    const token = await fimerAuthenticate({
      apiKey: 'fa1d0f38-cf72-4257-95d3-66a13d55cba6-0c81',
      username: 'Shiroienergy',
      password: 'Solar@123',
    });

    expect(token).toBe('Kl0V4qUUpr5b...real-token');
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toBe('https://api.auroravision.net/api/rest/authenticate');
    const headers = init?.headers as Record<string, string>;
    expect(headers['X-AuroraVision-ApiKey']).toBe('fa1d0f38-cf72-4257-95d3-66a13d55cba6-0c81');
    expect(headers['Authorization']).toBe(
      'Basic ' + Buffer.from('Shiroienergy:Solar@123').toString('base64'),
    );
  });

  it('throws AdapterError on HTTP 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('Unauthorized', { status: 401 })));
    await expect(
      fimerAuthenticate({ apiKey: 'k', username: 'u', password: 'p' }),
    ).rejects.toBeInstanceOf(AdapterError);
  });

  it('throws AdapterError when 200 but no result field', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse({ status: 'OK' })));
    await expect(
      fimerAuthenticate({ apiKey: 'k', username: 'u', password: 'p' }),
    ).rejects.toBeInstanceOf(AdapterError);
  });
});

describe('fimerAdapter.fetchReadings — credential validation', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    delete process.env['SYNTHETIC_INVERTER_READINGS'];
  });
  afterEach(() => vi.restoreAllMocks());

  it('throws InvalidCredentialsError if api_key is missing', async () => {
    await expect(
      fimerAdapter.fetchReadings({ ...VALID_INPUT, credentials: { ...VALID_CREDS, api_key: undefined } }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it('throws InvalidCredentialsError if oauth_token is missing', async () => {
    await expect(
      fimerAdapter.fetchReadings({ ...VALID_INPUT, credentials: { ...VALID_CREDS, oauth_token: undefined } }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it('throws InvalidCredentialsError if monitoring_site_id is null', async () => {
    await expect(
      fimerAdapter.fetchReadings({ ...VALID_INPUT, monitoring_site_id: null }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });
});

describe('fimerAdapter.fetchReadings — synthetic mode', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env['SYNTHETIC_INVERTER_READINGS'];
  });

  it('returns 1 synthetic reading without calling fetch when SYNTHETIC_INVERTER_READINGS=1', async () => {
    process.env['SYNTHETIC_INVERTER_READINGS'] = '1';
    const result = await fimerAdapter.fetchReadings(VALID_INPUT);
    expect(result.readings).toHaveLength(1);
    expect(result.readings[0]!.raw_payload['source']).toBe('synthetic');
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('fimerAdapter.fetchReadings — real API flow', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    delete process.env['SYNTHETIC_INVERTER_READINGS'];
  });
  afterEach(() => vi.restoreAllMocks());

  it('sends X-AuroraVision-ApiKey + X-AuroraVision-Token headers on both calls', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ result: { units: 'watts', value: 7164.9 } }))
      .mockResolvedValueOnce(jsonResponse({ result: { dailyValues: [{ date: TODAY_YYYYMMDD, value: '95.952' }] } }));
    vi.stubGlobal('fetch', mockFetch);

    await fimerAdapter.fetchReadings(VALID_INPUT);

    expect(mockFetch).toHaveBeenCalledTimes(2);
    for (const call of mockFetch.mock.calls) {
      const headers = call[1]?.headers as Record<string, string>;
      expect(headers['X-AuroraVision-ApiKey']).toBe(VALID_CREDS.api_key);
      expect(headers['X-AuroraVision-Token']).toBe(VALID_CREDS.oauth_token);
    }
  });

  it('normalizes watts → kW and pulls today\'s energy from dailyValues', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(jsonResponse({ result: { units: 'watts', value: 7164.9 } }))
      .mockResolvedValueOnce(jsonResponse({ result: { dailyValues: [{ date: TODAY_YYYYMMDD, value: '95.952' }] } }))
    );

    const result = await fimerAdapter.fetchReadings(VALID_INPUT);

    expect(result.readings).toHaveLength(1);
    const r = result.readings[0]!;
    expect(r.ac_power_kw).toBe(7.165);
    expect(r.energy_today_kwh).toBe(95.952);
    expect(r.status).toBe('active');
    expect(r.raw_payload['source']).toBe('fimer.auroravision.v1');
    expect(r.raw_payload['entity_id']).toBe('20030256');
  });

  it('returns nulls when both endpoints return no usable data', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(jsonResponse({ result: { units: 'watts' } }))                  // value absent
      .mockResolvedValueOnce(jsonResponse({ result: { dailyValues: [{ date: TODAY_YYYYMMDD }] } })) // value absent
    );

    const result = await fimerAdapter.fetchReadings(VALID_INPUT);

    expect(result.readings).toHaveLength(1);
    expect(result.readings[0]!.ac_power_kw).toBeNull();
    expect(result.readings[0]!.energy_today_kwh).toBeNull();
    expect(result.readings[0]!.status).toBeNull();
  });

  it('swallows per-endpoint errors (one fails, other returns) without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response('Forbidden', { status: 403 }))                    // power 403
      .mockResolvedValueOnce(jsonResponse({ result: { dailyValues: [{ date: TODAY_YYYYMMDD, value: '12.5' }] } })) // energy 200
    );

    const result = await fimerAdapter.fetchReadings(VALID_INPUT);
    expect(result.readings).toHaveLength(1);
    expect(result.readings[0]!.ac_power_kw).toBeNull();
    expect(result.readings[0]!.energy_today_kwh).toBe(12.5);
  });
});

describe('fimerAdapter.healthCheck', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    delete process.env['SYNTHETIC_INVERTER_READINGS'];
  });
  afterEach(() => vi.restoreAllMocks());

  it('returns ok=false when api_key missing', async () => {
    const r = await fimerAdapter.healthCheck({ username: 'u', password: 'p' });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/api_key/i);
  });

  it('returns ok=false when password missing', async () => {
    const r = await fimerAdapter.healthCheck({ api_key: 'k', username: 'u' });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/password/i);
  });

  it('returns ok=true in synthetic mode without calling fetch', async () => {
    process.env['SYNTHETIC_INVERTER_READINGS'] = '1';
    const r = await fimerAdapter.healthCheck({ api_key: 'k', username: 'u', password: 'p' });
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/synthetic/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns ok=true when /authenticate returns a token', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse({ result: 'token-abcdef0123456789' })));
    const r = await fimerAdapter.healthCheck({
      api_key: 'fa1d0f38-cf72-4257-95d3-66a13d55cba6-0c81',
      username: 'Shiroienergy',
      password: 'Solar@123',
    });
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/token-ab/);   // adapter shows first 8 chars
  });

  it('returns ok=false on 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('Unauthorized', { status: 401 })));
    const r = await fimerAdapter.healthCheck({ api_key: 'k', username: 'u', password: 'wrong' });
    expect(r.ok).toBe(false);
  });
});
