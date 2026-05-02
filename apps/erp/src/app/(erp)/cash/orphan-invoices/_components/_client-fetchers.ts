'use server';

import { getOrphansForCustomer } from '@/lib/orphan-triage-queries';

export async function getOrphansForCustomerClient(name: string) {
  return getOrphansForCustomer(name);
}
