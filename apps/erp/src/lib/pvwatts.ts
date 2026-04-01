interface SimulationResult {
  monthly_kwh: number[];
  annual_kwh: number;
}

interface PVWattsParams {
  system_capacity: number;
  lat: number;
  lon: number;
  tilt: number;
  azimuth: number;
  module_type?: number;
  losses?: number;
}

export async function simulatePVOutput(params: PVWattsParams): Promise<SimulationResult> {
  const op = '[simulatePVOutput]';
  console.log(`${op} Starting for capacity: ${params.system_capacity} kWp`);

  // Try PVWatts first with 8s timeout
  try {
    const result = await fetchPVWatts(params);
    return result;
  } catch (pvwattsError) {
    console.error(`${op} PVWatts failed, trying PVLib fallback:`, {
      error: pvwattsError instanceof Error ? pvwattsError.message : String(pvwattsError),
    });
  }

  // Fallback to PVLib
  try {
    const result = await fetchPVLib(params);
    return result;
  } catch (pvlibError) {
    console.error(`${op} PVLib fallback also failed:`, {
      error: pvlibError instanceof Error ? pvlibError.message : String(pvlibError),
    });
    throw new Error(`${op} Both simulation services unavailable`);
  }
}

async function fetchPVWatts(params: PVWattsParams): Promise<SimulationResult> {
  const op = '[fetchPVWatts]';
  const apiKey = process.env.PVWATTS_API_KEY;
  if (!apiKey) throw new Error(`${op} Missing PVWATTS_API_KEY`);

  const url = new URL('https://developer.nrel.gov/api/pvwatts/v8.json');
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('system_capacity', String(params.system_capacity));
  url.searchParams.set('lat', String(params.lat));
  url.searchParams.set('lon', String(params.lon));
  url.searchParams.set('tilt', String(params.tilt));
  url.searchParams.set('azimuth', String(params.azimuth));
  url.searchParams.set('module_type', String(params.module_type ?? 1));
  url.searchParams.set('losses', String(params.losses ?? 14));
  url.searchParams.set('array_type', '1');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(url.toString(), { signal: controller.signal });
    if (!response.ok) throw new Error(`${op} HTTP ${response.status}`);
    const data = await response.json();
    return {
      monthly_kwh: data.outputs.ac_monthly,
      annual_kwh: data.outputs.ac_annual,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchPVLib(params: PVWattsParams): Promise<SimulationResult> {
  const op = '[fetchPVLib]';
  const url = process.env.PVLIB_MICROSERVICE_URL;
  if (!url) throw new Error(`${op} Missing PVLIB_MICROSERVICE_URL`);

  const response = await fetch(`${url}/simulate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_capacity: params.system_capacity,
      lat: params.lat,
      lon: params.lon,
      tilt: params.tilt,
      azimuth: params.azimuth,
      module_type: params.module_type ?? 1,
      losses: params.losses ?? 14,
    }),
  });

  if (!response.ok) throw new Error(`${op} HTTP ${response.status}`);
  const data = await response.json();
  return {
    monthly_kwh: data.monthly_kwh,
    annual_kwh: data.annual_kwh,
  };
}
