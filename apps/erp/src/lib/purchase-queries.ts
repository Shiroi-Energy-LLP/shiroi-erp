import { createClient } from '@repo/supabase/server';

import { MS_PER_DAY } from '@/lib/helpers/time-helpers';

import { getPurchaseOrders, getPurchaseOrderStatusCounts, getMSMEAlertPOs } from './procurement-queries';
import type { POListItem, POListRow } from './procurement-queries';

const RECENT_PO_LIMIT = 10;

export interface PurchaseDashboardData {
  pendingPOCount: number;
  activePOCount: number;
  pendingDeliveries: number;
  msmeAlertCount: number;
  recentPOs: POListRow[];
  msmeAlertPOs: POListItem[];
  employeeId: string | null;
}

export async function getPurchaseDashboardData(profileId: string): Promise<PurchaseDashboardData> {
  const op = '[getPurchaseDashboardData]';
  console.log(`${op} Starting for: ${profileId}`);

  const supabase = await createClient();

  // Get employee ID
  const { data: emp, error: empError } = await supabase
    .from('employees')
    .select('id')
    .eq('profile_id', profileId)
    .eq('is_active', true)
    .single();

  if (empError) {
    console.error(`${op} Employee lookup failed:`, { code: empError.code, message: empError.message, profileId });
  }
  const employeeId = emp?.id ?? null;

  // Status KPIs come from a single COUNT(*) FILTER RPC over the FULL table — the
  // old path derived them from a .limit(100)-capped getPurchaseOrders() fetch and
  // undercounted (NEVER-DO #12/#13). Recent POs + MSME alerts fetched in parallel.
  const [counts, recent, msmeAlertPOs] = await Promise.all([
    getPurchaseOrderStatusCounts(),
    getPurchaseOrders({ page: 1, per_page: RECENT_PO_LIMIT }),
    getMSMEAlertPOs(),
  ]);

  const { pendingPOCount, activePOCount, pendingDeliveries } = counts;

  // Filter MSME alerts: 40+ days since delivery
  const today = Date.now();
  const msmeUrgent = msmeAlertPOs.filter((po) => {
    if (!po.actual_delivery_date) return false;
    const deliveryDate = new Date(po.actual_delivery_date);
    const daysSinceDelivery = Math.floor((today - deliveryDate.getTime()) / MS_PER_DAY);
    return daysSinceDelivery >= 40;
  });

  return {
    pendingPOCount,
    activePOCount,
    pendingDeliveries,
    msmeAlertCount: msmeUrgent.length,
    recentPOs: recent.rows,
    msmeAlertPOs: msmeUrgent,
    employeeId,
  };
}
