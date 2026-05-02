import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLead } from '@/lib/leads-queries';
import { getDesignWorkspaceData, getProposalBomLines } from '@/lib/design-queries';
import { createDraftDetailedProposal } from '@/lib/quote-actions';
import { LeadFilesPanel } from '@/components/design/lead-files-panel';
import { BomPicker } from '@/components/sales/bom-picker';
import { DesignNotesEditor } from '@/components/design/design-notes-editor';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Badge,
  Breadcrumb,
  Button,
} from '@repo/ui';
import { STAGE_LABELS } from '@/lib/leads-helpers';

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

interface DesignWorkspaceProps {
  params: Promise<{ leadId: string }>;
}

export default async function DesignWorkspacePage({ params }: DesignWorkspaceProps) {
  const { leadId } = await params;

  const lead = await getLead(leadId);
  if (!lead) {
    notFound();
  }

  // Parallel reads for the header + BOM picker.
  const { survey, leadMeta, priceBookItems } = await getDesignWorkspaceData(leadId);

  // If the lead doesn't have a draft proposal yet, auto-create one now so
  // the designer can start composing BOM. This is the same action the Quote
  // tab calls when the sales engineer clicks "Start Detailed Proposal".
  let draftProposalId = leadMeta?.draft_proposal_id ?? null;
  if (
    !draftProposalId &&
    (lead.status === 'site_survey_scheduled' ||
      lead.status === 'site_survey_done' ||
      lead.status === 'design_in_progress')
  ) {
    const createResult = await createDraftDetailedProposal(leadId);
    if (createResult.success) {
      draftProposalId = createResult.data.proposalId;
    }
  }

  const bomLines = await getProposalBomLines(draftProposalId);
  const bomLineCount = bomLines.length;
  const bomUnmatchedCount = bomLines.filter((l) => !l.price_book_id).length;

  return (
    <div className="space-y-6">
      <Breadcrumb
        className="mb-2"
        items={[
          { label: 'Design Queue', href: '/design' },
          { label: lead.customer_name },
        ]}
      />

      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-n-900">{lead.customer_name}</h1>
          <div className="flex items-center gap-3 mt-1 text-sm text-n-500 flex-wrap">
            <Badge variant="neutral">{STAGE_LABELS[lead.status]}</Badge>
            <span>{lead.city}</span>
            {lead.estimated_size_kwp && <span>{lead.estimated_size_kwp} kWp</span>}
            {lead.system_type && <span>{lead.system_type.replace(/_/g, ' ')}</span>}
            {lead.segment && <span>{lead.segment}</span>}
            {lead.map_link && (
              <a
                href={lead.map_link}
                target="_blank"
                rel="noopener noreferrer"
                className="text-p-600 hover:underline"
              >
                View on map ↗
              </a>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/sales/${leadId}`}>
            <Button variant="secondary" size="sm">
              View in Sales
            </Button>
          </Link>
        </div>
      </div>

      {/* Survey summary - read-only snapshot */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Site Survey Summary</CardTitle>
        </CardHeader>
        <CardContent>
          {survey ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <InfoField label="Survey Date" value={formatDate(survey.survey_date)} />
              <InfoField label="Status" value={survey.survey_status ?? '—'} />
              <InfoField label="Contact on site" value={survey.contact_person_name ?? '—'} />
              <InfoField label="Recommended kWp" value={survey.recommended_size_kwp?.toString() ?? '—'} />
              <InfoField label="Roof Type" value={survey.roof_type ?? '—'} />
              <InfoField label="Roof Area" value={survey.roof_area_sqft ? `${survey.roof_area_sqft} sqft` : '—'} />
              <InfoField label="Usable Area" value={survey.usable_area_sqft ? `${survey.usable_area_sqft} sqft` : '—'} />
              <InfoField
                label="GPS"
                value={
                  survey.gps_lat && survey.gps_lng
                    ? `${Number(survey.gps_lat).toFixed(5)}, ${Number(survey.gps_lng).toFixed(5)}`
                    : '—'
                }
              />
              {survey.notes && (
                <div className="col-span-full mt-2 pt-3 border-t border-n-100">
                  <div className="text-xs text-n-500 uppercase mb-1">Notes</div>
                  <p className="text-sm text-n-700 whitespace-pre-wrap">{survey.notes}</p>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-n-500 text-center py-6">
              No survey data yet. The surveyor will add details during the site visit.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Lead files panel */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Design Files</CardTitle>
        </CardHeader>
        <CardContent>
          <LeadFilesPanel leadId={leadId} />
        </CardContent>
      </Card>

      {/* BOM editor */}
      {draftProposalId ? (
        <BomPicker
          proposalId={draftProposalId}
          bomLines={bomLines}
          priceBookOptions={priceBookItems}
        />
      ) : (
        <Card>
          <CardContent className="py-8 text-center text-sm text-n-500">
            The lead needs to enter Site Survey Scheduled stage before a draft proposal can be
            created. Once it does, the BOM editor will appear here.
          </CardContent>
        </Card>
      )}

      {/* Design notes + Mark Design Confirmed */}
      <DesignNotesEditor
        leadId={leadId}
        initialNotes={leadMeta?.design_notes ?? null}
        currentStatus={lead.status}
        bomLineCount={bomLineCount}
        bomUnmatchedCount={bomUnmatchedCount}
      />
    </div>
  );
}

function InfoField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-n-500 uppercase tracking-wide">{label}</div>
      <div className="text-sm font-medium text-n-900 mt-0.5">{value}</div>
    </div>
  );
}
