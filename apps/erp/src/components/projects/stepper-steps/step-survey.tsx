import { Card, CardHeader, CardTitle, CardContent, Badge } from '@repo/ui';
import { formatDate } from '@repo/ui/formatters';
import { getStepSurveyData } from '@/lib/project-stepper-queries';
import { ClipboardList } from 'lucide-react';

interface StepSurveyProps {
  projectId: string;
}

export async function StepSurvey({ projectId }: StepSurveyProps) {
  const survey = await getStepSurveyData(projectId);

  if (!survey) {
    return <EmptyState />;
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {/* Roof & Structure */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Roof & Structure</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <InfoRow label="Roof Type" value={survey.roof_type} />
          <InfoRow label="Structure Type" value={survey.structure_type} />
          <InfoRow label="Total Roof Area" value={survey.roof_area_sqft ? `${survey.roof_area_sqft} sq.ft` : null} />
          <InfoRow label="Usable Area" value={survey.usable_area_sqft ? `${survey.usable_area_sqft} sq.ft` : null} />
          <InfoRow label="Shade Analysis" value={survey.shading_assessment} />
          {survey.shading_notes && (
            <InfoRow label="Shade Notes" value={survey.shading_notes} />
          )}
        </CardContent>
      </Card>

      {/* Electrical & Recommendation */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Electrical & Recommendation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <InfoRow label="Existing Load" value={survey.existing_load_kw ? `${survey.existing_load_kw} kW` : null} />
          <InfoRow label="Sanctioned Load" value={survey.sanctioned_load_kw ? `${survey.sanctioned_load_kw} kW` : null} />
          <InfoRow label="Meter Type" value={survey.meter_type} />
          <InfoRow label="DISCOM" value={survey.discom_name} />
          <InfoRow label="Net Metering Eligible" value={survey.net_metering_eligible === null ? null : survey.net_metering_eligible ? 'Yes' : 'No'} />
          <InfoRow label="Recommended Size" value={survey.recommended_size_kwp ? `${survey.recommended_size_kwp} kWp` : null} />
          <InfoRow label="Recommended Type" value={survey.recommended_system_type?.replace(/_/g, ' ') ?? null} capitalize />
          <InfoRow label="Survey Date" value={formatDate(survey.survey_date)} />
        </CardContent>
      </Card>

      {/* Notes */}
      {survey.notes && (
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Survey Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-[#3F424D] whitespace-pre-wrap">{survey.notes}</p>
          </CardContent>
        </Card>
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

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16">
      <ClipboardList className="w-12 h-12 text-[#7C818E] opacity-50 mb-3" />
      <h3 className="text-lg font-bold font-heading text-[#1A1D24] mb-1">No Site Survey</h3>
      <p className="text-[13px] text-[#7C818E]">No site survey data available for this project.</p>
    </div>
  );
}
