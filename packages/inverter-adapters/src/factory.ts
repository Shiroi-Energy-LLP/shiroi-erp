/**
 * Brand → adapter factory. Called by the poller Edge Function for
 * each inverter it processes.
 */
import type { InverterAdapter, InverterBrand } from './base';
import { sungrowAdapter } from './sungrow';
import { growattAdapter } from './growatt';
import { smaAdapter } from './sma';
import { huaweiAdapter } from './huawei';

const ADAPTERS: Record<InverterBrand, InverterAdapter> = {
  sungrow: sungrowAdapter,
  growatt: growattAdapter,
  sma: smaAdapter,
  huawei: huaweiAdapter,
  fronius: sungrowAdapter, // placeholder — Fronius falls back to Sungrow until we build a dedicated adapter
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
