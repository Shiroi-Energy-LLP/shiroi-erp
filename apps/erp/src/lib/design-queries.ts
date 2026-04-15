/**
 * Queries for the per-lead design workspace at /design/[leadId].
 *
 * Extracted from `app/(erp)/design/[leadId]/page.tsx` so the page file
 * doesn't make inline Supabase calls (CLAUDE.md NEVER-DO rule #15).
 *
 * The page orchestrates these in parallel via Promise.all and then passes
 * the results into presentational components (LeadFilesPanel, BomPicker,
 * DesignNotesEditor).
 */
import { createClient } from '@repo/supabase/server';
import type { Database } from '@repo/types/database';
import type { BomLineRow, PriceBookOption } from '@/components/sales/bom-picker';

type LeadStatus = Database['public']['Enums']['lead_status'];

export interface SurveySnapshot {
  id: string;
  survey_date: string | null;
  survey_status: string | null;
  roof_type: string | null;
  roof_area_sqft: number | null;
  usable_area_sqft: number | null;
  recommended_size_kwp: number | null;
  contact_person_name: string | null;
  notes: string | null;
  gps_lat: number | null;
  gps_lng: number | null;
}

export interface LeadDesignMeta {
  draft_proposal_id: string | null;
  design_notes: string | null;
  status: LeadStatus;
}

export interface DesignWorkspaceData {
  survey: SurveySnapshot | null;
  leadMeta: LeadDesignMeta | null;
  priceBookItems: PriceBookOption[];
}

/**
 * Fetches the three parallel reads the design workspace header needs:
 *   1. Most recent survey for the lead (may be null)
 *   2. Lead's draft_proposal_id + design_notes + status
 *   3. Active price book items (for the BomPicker dropdown)
 */
export async function getDesignWorkspaceData(leadId: string): Promise<DesignWorkspaceData> {
  const op = '[getDesignWorkspaceData]';
  console.log(`${op} Starting for lead: ${leadId}`);
  const supabase = await createClient();

  const [surveyResult, leadMetaResult, priceBookResult] = await Promise.all([
    supabase
      .from('lead_site_surveys')
      .select(
        'id, survey_date, survey_status, roof_type, roof_area_sqft, usable_area_sqft, recommended_size_kwp, contact_person_name, notes, gps_lat, gps_lng',
      )
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('leads')
      .select('draft_proposal_id, design_notes, status')
      .eq('id', leadId)
      .maybeSingle(),
    supabase
      .from('price_book')
      .select('id, item_category, item_description, brand, unit, base_price')
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('item_category')
      .order('base_price', { ascending: true }),
  ]);

  if (surveyResult.error) {
    console.error(`${op} survey query failed:`, surveyResult.error);
  }
  if (leadMetaResult.error) {
    console.error(`${op} lead meta query failed:`, leadMetaResult.error);
  }
  if (priceBookResult.error) {
    console.error(`${op} price book query failed:`, priceBookResult.error);
  }

  return {
    survey: surveyResult.data as SurveySnapshot | null,
    leadMeta: leadMetaResult.data as LeadDesignMeta | null,
    priceBookItems: (priceBookResult.data ?? []) as PriceBookOption[],
  };
}

/**
 * Fetches BOM lines for the draft proposal, ordered by line_number.
 * Returns [] if proposalId is null (lead hasn't entered Path B yet).
 */
export async function getProposalBomLines(
  proposalId: string | null,
): Promise<BomLineRow[]> {
  if (!proposalId) return [];
  const op = '[getProposalBomLines]';
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('proposal_bom_lines')
    .select(
      'id, item_category, item_description, brand, unit, quantity, unit_price, total_price, price_book_id',
    )
    .eq('proposal_id', proposalId)
    .order('line_number');

  if (error) {
    console.error(`${op} failed:`, error);
    return [];
  }
  return (data ?? []) as BomLineRow[];
}
