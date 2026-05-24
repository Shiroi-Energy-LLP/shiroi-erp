/**
 * Brand → adapter factory. Called by the poller Edge Function for
 * each inverter it processes.
 */
import type { InverterAdapter, InverterBrand } from './base';
import { sungrowAdapter } from './sungrow';
import { growattAdapter } from './growatt';
import { smaAdapter } from './sma';
import { huaweiAdapter } from './huawei';
import { solarmanAdapter } from './solarman';
import { goodweAdapter } from './goodwe';

const ADAPTERS: Record<InverterBrand, InverterAdapter> = {
  sungrow: sungrowAdapter,
  growatt: growattAdapter,
  sma: smaAdapter,
  huawei: huaweiAdapter,
  fronius: sungrowAdapter,      // placeholder fallback
  solarman: solarmanAdapter,
  goodwe: goodweAdapter,
  fimer: sungrowAdapter,        // placeholder fallback (skipped — no current install volume)
  polycab: sungrowAdapter,      // placeholder fallback (skipped — no current install volume)
  havells: sungrowAdapter,      // placeholder fallback (skipped — no current install volume)
  flin_energy: sungrowAdapter,  // placeholder fallback (skipped — no current install volume)
};

export function getAdapter(brand: InverterBrand): InverterAdapter {
  const adapter = ADAPTERS[brand];
  if (!adapter) {
    throw new Error(`Unknown inverter brand: ${brand}`);
  }
  return adapter;
}

export function allBrands(): InverterBrand[] {
  return Object.keys(ADAPTERS) as InverterBrand[];
}
