/**
 * project-activities-constants.ts — shared label maps for the Activities
 * module. Client-safe: no server imports allowed in this file (NEVER-DO #21).
 */

export type ManpowerType = 'se' | 'os' | 'contractor';

export const MANPOWER_LABELS: Record<ManpowerType, string> = {
  se: 'SE (Shiroi)',
  os: 'OS (Outsourced)',
  contractor: 'Contractor',
};

export const MANPOWER_ORDER: ManpowerType[] = ['se', 'os', 'contractor'];

export interface ActivityStageOption {
  id: string;
  label: string;
}

/** Shape shared by the project sub-tab and the global /activities page. */
export interface ProjectActivityRow {
  id: string;
  project_id: string;
  activity_date: string;
  stage_id: string | null;
  stage_label: string | null;
  done_by: string | null;
  description: string;
  se_count: number;
  os_count: number;
  contractor_count: number;
  notes: string | null;
  created_by_name: string | null;
  // Global view extras (null on the per-project tab)
  project_number: string | null;
  project_customer: string | null;
}

export interface ActivitiesSummary {
  total_activities: number;
  total_se: number;
  total_os: number;
  total_contractor: number;
  distinct_projects: number;
}
