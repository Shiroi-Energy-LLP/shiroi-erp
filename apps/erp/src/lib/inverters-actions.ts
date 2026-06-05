'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient } from '@repo/supabase/server';
import { ok, err, type ActionResult } from '@/lib/types/actions';
import type { Database } from '@repo/types/database';
import { getAdapter } from '@repo/inverter-adapters/factory';
import type { AdapterCredentials } from '@repo/inverter-adapters/base';

// ═══════════════════════════════════════════════════════════════════════
// Row types
// ═══════════════════════════════════════════════════════════════════════

type InverterInsert = Database['public']['Tables']['inverters']['Insert'];
type InverterUpdate = Database['public']['Tables']['inverters']['Update'];

// ═══════════════════════════════════════════════════════════════════════
// Brand list (matches migration 116 CHECK constraint + factory.ts)
// ═══════════════════════════════════════════════════════════════════════

const INVERTER_BRANDS = [
  'sungrow', 'growatt', 'sma', 'huawei', 'fronius',
  'solarman', 'goodwe', 'fimer', 'polycab', 'havells', 'flin_energy', 'other',
] as const;

type InverterBrand = typeof INVERTER_BRANDS[number];

// ═══════════════════════════════════════════════════════════════════════
// Zod schemas
// ═══════════════════════════════════════════════════════════════════════

const createInverterSchema = z.object({
  project_id: z.string().uuid('Project is required'),
  brand: z.enum(INVERTER_BRANDS, { message: 'Brand is required' }),
  serial_number: z.string().min(3, 'Serial number must be at least 3 characters').max(100),
  model: z.string().max(100).optional(),
  rated_capacity_kw: z.coerce.number().positive('Rated capacity must be positive').max(10000),
  string_count: z.coerce.number().int().min(1).max(40).default(1),
  monitoring_credentials_id: z.string().uuid().nullable().optional(),
  monitoring_site_id: z.string().max(100).nullable().optional(),
  monitoring_device_id: z.string().max(100).nullable().optional(),
  polling_interval_minutes: z.coerce.number().int().min(5).max(120).default(15),
  polling_enabled: z.coerce.boolean().default(true),
});

const updateInverterSchema = createInverterSchema.partial().extend({
  // Allow partial updates; no field is required
});

// ═══════════════════════════════════════════════════════════════════════
// createInverter
// ═══════════════════════════════════════════════════════════════════════

export async function createInverter(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const op = '[createInverter]';

  const parsed = createInverterSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return err(first?.message ?? 'Invalid input', 'VALIDATION');
  }

  const d = parsed.data;
  const supabase = await createClient();

  const insert: InverterInsert = {
    project_id: d.project_id,
    brand: d.brand,
    serial_number: d.serial_number,
    model: d.model ?? null,
    rated_capacity_kw: d.rated_capacity_kw,
    string_count: d.string_count,
    monitoring_credentials_id: d.monitoring_credentials_id ?? null,
    monitoring_site_id: d.monitoring_site_id ?? null,
    monitoring_device_id: d.monitoring_device_id ?? null,
    polling_interval_minutes: d.polling_interval_minutes,
    polling_enabled: d.polling_enabled,
  };

  const { data, error } = await supabase
    .from('inverters')
    .insert(insert)
    .select('id')
    .single();

  if (error || !data) {
    console.error(`${op} failed`, { error: error?.message, code: error?.code, timestamp: new Date().toISOString() });
    if (error?.code === '23505') {
      return err('An inverter with this brand and serial number already exists', error.code);
    }
    return err(error?.message ?? 'Failed to create inverter', error?.code);
  }

  revalidatePath('/om/inverters');
  return ok({ id: data.id });
}

// ═══════════════════════════════════════════════════════════════════════
// updateInverter
// ═══════════════════════════════════════════════════════════════════════

export async function updateInverter(
  id: string,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const op = '[updateInverter]';

  if (!id) return err('Inverter id is required');

  const parsed = updateInverterSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return err(first?.message ?? 'Invalid input', 'VALIDATION');
  }

  const d = parsed.data;
  const supabase = await createClient();

  const patch: InverterUpdate = {};
  if (d.project_id !== undefined) patch.project_id = d.project_id;
  if (d.brand !== undefined) patch.brand = d.brand;
  if (d.serial_number !== undefined) patch.serial_number = d.serial_number;
  if (d.model !== undefined) patch.model = d.model ?? null;
  if (d.rated_capacity_kw !== undefined) patch.rated_capacity_kw = d.rated_capacity_kw;
  if (d.string_count !== undefined) patch.string_count = d.string_count;
  if (d.monitoring_credentials_id !== undefined) patch.monitoring_credentials_id = d.monitoring_credentials_id ?? null;
  if (d.monitoring_site_id !== undefined) patch.monitoring_site_id = d.monitoring_site_id ?? null;
  if (d.monitoring_device_id !== undefined) patch.monitoring_device_id = d.monitoring_device_id ?? null;
  if (d.polling_interval_minutes !== undefined) patch.polling_interval_minutes = d.polling_interval_minutes;
  if (d.polling_enabled !== undefined) patch.polling_enabled = d.polling_enabled;

  const { data, error } = await supabase
    .from('inverters')
    .update(patch)
    .eq('id', id)
    .select('id')
    .single();

  if (error || !data) {
    console.error(`${op} failed`, { id, error: error?.message, code: error?.code, timestamp: new Date().toISOString() });
    if (error?.code === '23505') {
      return err('An inverter with this brand and serial number already exists', error.code);
    }
    return err(error?.message ?? 'Failed to update inverter', error?.code);
  }

  revalidatePath('/om/inverters');
  return ok({ id: data.id });
}

