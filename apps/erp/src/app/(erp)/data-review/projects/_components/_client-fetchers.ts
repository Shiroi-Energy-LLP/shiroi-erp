'use server';
// apps/erp/src/app/(erp)/data-review/projects/_components/_client-fetchers.ts
// Thin 'use server' wrappers so client components (duplicate-search, audit-log-tab)
// can call server-only query functions without importing next/headers directly.

import {
  searchProjectsForDuplicate,
  getProjectScoreForDuplicateConfirm,
  getProjectReviewAudit,
} from '@/lib/data-review-queries';

export async function fetchDuplicateCandidates(query: string, excludeId: string) {
  return searchProjectsForDuplicate(query, excludeId);
}

export async function fetchProjectScore(projectId: string) {
  return getProjectScoreForDuplicateConfirm(projectId);
}

export async function fetchAuditLog(opts: { page: number; pageSize: number }) {
  return getProjectReviewAudit(opts);
}
