/**
 * Growatt adapter tests — per-customer legacy server-api.growatt.com auth.
 *
 * Architecture (confirmed against real API 2026-05-23):
 *   - POST newTwoLoginAPI.do → session cookies + userId
 *   - GET PlantListAPI.do?userId=... → plant list (sanity check)
 *   - GET newTwoPlantAPI.do?op=getAllDeviceList&plantId=... → device list
 *   Device fields: deviceSn, deviceStatus, power (W as string), eToday (kWh), energy (kWh)
 *
 * Password hashing: MD5 hex, then replace '0' at even positions with 'c'.
 * See growattServer.hash_password Python reference.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { growattAdapter } from './growatt';
import { InvalidCredentialsError, AdapterError } from './base';

// ─── Test fixtures ────────────────────────────────────────────────────────

const VALID_CREDENTIALS = {
  username: 'Block - C',
  password: 'Fl0ur1sh@2026',
};

const VALID_INPUT = {
  credentials: VALID_CREDENTIALS,
  monitoring_site_id: '10467582',
  monitoring_device_id: 'VJHRE4U03K',
  since: null,
};

/** Mock login response — matches the real server-api.growatt.com shape. */
const LOGIN_SUCCESS_BODY = JSON.stringify({
  back: {
    success: true,
    user: {
      id: 3563822,
      accountName: 'Block - C',
      rightlevel: 0,
    },
    msg: '',
  },
});

/** Mock plant list response — plantId (not id) per confirmed API shape. */
const PLANT_LIST_BODY = JSON.stringify({
  back: {
    success: true,
    data: [
      {
        plantId: '10467582',
        plantName: 'Block - C',
        currentPower: '0 W',
        todayEnergy: '15 kWh',
        totalEnergy: '12225.9 kWh',
      },
    ],
  },
});

/** Mock device list response — from newTwoPlantAPI.do?op=getAllDeviceList */
const DEVICE_LIST_BODY = JSON.stringify({
  deviceList: [
    {
      deviceType: 'inverter',
      deviceSn: 'VJHRE4U03K',
      deviceStatus: 1,
      power: '500',
      eToday: '5.2',
      energy: '12300',
      powerStr: '0.5kW',
      lost: false,
    },
  ],
  totalEnergy: '12300 kWh',
  todayEnergy: '5.2 kWh',
});

/** Build a mock Response with Set-Cookie headers. */
function loginResponse(): Response {
  return new Response(LOGIN_SUCCESS_BODY, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': [
        'JSESSIONID=ABC123; Path=/; HttpOnly',
        'SERVERID=server1; Path=/',
        'SERVERCORSID=cors1; Path=/',
        'acw_tc=tc_value; Path=/',
      ].join(', '),
    },
  });
}

