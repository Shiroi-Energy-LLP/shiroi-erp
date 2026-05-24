/**
 * Sungrow adapter tests — OAuth2 / Bearer token flow.
 *
 * API architecture (iSolarCloud OpenAPI v2):
 *   - GET /openapi/getDeviceRealTimeData (POST body) with:
 *     - x-access-key: {appkey}
 *     - Authorization: Bearer {access_token}
 *     - body: { ps_id, device_sn_list: [sn] }
 *   - result_code '1' = success
 *   - result_data.p_array[] = device rows
 *
 * Credentials passed via AdapterCredentials:
 *   - api_key       → appkey (SUNGROW_APPKEY)
 *   - oauth_token   → access_token
 *   - api_base      → SUNGROW_BASE_URL
 *   - rated_capacity_kw → used for synthetic mode
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sungrowAdapter } from './sungrow';
import { InvalidCredentialsError, AdapterError } from './base';

// ─── Test fixtures ────────────────────────────────────────────────────────

const VALID_CREDENTIALS = {
  api_key: '2AA92F581E364814219BCE67614A1C30',
  oauth_token: 'test-access-token-abc123',
  api_base: 'https://gateway.isolarcloud.com.hk',
  rated_capacity_kw: '5',
};

const VALID_INPUT = {
  credentials: VALID_CREDENTIALS,
  monitoring_site_id: 'ps_12345',
  monitoring_device_id: 'SN20001234',
  since: null,
};

/** Mock Sungrow real-time data response — matches iSolarCloud OpenAPI v2 shape. */
const REALTIME_SUCCESS_BODY = {
  result_code: '1',
  result_msg: 'success',
  result_data: {
    p_array: [
      {
        device_sn: 'SN20001234',
        device_status: '1',
        p_kw: '4.8',
        dc_p_kw: '4.9',
        grid_v: '232.5',
        grid_a: '20.6',
        grid_freq: '50.01',
        t_inverter: '42.3',
        today_energy_kwh: '22.4',
        total_energy_kwh: '15230.5',
        fault_code: null,
        update_time: '2026-05-23 14:30:00',
      },
    ],
  },
};

