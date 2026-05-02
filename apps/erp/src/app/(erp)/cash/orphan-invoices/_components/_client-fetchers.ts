'use server';

import { getOrphansForCustomer, getCandidateProjectsForCustomer, searchAllProjects } from '@/lib/orphan-triage-queries';

export async function getOrphansForCustomerClient(name: string) {
  return getOrphansForCustomer(name);
}

export async function fetchCandidatesClient(name: string) {
  return getCandidateProjectsForCustomer(name);
}

export async function fetchAllProjectsClient(query: string) {
  return searchAllProjects(query);
}