function plantListResponse(): Response {
  return new Response(PLANT_LIST_BODY, {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function deviceListResponse(): Response {
  return new Response(DEVICE_LIST_BODY, {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe('growattAdapter', () => {
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
    it('throws InvalidCredentialsError if username is missing', async () => {
      await expect(
        growattAdapter.fetchReadings({
          ...VALID_INPUT,
          credentials: { ...VALID_CREDENTIALS, username: undefined },
        }),
      ).rejects.toBeInstanceOf(InvalidCredentialsError);
    });

    it('throws InvalidCredentialsError if password is missing', async () => {
      await expect(
        growattAdapter.fetchReadings({
          ...VALID_INPUT,
          credentials: { ...VALID_CREDENTIALS, password: undefined },
        }),
      ).rejects.toBeInstanceOf(InvalidCredentialsError);
    });

    it('throws InvalidCredentialsError if monitoring_site_id is missing', async () => {
      await expect(
        growattAdapter.fetchReadings({
          ...VALID_INPUT,
          monitoring_site_id: null,
        }),
      ).rejects.toBeInstanceOf(InvalidCredentialsError);
    });

    it('throws InvalidCredentialsError if monitoring_device_id is missing', async () => {
      await expect(
        growattAdapter.fetchReadings({
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
      const result = await growattAdapter.fetchReadings(VALID_INPUT);
      expect(result.readings).toHaveLength(1);
      expect(result.string_readings).toHaveLength(0);
      expect(result.readings[0]!.raw_payload.source).toBe('synthetic');
      // fetch should NOT be called in synthetic mode
      expect(fetch).not.toHaveBeenCalled();
    });
  });

  // ── 3. Successful real-API flow ────────────────────────────────────────

  describe('fetchReadings — real API flow', () => {
    it('returns a correctly normalized NormalizedReading from mock API calls', async () => {
      const mockFetch = vi.fn()
        .mockResolvedValueOnce(loginResponse())
        .mockResolvedValueOnce(plantListResponse())
        .mockResolvedValueOnce(deviceListResponse());
      vi.stubGlobal('fetch', mockFetch);

      const result = await growattAdapter.fetchReadings(VALID_INPUT);

      expect(result.readings).toHaveLength(1);
      expect(result.string_readings).toHaveLength(0);

      const reading = result.readings[0]!;
      // power: '500' W → 0.5 kW
      expect(reading.ac_power_kw).toBe(0.5);
      // eToday: '5.2' kWh
      expect(reading.energy_today_kwh).toBe(5.2);
      // energy: '12300' kWh
      expect(reading.energy_total_kwh).toBe(12300);
      // deviceStatus: 1 → 'active'
      expect(reading.status).toBe('active');
      // recorded_at must be a valid ISO string
      expect(new Date(reading.recorded_at).getTime()).not.toBeNaN();
      // raw_payload must contain the device object
      expect(reading.raw_payload['deviceSn']).toBe('VJHRE4U03K');
    });

    it('makes exactly 3 fetch calls (login + plant list + device list)', async () => {
      const mockFetch = vi.fn()
        .mockResolvedValueOnce(loginResponse())
        .mockResolvedValueOnce(plantListResponse())
        .mockResolvedValueOnce(deviceListResponse());
      vi.stubGlobal('fetch', mockFetch);

      await growattAdapter.fetchReadings(VALID_INPUT);

      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('sends session cookies from login response on subsequent requests', async () => {
      const mockFetch = vi.fn()
        .mockResolvedValueOnce(loginResponse())
        .mockResolvedValueOnce(plantListResponse())
        .mockResolvedValueOnce(deviceListResponse());
      vi.stubGlobal('fetch', mockFetch);

      await growattAdapter.fetchReadings(VALID_INPUT);

      // The 2nd call (plant list) must include Cookie header
      const secondCallHeaders = mockFetch.mock.calls[1]![1]?.headers as Record<string, string>;
      expect(secondCallHeaders?.['Cookie']).toContain('JSESSIONID=ABC123');

      // The 3rd call (device list) must also include Cookie header
      const thirdCallHeaders = mockFetch.mock.calls[2]![1]?.headers as Record<string, string>;
      expect(thirdCallHeaders?.['Cookie']).toContain('JSESSIONID=ABC123');
    });

    it('hashes the password with MD5 + growatt c-substitution before sending', async () => {
      const mockFetch = vi.fn()
        .mockResolvedValueOnce(loginResponse())
        .mockResolvedValueOnce(plantListResponse())
        .mockResolvedValueOnce(deviceListResponse());
      vi.stubGlobal('fetch', mockFetch);

      await growattAdapter.fetchReadings(VALID_INPUT);

      // First call is login: check that the body contains hashed password, not plaintext
      const loginCall = mockFetch.mock.calls[0]!;
      const loginBody = loginCall[1]?.body as string;
      // 'Fl0ur1sh@2026' → MD5 = 72ea694989c3d2fa5f66ed36c303f918
      // After c-substitution at even positions: 72ea694989c3d2fa5f66ed36c3c3f918
      expect(loginBody).toContain('72ea694989c3d2fa5f66ed36c3c3f918');
      // Must NOT contain the plaintext password
      expect(loginBody).not.toContain('Fl0ur1sh@2026');
    });

    it('calls the login endpoint with POST and form-urlencoded content-type', async () => {
      const mockFetch = vi.fn()
        .mockResolvedValueOnce(loginResponse())
        .mockResolvedValueOnce(plantListResponse())
        .mockResolvedValueOnce(deviceListResponse());
      vi.stubGlobal('fetch', mockFetch);

      await growattAdapter.fetchReadings(VALID_INPUT);

      const loginCall = mockFetch.mock.calls[0]!;
      expect(loginCall[0]).toContain('newTwoLoginAPI.do');
      expect(loginCall[1]?.method).toBe('POST');
      const contentType = (loginCall[1]?.headers as Record<string, string>)?.['Content-Type'];
      expect(contentType).toContain('application/x-www-form-urlencoded');
    });
  });

  // ── 4. Login failure ───────────────────────────────────────────────────

  describe('fetchReadings — login failure', () => {
    it('throws AdapterError when login back.success is false', async () => {
      const failBody = JSON.stringify({
        back: {
          success: false,
          error: 'Username or Password Error',
          msg: 'Username or Password Error',
        },
      });
      const mockFetch = vi.fn().mockResolvedValueOnce(
        new Response(failBody, { status: 200 }),
      );
      vi.stubGlobal('fetch', mockFetch);

      await expect(
        growattAdapter.fetchReadings(VALID_INPUT),
      ).rejects.toBeInstanceOf(AdapterError);
    });
  });

  // ── 5. healthCheck ─────────────────────────────────────────────────────

  describe('healthCheck', () => {
    it('returns ok=false with message if username missing', async () => {
      const result = await growattAdapter.healthCheck({ password: 'pass' });
      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/username/i);
    });

    it('returns ok=false with message if password missing', async () => {
      const result = await growattAdapter.healthCheck({ username: 'user' });
      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/password/i);
    });

    it('returns ok=true with plant count when login succeeds', async () => {
      const mockFetch = vi.fn()
        .mockResolvedValueOnce(loginResponse())
        .mockResolvedValueOnce(plantListResponse());
      vi.stubGlobal('fetch', mockFetch);

      const result = await growattAdapter.healthCheck(VALID_CREDENTIALS);
      expect(result.ok).toBe(true);
      expect(result.message).toMatch(/1 plant/i);
      expect(result.vendor_api_version).toBe('legacy server-api');
    });

    it('returns ok=true in synthetic mode without calling fetch', async () => {
      process.env.SYNTHETIC_INVERTER_READINGS = '1';
      const result = await growattAdapter.healthCheck(VALID_CREDENTIALS);
      expect(result.ok).toBe(true);
      expect(result.message).toMatch(/synthetic/i);
      expect(fetch).not.toHaveBeenCalled();
    });

    it('returns ok=false when login fails', async () => {
      const failBody = JSON.stringify({
        back: { success: false, msg: 'Bad password' },
      });
      const mockFetch = vi.fn().mockResolvedValueOnce(
        new Response(failBody, { status: 200 }),
      );
      vi.stubGlobal('fetch', mockFetch);

      const result = await growattAdapter.healthCheck(VALID_CREDENTIALS);
      expect(result.ok).toBe(false);
    });
  });
});