/** Build a mock Response for the device real-time data endpoint. */
function realtimeSuccessResponse(): Response {
  return new Response(JSON.stringify(REALTIME_SUCCESS_BODY), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function realtimeErrorResponse(result_code: string, result_msg: string): Response {
  return new Response(
    JSON.stringify({ result_code, result_msg, result_data: null }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe('sungrowAdapter', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    delete process.env.SYNTHETIC_INVERTER_READINGS;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.SYNTHETIC_INVERTER_READINGS;
  });

  // ── 1. Credential validation ───────────────────────────────────────────

  describe('fetchReadings — credential validation', () => {
    it('throws InvalidCredentialsError if api_key is missing', async () => {
      await expect(
        sungrowAdapter.fetchReadings({
          ...VALID_INPUT,
          credentials: { ...VALID_CREDENTIALS, api_key: undefined },
        }),
      ).rejects.toBeInstanceOf(InvalidCredentialsError);
    });

    it('throws InvalidCredentialsError if oauth_token is missing', async () => {
      await expect(
        sungrowAdapter.fetchReadings({
          ...VALID_INPUT,
          credentials: { ...VALID_CREDENTIALS, oauth_token: undefined },
        }),
      ).rejects.toBeInstanceOf(InvalidCredentialsError);
    });

    it('throws InvalidCredentialsError if monitoring_site_id is null', async () => {
      await expect(
        sungrowAdapter.fetchReadings({
          ...VALID_INPUT,
          monitoring_site_id: null,
        }),
      ).rejects.toBeInstanceOf(InvalidCredentialsError);
    });

    it('throws InvalidCredentialsError if monitoring_device_id is null', async () => {
      await expect(
        sungrowAdapter.fetchReadings({
          ...VALID_INPUT,
          monitoring_device_id: null,
        }),
      ).rejects.toBeInstanceOf(InvalidCredentialsError);
    });
  });

  // ── 2. Synthetic mode ──────────────────────────────────────────────────

  describe('fetchReadings — synthetic mode', () => {
    it('returns 1 reading with raw_payload.source === "synthetic" when SYNTHETIC_INVERTER_READINGS=1', async () => {
      process.env.SYNTHETIC_INVERTER_READINGS = '1';
      const result = await sungrowAdapter.fetchReadings(VALID_INPUT);
      expect(result.readings).toHaveLength(1);
      expect(result.string_readings).toHaveLength(0);
      expect(result.readings[0]!.raw_payload.source).toBe('synthetic');
      // fetch must NOT be called in synthetic mode
      expect(fetch).not.toHaveBeenCalled();
    });

    it('uses rated_capacity_kw from credentials in synthetic mode', async () => {
      process.env.SYNTHETIC_INVERTER_READINGS = '1';
      const result = await sungrowAdapter.fetchReadings({
        ...VALID_INPUT,
        credentials: { ...VALID_CREDENTIALS, rated_capacity_kw: '10' },
      });
      // ac_power_kw should be bounded by rated capacity (10 kW)
      const reading = result.readings[0]!;
      expect(reading.ac_power_kw).toBeLessThanOrEqual(10 * 1.1); // ≤110% with jitter
    });
  });

  // ── 3. Successful real-API flow ────────────────────────────────────────

  describe('fetchReadings — real API flow', () => {
    it('returns a correctly normalized NormalizedReading from mock API', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(realtimeSuccessResponse()));

      const result = await sungrowAdapter.fetchReadings(VALID_INPUT);

      expect(result.readings).toHaveLength(1);
      expect(result.string_readings).toHaveLength(0);

      const reading = result.readings[0]!;
      expect(reading.ac_power_kw).toBe(4.8);
      expect(reading.dc_power_kw).toBe(4.9);
      expect(reading.ac_voltage_v).toBe(232.5);
      expect(reading.ac_current_a).toBe(20.6);
      expect(reading.ac_frequency_hz).toBe(50.01);
      expect(reading.temperature_c).toBe(42.3);
      expect(reading.energy_today_kwh).toBe(22.4);
      expect(reading.energy_total_kwh).toBe(15230.5);
      expect(reading.status).toBe('active'); // device_status '1' → 'active'
      expect(reading.error_code).toBeNull();
      // recorded_at must be a valid ISO timestamp
      expect(new Date(reading.recorded_at).getTime()).not.toBeNaN();
      // raw_payload must contain the original device row
      expect(reading.raw_payload['device_sn']).toBe('SN20001234');
    });

    it('makes exactly 1 fetch call (single POST to getDeviceRealTimeData)', async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce(realtimeSuccessResponse());
      vi.stubGlobal('fetch', mockFetch);

      await sungrowAdapter.fetchReadings(VALID_INPUT);

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('sends x-access-key and Authorization Bearer headers', async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce(realtimeSuccessResponse());
      vi.stubGlobal('fetch', mockFetch);

      await sungrowAdapter.fetchReadings(VALID_INPUT);

      const callHeaders = mockFetch.mock.calls[0]![1]?.headers as Record<string, string>;
      expect(callHeaders['x-access-key']).toBe(VALID_CREDENTIALS.api_key);
      expect(callHeaders['Authorization']).toBe(`Bearer ${VALID_CREDENTIALS.oauth_token}`);
    });

    it('sends ps_id and device_sn_list in the POST body', async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce(realtimeSuccessResponse());
      vi.stubGlobal('fetch', mockFetch);

      await sungrowAdapter.fetchReadings(VALID_INPUT);

      const callBody = JSON.parse(mockFetch.mock.calls[0]![1]?.body as string);
      expect(callBody.ps_id).toBe('ps_12345');
      expect(callBody.device_sn_list).toContain('SN20001234');
    });

    it('returns empty readings array when p_array is empty', async () => {
      const emptyBody = {
        result_code: '1',
        result_data: { p_array: [] },
      };
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValueOnce(
          new Response(JSON.stringify(emptyBody), { status: 200 }),
        ),
      );

      const result = await sungrowAdapter.fetchReadings(VALID_INPUT);
      expect(result.readings).toHaveLength(0);
    });

    it('maps all Sungrow status codes to normalized values', async () => {
      const statusCases: Array<[string, string]> = [
        ['1', 'active'],
        ['2', 'fault'],
        ['3', 'offline'],
        ['4', 'derated'],
        ['5', 'derated'],
      ];

      for (const [rawStatus, expectedStatus] of statusCases) {
        const body = {
          result_code: '1',
          result_data: {
            p_array: [{ device_sn: 'SN20001234', device_status: rawStatus }],
          },
        };
        vi.stubGlobal(
          'fetch',
          vi.fn().mockResolvedValueOnce(
            new Response(JSON.stringify(body), { status: 200 }),
          ),
        );

        const result = await sungrowAdapter.fetchReadings(VALID_INPUT);
        expect(result.readings[0]!.status).toBe(expectedStatus);
      }
    });

    it('converts update_time with space separator to valid ISO timestamp', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(realtimeSuccessResponse()));

      const result = await sungrowAdapter.fetchReadings(VALID_INPUT);
      const ts = result.readings[0]!.recorded_at;
      // Must be a valid ISO 8601 timestamp
      expect(new Date(ts).getTime()).not.toBeNaN();
      expect(ts).toContain('T');
    });
  });

  // ── 4. HTTP error responses ────────────────────────────────────────────

  describe('fetchReadings — HTTP errors', () => {
    it('throws AdapterError on HTTP 401', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValueOnce(new Response('Unauthorized', { status: 401 })),
      );

      await expect(sungrowAdapter.fetchReadings(VALID_INPUT)).rejects.toBeInstanceOf(AdapterError);
    });

    it('throws AdapterError on HTTP 403', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValueOnce(new Response('Forbidden', { status: 403 })),
      );

      await expect(sungrowAdapter.fetchReadings(VALID_INPUT)).rejects.toBeInstanceOf(AdapterError);
    });

    it('throws AdapterError when result_code is not 1', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValueOnce(
          realtimeErrorResponse('10001', 'Token expired'),
        ),
      );

      await expect(sungrowAdapter.fetchReadings(VALID_INPUT)).rejects.toBeInstanceOf(AdapterError);
    });

    it('throws AdapterError on network error (fetch rejection)', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockRejectedValueOnce(new TypeError('fetch failed')),
      );

      await expect(sungrowAdapter.fetchReadings(VALID_INPUT)).rejects.toBeInstanceOf(AdapterError);
    });
  });

  // ── 5. healthCheck ─────────────────────────────────────────────────────

  describe('healthCheck', () => {
    it('returns ok=false with message if api_key is missing', async () => {
      const result = await sungrowAdapter.healthCheck({ oauth_token: 'tok' });
      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/api_key/i);
    });

    it('returns ok=false with message if oauth_token is missing', async () => {
      const result = await sungrowAdapter.healthCheck({ api_key: 'key' });
      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/oauth_token/i);
    });

    it('returns ok=true in synthetic mode without calling fetch', async () => {
      process.env.SYNTHETIC_INVERTER_READINGS = '1';
      const result = await sungrowAdapter.healthCheck(VALID_CREDENTIALS);
      expect(result.ok).toBe(true);
      expect(result.message).toMatch(/synthetic/i);
      expect(fetch).not.toHaveBeenCalled();
    });

    it('returns ok=true when the plant list call succeeds', async () => {
      const successBody = {
        result_code: '1',
        result_data: {
          page_count: 1,
          row_count: 3,
          data: [{ ps_id: 'ps1' }, { ps_id: 'ps2' }, { ps_id: 'ps3' }],
        },
      };
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValueOnce(
          new Response(JSON.stringify(successBody), { status: 200 }),
        ),
      );

      const result = await sungrowAdapter.healthCheck(VALID_CREDENTIALS);
      expect(result.ok).toBe(true);
      expect(result.message).toMatch(/3/);
    });

    it('returns ok=false when the health check fetch fails', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockRejectedValueOnce(new TypeError('fetch failed')),
      );

      const result = await sungrowAdapter.healthCheck(VALID_CREDENTIALS);
      expect(result.ok).toBe(false);
    });

    it('returns ok=false when Sungrow returns a non-1 result_code', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValueOnce(
          realtimeErrorResponse('10001', 'Token expired'),
        ),
      );

      const result = await sungrowAdapter.healthCheck(VALID_CREDENTIALS);
      expect(result.ok).toBe(false);
    });
  });
});
