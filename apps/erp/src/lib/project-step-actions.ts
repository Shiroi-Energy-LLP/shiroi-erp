/**
 * project-step-actions.ts — barrel re-export.
 *
 * Item 15a (2026-06-06): the original 2522-LOC monolith was split into 5
 * domain-specific sub-files. This barrel preserves all 17 consumer import
 * sites so callers can continue to write
 *   import { advanceProjectStatus } from '@/lib/project-step-actions';
 * while the implementations live in their right homes.
 *
 *   - project-survey-actions:        survey/site-info CRUD
 *   - project-bom-actions:           BOM lines + BOI version mgmt
 *   - project-boq-actions:           BOQ items + actuals + cost variance + price-book
 *   - project-commissioning-actions: commissioning reports + QC + advanceProjectStatus
 *   - project-dc-actions:            DC + delivery challan + milestone seed + employee dropdown
 *
 * Each child file declares its own `'use server'` directive; this barrel
 * does NOT — `export *` on a server-action module doesn't need its own
 * directive, and including it would force every re-exported symbol to be
 * an async function.
 */

export * from './project-survey-actions';
export * from './project-bom-actions';
export * from './project-boq-actions';
export * from './project-boq-pricing-actions';
export * from './project-boq-procurement-actions';
export * from './project-commissioning-actions';
export * from './project-qc-actions';
export * from './project-dc-actions';
export * from './project-milestone-actions';
