import { Card, CardHeader, CardTitle, CardContent } from '@repo/ui';
import { formatDate } from '@repo/ui/formatters';
import { getStepSurveyData } from '@/lib/project-stepper-queries';
import { ClipboardList } from 'lucide-react';
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Section 1: Site Info */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">1. Site Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <InfoRow label="Survey Date" value={formatDate(survey.survey_date)} />
              <InfoRow label="Contact Person" value={survey.contact_person_name} />
              <InfoRow label="Contact Phone" value={survey.contact_phone} />
              {(survey.gps_lat || survey.gps_lng) && (
                <InfoRow
                  label="GPS"
                  value={survey.gps_lat && survey.gps_lng
                    ? `${Number(survey.gps_lat).toFixed(6)}, ${Number(survey.gps_lng).toFixed(6)}`
                    : null}
                />
              )}
              <InfoRow label="Site Access" value={survey.site_access_notes} />
            </CardContent>
          </Card>

          {/* Section 2: Roof */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">2. Roof Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <InfoRow label="Roof Type" value={survey.roof_type?.replace(/_/g, ' ')} capitalize />
              <InfoRow label="Condition" value={survey.roof_condition} capitalize />
              <InfoRow label="Age" value={survey.roof_age_years ? `${survey.roof_age_years} years` : null} />
              <InfoRow label="Orientation" value={survey.roof_orientation?.replace(/_/g, ' ')} capitalize />
              <InfoRow label="Tilt" value={survey.roof_tilt_degrees ? `${survey.roof_tilt_degrees}°` : null} />
              <InfoRow label="Total Area" value={survey.roof_area_sqft ? `${survey.roof_area_sqft} sq.ft` : null} />
              <InfoRow label="Usable Area" value={survey.usable_area_sqft ? `${survey.usable_area_sqft} sq.ft` : null} />
              <InfoRow label="Floors" value={survey.number_of_floors?.toString()} />
              <InfoRow label="Height" value={survey.building_height_ft ? `${survey.building_height_ft} ft` : null} />
            </CardContent>
          </Card>

          {/* Section 3: Structure */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">3. Structure</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <InfoRow label="Structure Type" value={survey.structure_type?.replace(/_/g, ' ')} capitalize />
              <InfoRow label="Condition" value={survey.existing_structure_condition?.replace(/_/g, ' ')} capitalize />
            </CardContent>
          </Card>

          {/* Section 4: Electrical */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">4. Electrical & Load</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <InfoRow label="Existing Load" value={survey.existing_load_kw ? `${survey.existing_load_kw} kW` : null} />
              <InfoRow label="Sanctioned Load" value={survey.sanctioned_load_kw ? `${survey.sanctioned_load_kw} kW` : null} />
              <InfoRow label="Meter Type" value={survey.meter_type?.replace(/_/g, ' ')} capitalize />
              <InfoRow label="Supply Voltage" value={survey.supply_voltage?.replace(/_/g, ' ')} />
              <InfoRow label="DISCOM" value={survey.discom_name} />
              <InfoRow label="Earthing Type" value={survey.earthing_type} capitalize />
              <InfoRow label="Earthing Condition" value={survey.earthing_condition?.replace(/_/g, ' ')} capitalize />
              <InfoRow label="Net Metering" value={survey.net_metering_eligible === null ? null : survey.net_metering_eligible ? 'Yes' : 'No'} />
            </CardContent>
          </Card>

          {/* Section 5: Shading */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">5. Shading Analysis</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <InfoRow label="Overall" value={survey.shading_assessment?.replace(/_/g, ' ')} capitalize />
              {survey.shade_sources && (survey.shade_sources as string[]).length > 0 && (
                <InfoRow label="Sources" value={(survey.shade_sources as string[]).map(s => s.replace(/_/g, ' ')).join(', ')} capitalize />
              )}
              <InfoRow label="Morning Shade" value={survey.morning_shade ? 'Yes' : 'No'} />
              <InfoRow label="Afternoon Shade" value={survey.afternoon_shade ? 'Yes' : 'No'} />
              {survey.shading_notes && <InfoRow label="Notes" value={survey.shading_notes} />}
            </CardContent>
          </Card>

          {/* Section 6: Recommendation */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">6. Recommendation</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <InfoRow label="Size" value={survey.recommended_size_kwp ? `${survey.recommended_size_kwp} kWp` : null} />
              <InfoRow label="System Type" value={survey.recommended_system_type?.replace(/_/g, ' ')} capitalize />
              <InfoRow label="Est. Generation" value={survey.estimated_generation_kwh_year ? `${survey.estimated_generation_kwh_year} kWh/year` : null} />
              <InfoRow label="Panel Placement" value={survey.panel_placement_notes} />
              <InfoRow label="Inverter Location" value={survey.inverter_location} />
              <InfoRow label="Cable Routing" value={survey.cable_routing_notes} />
            </CardContent>
          </Card>

          {/* Section 7: Notes & Signatures */}
          {(survey.notes || survey.surveyor_signature || survey.customer_signature) && (
            <Card className="md:col-span-2">
              <CardHeader>
                <CardTitle className="text-base">7. Notes & Sign-off</CardTitle>
              </CardHeader>
              <CardContent>
                {survey.notes && (
                  <div className="mb-4">
                    <p className="text-sm text-[#3F424D] whitespace-pre-wrap">{survey.notes}</p>
                  </div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {survey.surveyor_signature && (
                    <div>
                      <span className="text-xs text-[#7C818E] block mb-1">Surveyor Signature</span>
                      <img src={survey.surveyor_signature} alt="Surveyor signature" className="border border-n-200 rounded h-24 bg-white" />
                    </div>
                  )}
                  {survey.customer_signature && (
                    <div>
                      <span className="text-xs text-[#7C818E] block mb-1">Customer Signature</span>
                      <img src={survey.customer_signature} alt="Customer signature" className="border border-n-200 rounded h-24 bg-white" />
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
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
