import { Card, CardHeader, CardTitle, CardContent, Badge } from '@repo/ui';
import { formatDate } from '@repo/ui/formatters';
import { getStepSurveyData } from '@/lib/project-stepper-queries';
import { ClipboardList, Camera, MapPin, CheckCircle2, AlertTriangle, FileText } from 'lucide-react';
import { SurveyForm } from '@/components/projects/forms/survey-form';

interface StepSurveyProps {
  projectId: string;
}

export async function StepSurvey({ projectId }: StepSurveyProps) {
  const survey = await getStepSurveyData(projectId);

  return (
    <div>
      {/* Form: Create or Edit */}
      <SurveyForm projectId={projectId} existing={survey} />

      {/* Read-only display (shown when survey exists) */}
      {survey ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">

          {/* ── Section 1: Project Details ── */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="w-4 h-4 text-[#7C818E]" />
                1. Project Details
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <InfoRow label="Survey Date" value={survey?.survey_date ? formatDate(survey.survey_date) : null} />
              <InfoRow label="Contact Person" value={survey?.contact_person_name} />
              <InfoRow label="Contact Phone" value={survey?.contact_phone} />
              {(survey?.gps_lat || survey?.gps_lng) && (
                <div className="flex justify-between text-sm">
                  <span className="text-[#7C818E] flex items-center gap-1">
                    <MapPin className="w-3 h-3" />
                    GPS
                  </span>
                  <span className="font-medium text-[#1A1D24]">
                    {survey?.gps_lat && survey?.gps_lng
                      ? `${Number(survey.gps_lat).toFixed(6)}, ${Number(survey.gps_lng).toFixed(6)}`
                      : '\u2014'}
                  </span>
                </div>
              )}
              <InfoRow label="Site Access" value={survey?.site_access_notes} />
              <div className="flex justify-between text-sm items-center">
                <span className="text-[#7C818E]">Survey Status</span>
                <SurveyStatusBadge status={survey?.survey_status} />
              </div>
            </CardContent>
          </Card>

          {/* ── Section 2: Mounting & Site Feasibility ── */}
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-[#7C818E]" />
                2. Mounting & Site Feasibility
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3">
                <BoolRow label="Mounting Feasibility Checked" value={survey?.mounting_feasibility_checked} />
                <InfoRow label="Roof Type" value={survey?.roof_type?.replace(/_/g, ' ')} capitalize />
                <InfoRow label="Roof Condition" value={survey?.roof_condition} capitalize />
                <InfoRow label="Roof Age" value={survey?.roof_age_years ? `${survey.roof_age_years} years` : null} />
                <InfoRow label="Roof Orientation" value={survey?.roof_orientation?.replace(/_/g, ' ')} capitalize />
                <InfoRow label="Roof Tilt" value={survey?.roof_tilt_degrees ? `${survey.roof_tilt_degrees}\u00B0` : null} />
                <InfoRow label="Total Roof Area" value={survey?.roof_area_sqft ? `${survey.roof_area_sqft} sq.ft` : null} />
                <InfoRow label="Usable Area" value={survey?.usable_area_sqft ? `${survey.usable_area_sqft} sq.ft` : null} />
                <InfoRow label="Number of Floors" value={survey?.number_of_floors?.toString()} />
                <InfoRow label="Building Height" value={survey?.building_height_ft ? `${survey.building_height_ft} ft` : null} />
                <BoolRow label="Shadow Analysis Done" value={survey?.shadow_analysis_done} />
                <InfoRow label="Structure Type" value={survey?.structure_type?.replace(/_/g, ' ')} capitalize />
                <InfoRow label="Existing Structure Condition" value={survey?.existing_structure_condition?.replace(/_/g, ' ')} capitalize />
              </div>
              {/* Photo indicators */}
              {(survey?.roof_condition_photo_path || survey?.shadow_area_photo_path) && (
                <div className="mt-4 pt-3 border-t border-n-100 flex flex-wrap gap-4">
                  {survey?.roof_condition_photo_path && (
                    <PhotoIndicator label="Roof Condition Photo" />
                  )}
                  {survey?.shadow_area_photo_path && (
                    <PhotoIndicator label="Shadow Area Photo" />
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── Section 3: Client Discussion ── */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">3. Client Discussion</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <BoolRow label="Mounting Procedure Explained" value={survey?.mounting_procedure_explained} />
              <BoolRow label="Fixing Arrangement Discussed" value={survey?.fixing_arrangement_discussed} />
            </CardContent>
          </Card>

          {/* ── Section 4: Equipment Location Finalization ── */}
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">4. Equipment Location Finalization</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3">
                <EquipmentRow label="Inverter Location" finalized={survey?.inverter_location_finalized} photoPath={survey?.inverter_location_photo_path} />
                <EquipmentRow label="DC Cable Routing" finalized={survey?.dc_routing_finalized} photoPath={survey?.dc_routing_photo_path} />
                <EquipmentRow label="Earthing Pit" finalized={survey?.earthing_pit_finalized} photoPath={survey?.earthing_pit_photo_path} />
                <EquipmentRow label="Lightning Arrestor" finalized={survey?.la_location_finalized} photoPath={survey?.la_location_photo_path} />
                <EquipmentRow label="Termination Point" finalized={survey?.termination_point_finalized} photoPath={survey?.termination_point_photo_path} />
                <EquipmentRow label="Spare Feeder" finalized={survey?.spare_feeder_available} photoPath={survey?.spare_feeder_photo_path} />
                <EquipmentRow label="DG/EB Interconnection" finalized={survey?.dg_eb_checked} photoPath={survey?.dg_eb_photo_path} />
                <EquipmentRow label="Spare Feeder Rating" finalized={!!survey?.spare_feeder_rating} photoPath={survey?.spare_feeder_rating_photo_path} />
              </div>
              {survey?.spare_feeder_rating && (
                <div className="mt-4 pt-3 border-t border-n-100">
                  <InfoRow label="Spare Feeder Rating" value={survey.spare_feeder_rating} />
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── Section 5: AC Cable Routing ── */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">5. AC Cable Routing</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <BoolRow label="AC Routing Finalized" value={survey?.ac_routing_finalized} />
              {survey?.ac_routing_photo_path && (
                <PhotoIndicator label="AC Routing Photo" />
              )}
            </CardContent>
          </Card>

          {/* ── Section 6: Deviations & Special Requirements ── */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-[#7C818E]" />
                6. Deviations
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <BoolRow label="Additional Panels Required" value={survey?.additional_panels_required} />
              {survey?.additional_panels_remarks && (
                <InfoRow label="Panel Remarks" value={survey.additional_panels_remarks} />
              )}
              <BoolRow label="Additional Inverter Required" value={survey?.additional_inverter_required} />
              {survey?.additional_inverter_remarks && (
                <InfoRow label="Inverter Remarks" value={survey.additional_inverter_remarks} />
              )}
              <InfoRow label="Routing Changes" value={survey?.routing_changes} />
              <InfoRow label="Cable Size Changes" value={survey?.cable_size_changes} />
              <InfoRow label="Other Special Requests" value={survey?.other_special_requests} />
            </CardContent>
          </Card>

          {/* ── Section 7: Notes & Signatures ── */}
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">7. Notes & Signatures</CardTitle>
            </CardHeader>
            <CardContent>
              {survey?.notes ? (
                <div className="mb-4">
                  <span className="text-xs text-[#7C818E] block mb-1">Notes</span>
                  <p className="text-sm text-[#3F424D] whitespace-pre-wrap">{survey.notes}</p>
                </div>
              ) : (
                <div className="mb-4">
                  <span className="text-xs text-[#7C818E]">No notes recorded.</span>
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <span className="text-xs text-[#7C818E] block mb-1">Surveyor Signature</span>
                  {survey?.surveyor_signature ? (
                    <img src={survey.surveyor_signature} alt="Surveyor signature" className="border border-n-200 rounded h-24 bg-white" />
                  ) : (
                    <span className="text-sm text-[#7C818E]">{'\u2014'}</span>
                  )}
                </div>
                <div>
                  <span className="text-xs text-[#7C818E] block mb-1">Customer Signature</span>
                  {survey?.customer_signature ? (
                    <img src={survey.customer_signature} alt="Customer signature" className="border border-n-200 rounded h-24 bg-white" />
                  ) : (
                    <span className="text-sm text-[#7C818E]">{'\u2014'}</span>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-16">
          <ClipboardList className="w-12 h-12 text-[#7C818E] opacity-50 mb-3" />
          <h3 className="text-lg font-bold font-heading text-[#1A1D24] mb-1">No Site Survey Yet</h3>
          <p className="text-[13px] text-[#7C818E]">Click &quot;Create Site Survey&quot; above to add survey data for this project.</p>
        </div>
      )}
    </div>
  );
}

/* ─── Helper Components ─── */

function InfoRow({ label, value, capitalize: cap }: { label: string; value: string | null | undefined; capitalize?: boolean }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-[#7C818E]">{label}</span>
      <span className={`font-medium text-[#1A1D24] ${cap ? 'capitalize' : ''}`}>
        {value || '\u2014'}
      </span>
    </div>
  );
}

function BoolRow({ label, value }: { label: string; value: boolean | null | undefined }) {
  return (
    <div className="flex justify-between text-sm items-center">
      <span className="text-[#7C818E]">{label}</span>
      {value ? (
        <Badge variant="success">Yes</Badge>
      ) : (
        <Badge variant="neutral">No</Badge>
      )}
    </div>
  );
}

function EquipmentRow({ label, finalized, photoPath }: { label: string; finalized: boolean | null | undefined; photoPath: string | null | undefined }) {
  return (
    <div className="flex justify-between text-sm items-center">
      <span className="text-[#7C818E]">{label}</span>
      <span className="flex items-center gap-2">
        {finalized ? (
          <Badge variant="success">Yes</Badge>
        ) : (
          <Badge variant="neutral">No</Badge>
        )}
        {photoPath && (
          <span className="text-xs text-[#7C818E] flex items-center gap-1">
            <Camera className="w-3 h-3" />
            Photo attached
          </span>
        )}
      </span>
    </div>
  );
}

function PhotoIndicator({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-[#7C818E]">
      <Camera className="w-3.5 h-3.5" />
      {label}
    </span>
  );
}

function SurveyStatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) return <Badge variant="neutral">Unknown</Badge>;
  switch (status) {
    case 'approved':
      return <Badge variant="success">Approved</Badge>;
    case 'submitted':
      return <Badge variant="pending">Submitted</Badge>;
    case 'draft':
      return <Badge variant="neutral">Draft</Badge>;
    default:
      return <Badge variant="neutral">{status}</Badge>;
  }
}
