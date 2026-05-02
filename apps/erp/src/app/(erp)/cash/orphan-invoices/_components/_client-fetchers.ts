'use server';

import {
  getOrphansForCustomer,
  getCandidateProjectsForCustomer,
  searchAllProjects,
  getAttributionAudit,
  getOrphansByStatus,
} from '@/lib/orphan-triage-queries';

export async function getOrphansForCustomerClient(name: string) {
  return getOrphansForCustomer(name);
}

export async function fetchCandidatesClient(name: string) {
  return getCandidateProjectsForCustomer(name);
}

export async function fetchAllProjectsClient(query: string) {
  return searchAllProjects(query);
}

export async function fetchByStatus(status: 'deferred' | 'excluded') {
  return getOrphansByStatus(status);
}

export async function fetchAuditClient(opts: { page: number; decision?: string }) {
  return getAttributionAudit(opts);
}
