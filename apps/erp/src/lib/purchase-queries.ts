import { createClient } from '@repo/supabase/server';
import { getPurchaseOrders, getMSMEAlertPOs } from './procurement-queries';
import type { POListItem } from './procurement-queries';

export interface PurchaseDashboardData {
  pendingPOCount: number;
  activePOCount: number;
  pendingDeliveries: number;
  msmeAlertCount: number;
  recentPOs: POListItem[];
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

  // Fetch PO data and MSME alerts in parallel
  const [allPOs, msmeAlertPOs] = await Promise.all([
    getPurchaseOrders(),
    getMSMEAlertPOs(),
  ]);

  // Categorize POs
  const pendingPOCount = allPOs.filter((po) => po.status === 'draft' || po.status === 'pending_approval').length;
  const activePOCount = allPOs.filter((po) => po.status === 'approved' || po.status === 'partially_delivered').length;
  const pendingDeliveries = allPOs.filter(
    (po) => po.status === 'approved' && !po.actual_delivery_date,
  ).length;

  // Filter MSME alerts: 40+ days since delivery
  const today = Date.now();
  const msmeUrgent = msmeAlertPOs.filter((po) => {
    if (!po.actual_delivery_date) return false;
    const deliveryDate = new Date(po.actual_delivery_date);
    const daysSinceDelivery = Math.floor((today - deliveryDate.getTime()) / (1000 * 60 * 60 * 24));
    return daysSinceDelivery >= 40;
  });

  return {
    pendingPOCount,
    activePOCount,
    pendingDeliveries,
    msmeAlertCount: msmeUrgent.length,
    recentPOs: allPOs.slice(0, 10),
    msmeAlertPOs: msmeUrgent,
    employeeId,
  };
}