// ═══════════════════════════════════════════════════════════════════════
// healthCheckInverter
//
// Per-brand credential resolution:
//   Growatt → reads username/password from plant_monitoring_credentials
//             matched by project_id (per-customer architecture)
//   Sungrow → reads access_token + api_base from inverter_monitoring_credentials.config
//   Others  → synthetic-only (returns ok with note)
// ═══════════════════════════════════════════════════════════════════════

export async function healthCheckInverter(
  inverterId: string,
): Promise<ActionResult<{ ok: boolean; message?: string }>> {
  const op = '[healthCheckInverter]';

  if (!inverterId) return err('Inverter id is required');

  const supabase = await createClient();

  // 1. Load the inverter row
  const { data: inverter, error: invErr } = await supabase
    .from('inverters')
    .select('*')
    .eq('id', inverterId)
    .maybeSingle();

  if (invErr || !inverter) {
    console.error(`${op} inverter not found`, { inverterId, error: invErr?.message, timestamp: new Date().toISOString() });
    return err(invErr?.message ?? 'Inverter not found');
  }

  const brand = inverter.brand as InverterBrand;
  const ratedCapacityKw = Number(inverter.rated_capacity_kw);

  // 2. Build AdapterCredentials per brand
  let credentials: AdapterCredentials;

  try {
    if (brand === 'growatt') {
      // Per-customer architecture: read credentials via SECURITY DEFINER RPC
      // (post-mig-158 the password column is encrypted; the RPC decrypts it
      // server-side for service_role callers).
      if (!inverter.project_id) {
        return ok({
          ok: false,
          message: 'Inverter has no project_id; cannot look up Growatt credential.',
        });
      }
      const { data: credRows, error: plantErr } = await (supabase.rpc as any)(
        'get_growatt_creds_for_project',
        { p_project_id: inverter.project_id }
      );

      const plantCred = Array.isArray(credRows) ? credRows[0] : credRows;
      if (plantErr || !plantCred || !plantCred.username || !plantCred.password) {
        return ok({
          ok: false,
          message: 'No Growatt plant_monitoring_credentials found for this project. Add credentials under Plant Monitoring first.',
        });
      }

      credentials = {
        username: plantCred.username,
        password: plantCred.password,
        rated_capacity_kw: String(ratedCapacityKw),
      };
    } else if (brand === 'sungrow') {
      // Master OAuth token from inverter_monitoring_credentials
      const { data: monCred, error: monErr } = await supabase
        .from('inverter_monitoring_credentials')
        .select('config')
        .eq('brand', 'sungrow')
        .limit(1)
        .maybeSingle();

      if (monErr || !monCred) {
        return ok({
          ok: false,
          message: 'No Sungrow monitoring credential found. Authorize Sungrow under Plant Monitoring first.',
        });
      }

      const config = monCred.config as Record<string, unknown> | null;
      const accessToken = config?.['access_token'] as string | undefined;
      const apiBase = config?.['api_base'] as string | undefined;
      const appKey = process.env['SUNGROW_APPKEY'];

      if (!accessToken) {
        return ok({ ok: false, message: 'Sungrow not authorized — access_token missing. Re-authorize under Plant Monitoring.' });
      }

      credentials = {
        api_key: appKey,
        oauth_token: accessToken,
        endpoint_url: apiBase,
        rated_capacity_kw: String(ratedCapacityKw),
      };
    } else {
      // For brands without real API access yet, return synthetic success
      // (sma, huawei, fronius, solarman, goodwe, fimer, polycab, havells, flin_energy, other)
      return ok({
        ok: true,
        message: `${brand} adapter is in synthetic mode — real API access pending registration.`,
      });
    }

    // 3. Call adapter.healthCheck
    const adapter = getAdapter(brand);
    const result = await adapter.healthCheck(credentials);

    return ok({ ok: result.ok, message: result.message });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    console.error(`${op} threw`, { inverterId, brand, error: msg, timestamp: new Date().toISOString() });
    return ok({ ok: false, message: msg });
  }
}
