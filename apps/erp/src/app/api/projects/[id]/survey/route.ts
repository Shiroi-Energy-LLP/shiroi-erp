// apps/erp/src/app/api/projects/[id]/survey/route.ts
// Site Survey Report PDF generation
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@repo/supabase/server';
import { renderToBuffer } from '@react-pdf/renderer';
import { SurveyReportPDF, type SurveyReportPdfData } from '@/lib/pdf/survey-report-pdf';
import React from 'react';

// Photo field names from lead_site_surveys that map to site-photos bucket paths
const PHOTO_FIELDS = [
  'roof_condition_photo_path',
  'shadow_area_photo_path',
  'roof_photo_path',
  'site_overview_photo_path',
  'electrical_panel_photo_path',
  'meter_photo_path',
  'inverter_location_photo_path',
  'dc_routing_photo_path',
  'earthing_pit_photo_path',
  'la_location_photo_path',
  'termination_point_photo_path',
  'spare_feeder_photo_path',
  'spare_feeder_rating_photo_path',
  'dg_eb_photo_path',
  'ac_routing_photo_path',
] as const;

function dataUrlToBuffer(dataUrl: string | null): Buffer | null {
  if (!dataUrl) return null;
  const parts = dataUrl.split(',');
  if (parts.length !== 2 || !parts[1]) return null;
  return Buffer.from(parts[1], 'base64');
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const op = '[GET /api/projects/[id]/survey]';
  const { id: projectId } = await params;
  console.log(`${op} Generating Survey PDF for project: ${projectId}`);

  try {
    const supabase = await createClient();

    // Auth check
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    // Fetch project
    const { data: project, error: projErr } = await supabase
      .from('projects')
      .select('project_number, customer_name, site_address_line1, site_address_line2, site_city, site_state, site_pincode, lead_id')
      .eq('id', projectId)
      .single();

    if (projErr || !project) {
      console.error(`${op} Project not found:`, { projErr, projectId });
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    if (!project.lead_id) {
      console.warn(`${op} Project has no lead_id:`, { projectId });
      return NextResponse.json({ error: 'Project has no linked lead — survey unavailable' }, { status: 404 });
    }

    // Fetch most recent site survey for this lead
    const { data: survey, error: surveyErr } = await supabase
      .from('lead_site_surveys')
      .select('*')
      .eq('lead_id', project.lead_id)
      .order('survey_date', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (surveyErr) {
      console.error(`${op} Survey query failed:`, { surveyErr, leadId: project.lead_id });
      return NextResponse.json({ error: 'Failed to fetch survey data' }, { status: 500 });
    }

    if (!survey) {
      console.warn(`${op} No survey found for lead:`, { leadId: project.lead_id });
      return NextResponse.json({ error: 'No site survey found for this project' }, { status: 404 });
    }

    // Fetch surveyor name
    let surveyorName: string | null = null;
    if (survey.surveyed_by) {
      const { data: emp } = await supabase
        .from('employees')
        .select('full_name')
        .eq('id', survey.surveyed_by)
        .single();
      surveyorName = emp?.full_name ?? null;
    }

    // Build site address
    const siteAddress = [
      project.site_address_line1,
      project.site_address_line2,
      project.site_city,
      project.site_state,
      project.site_pincode,
    ].filter(Boolean).join(', ');

    // Format survey date
    const surveyDate = survey.survey_date
      ? new Date(survey.survey_date).toLocaleDateString('en-IN', {
          day: '2-digit', month: 'short', year: 'numeric',
        })
      : null;

    // Fetch all photos in parallel
    const photoEntries = await Promise.all(
      PHOTO_FIELDS.map(async (field) => {
        const path: string | null = (survey as any)[field] ?? null;
        if (!path) return [field, null] as [string, Buffer | null];

        const { data: signed } = await supabase.storage
          .from('site-photos')
          .createSignedUrl(path, 60);

        if (!signed?.signedUrl) return [field, null] as [string, Buffer | null];

        try {
          const resp = await fetch(signed.signedUrl);
          if (resp.ok) {
            return [field, Buffer.from(await resp.arrayBuffer())] as [string, Buffer];
          }
        } catch (fetchErr) {
          console.warn(`${op} Failed to fetch photo for ${field}:`, fetchErr);
        }
        return [field, null] as [string, Buffer | null];
      })
    );

    const photos: Record<string, Buffer | null> = Object.fromEntries(photoEntries);

    // Convert base64 signatures to Buffers
    const signatures: Record<string, Buffer | null> = {
      surveyor: dataUrlToBuffer((survey as any).surveyor_signature ?? null),
      customer: dataUrlToBuffer((survey as any).customer_signature ?? null),
    };

    // Build PDF data
    const pdfData: SurveyReportPdfData = {
      projectNumber: project.project_number,
      customerName: project.customer_name,
      siteAddress,
      surveyDate,
      surveyorName,
      // Section 1
      gpsLat: (survey as any).gps_lat ?? null,
      gpsLng: (survey as any).gps_lng ?? null,
      contactPersonName: (survey as any).contact_person_name ?? null,
      contactPhone: (survey as any).contact_phone ?? null,
      siteAccessNotes: (survey as any).site_access_notes ?? null,
      surveyStatus: (survey as any).survey_status ?? null,
      // Section 2
      roofType: (survey as any).roof_type ?? null,
      roofCondition: (survey as any).roof_condition ?? null,
      roofAgeYears: (survey as any).roof_age_years ?? null,
      roofOrientation: (survey as any).roof_orientation ?? null,
      roofTiltDegrees: (survey as any).roof_tilt_degrees ?? null,
      roofAreaSqft: (survey as any).roof_area_sqft ?? null,
      usableAreaSqft: (survey as any).usable_area_sqft ?? null,
      structureType: (survey as any).structure_type ?? null,
      mountingFeasibilityChecked: (survey as any).mounting_feasibility_checked ?? null,
      // Section 3
      existingLoadKw: (survey as any).existing_load_kw ?? null,
      sanctionedLoadKw: (survey as any).sanctioned_load_kw ?? null,
      meterType: (survey as any).meter_type ?? null,
      supplyVoltage: (survey as any).supply_voltage ?? null,
      discomName: (survey as any).discom_name ?? null,
      earthingType: (survey as any).earthing_type ?? null,
      earthingCondition: (survey as any).earthing_condition ?? null,
      netMeteringEligible: (survey as any).net_metering_eligible ?? null,
      // Section 4
      inverterLocation: (survey as any).inverter_location ?? null,
      dcRouting: null, // no separate dc_routing text field in schema; photo-only
      // Section 5
      shadeSources: (survey as any).shade_sources ?? null,
      morningShade: (survey as any).morning_shade ?? null,
      afternoonShade: (survey as any).afternoon_shade ?? null,
      shadingNotes: (survey as any).shading_notes ?? null,
      // Section 6
      recommendedSizeKwp: (survey as any).recommended_size_kwp ?? null,
      recommendedSystemType: (survey as any).recommended_system_type ?? null,
      estimatedGenerationKwhYear: (survey as any).estimated_generation_kwh_year ?? null,
      panelPlacementNotes: (survey as any).panel_placement_notes ?? null,
      cableRoutingNotes: (survey as any).cable_routing_notes ?? null,
      // Section 7
      additionalPanelsRequired: (survey as any).additional_panels_required ?? null,
      additionalPanelsRemarks: (survey as any).additional_panels_remarks ?? null,
      additionalInverterRequired: (survey as any).additional_inverter_required ?? null,
      additionalInverterRemarks: (survey as any).additional_inverter_remarks ?? null,
      routingChanges: (survey as any).routing_changes ?? null,
      cableSizeChanges: (survey as any).cable_size_changes ?? null,
      otherSpecialRequests: (survey as any).other_special_requests ?? null,
      // Section 8
      notes: (survey as any).notes ?? null,
      photos,
      signatures,
    };

    // Render PDF
    const pdfBuffer = await renderToBuffer(
      React.createElement(SurveyReportPDF, { data: pdfData }) as any
    );

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="Survey-Report-${project.project_number}.pdf"`,
      },
    });
  } catch (error) {
    console.error(`${op} Failed:`, {
      projectId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'PDF generation failed' },
      { status: 500 }
    );
  }
}
