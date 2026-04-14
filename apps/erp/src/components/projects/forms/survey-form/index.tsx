'use client';

/**
 * Site Survey form — main shell. Orchestrates state, GPS capture,
 * auto-save draft, submit handler, and composes the 7 sections.
 *
 * Split into sub-modules by the April 14 audit (CLAUDE.md NEVER-DO
 * rule #14). Original was 1,191 LOC; shell is now under 300.
 *
 *   ./types.ts               types + dropdown constants
 *   ./shared.tsx             CollapsibleSection, PhotoUpload, ProgressBar,
 *                            ControlledState, initControlledState,
 *                            validateForSubmit
 *   ./sections-primary.tsx   Section 1 + Section 2 (the heavy one)
 *   ./sections-secondary.tsx Sections 3-7
 */
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardContent, Button, Badge } from '@repo/ui';
import { X } from 'lucide-react';

import { createOrUpdateSurvey } from '@/lib/project-step-actions';

import type { SurveyData } from './types';
import {
  CollapsibleSection,
  ProgressBar,
  initControlledState,
  validateForSubmit,
  type ControlledState,
} from './shared';
import { SectionProjectDetails, SectionFeasibility } from './sections-primary';
import {
  SectionClientDiscussion,
  SectionEquipment,
  SectionAcRouting,
  SectionDeviations,
  SectionSignatures,
} from './sections-secondary';

export type { SurveyData } from './types';

interface SurveyFormProps {
  projectId: string;
  existing?: SurveyData | null;
  onCancel?: () => void;
}

export function SurveyForm({ projectId, existing, onCancel }: SurveyFormProps) {
  const router = useRouter();
  const [showForm, setShowForm] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Collapsible sections — first section open by default
  const [openSections, setOpenSections] = React.useState<Set<number>>(new Set([1]));

  // GPS capture
  const [gpsLat, setGpsLat] = React.useState(existing?.gps_lat?.toString() ?? '');
  const [gpsLng, setGpsLng] = React.useState(existing?.gps_lng?.toString() ?? '');
  const [gpsLoading, setGpsLoading] = React.useState(false);

  // Shade source tags (multi-select outside the form's FormData flow)
  const [shadeSources, setShadeSources] = React.useState<string[]>(existing?.shade_sources ?? []);

  // Controlled toggles + photo paths
  const [cs, setCs] = React.useState<ControlledState>(() => initControlledState(existing));

  function updateCs<K extends keyof ControlledState>(key: K, value: ControlledState[K]) {
    setCs((prev) => ({ ...prev, [key]: value }));
  }

  function toggleSection(n: number) {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });
  }

  function captureGPS() {
    if (!navigator.geolocation) {
      setError('GPS not available on this device');
      return;
    }
    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGpsLat(pos.coords.latitude.toFixed(6));
        setGpsLng(pos.coords.longitude.toFixed(6));
        setGpsLoading(false);
      },
      (err) => {
        setError(`GPS error: ${err.message}`);
        setGpsLoading(false);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  function toggleShadeSource(val: string) {
    setShadeSources((prev) =>
      prev.includes(val) ? prev.filter((s) => s !== val) : [...prev, val],
    );
  }

  // ─── Progress calculation ────────────────────────────────────────────
  const sectionComplete = React.useMemo(() => {
    const s1 = true; // always has date
    const s2 = !!(existing?.roof_type || existing?.structure_type);
    const s3 = cs.mounting_procedure_explained || cs.fixing_arrangement_discussed;
    const s4 =
      cs.inverter_location_finalized ||
      cs.dc_routing_finalized ||
      cs.earthing_pit_finalized ||
      cs.la_location_finalized ||
      cs.termination_point_finalized ||
      cs.spare_feeder_available ||
      cs.dg_eb_checked;
    const s5 = cs.ac_routing_finalized;
    const s6 = true; // optional
    const s7 = !!existing?.surveyor_signature;
    return [s1, s2, s3, s4, s5, s6, s7];
  }, [existing, cs]);
  const completedCount = sectionComplete.filter(Boolean).length;

  // ─── Submit handler ──────────────────────────────────────────────────
  const formRef = React.useRef<HTMLFormElement>(null);

  async function handleSubmit(
    e: React.FormEvent<HTMLFormElement>,
    status: 'draft' | 'submitted',
    silent = false,
  ) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);

    if (status === 'submitted') {
      const valErr = validateForSubmit(cs, gpsLat, gpsLng, formRef.current);
      if (valErr) {
        setError(valErr);
        setSaving(false);
        return;
      }
    }

    const fd = new FormData(e.currentTarget);
    const str = (key: string) => (fd.get(key) as string) || null;
    const num = (key: string) => {
      const v = fd.get(key) as string;
      return v ? parseFloat(v) : null;
    };
    const int = (key: string) => {
      const v = fd.get(key) as string;
      return v ? parseInt(v, 10) : null;
    };

    const result = await createOrUpdateSurvey({
      projectId,
      surveyId: existing?.id,
      data: {
        // Section 1
        survey_date: str('survey_date') ?? new Date().toISOString().split('T')[0]!,
        contact_person_name: str('contact_person_name'),
        contact_phone: str('contact_phone'),
        gps_lat: num('gps_lat'),
        gps_lng: num('gps_lng'),
        site_access_notes: str('site_access_notes'),
        // Section 2 — uncontrolled form fields
        roof_type: str('roof_type') ?? '',
        roof_condition: str('roof_condition'),
        roof_age_years: int('roof_age_years'),
        roof_orientation: str('roof_orientation'),
        roof_tilt_degrees: num('roof_tilt_degrees'),
        roof_area_sqft: num('roof_area_sqft'),
        usable_area_sqft: num('usable_area_sqft'),
        number_of_floors: int('number_of_floors'),
        building_height_ft: num('building_height_ft'),
        structure_type: str('structure_type') ?? '',
        existing_structure_condition: str('existing_structure_condition'),
        existing_load_kw: num('existing_load_kw'),
        sanctioned_load_kw: num('sanctioned_load_kw'),
        meter_type: str('meter_type'),
        supply_voltage: str('supply_voltage'),
        discom_name: str('discom_name'),
        earthing_type: str('earthing_type'),
        earthing_condition: str('earthing_condition'),
        net_metering_eligible: fd.get('net_metering_eligible') === 'on',
        shading_assessment: str('shading_assessment'),
        shading_notes: str('shading_notes'),
        shade_sources: shadeSources.length > 0 ? shadeSources : null,
        morning_shade: fd.get('morning_shade') === 'on',
        afternoon_shade: fd.get('afternoon_shade') === 'on',
        recommended_size_kwp: num('recommended_size_kwp'),
        recommended_system_type: str('recommended_system_type'),
        estimated_generation_kwh_year: num('estimated_generation_kwh_year'),
        panel_placement_notes: str('panel_placement_notes'),
        inverter_location: str('inverter_location'),
        cable_routing_notes: str('cable_routing_notes'),
        // Section 2 controlled toggles + photos
        mounting_feasibility_checked: cs.mounting_feasibility_checked,
        shadow_analysis_done: cs.shadow_analysis_done,
        roof_condition_photo_path: cs.roof_condition_photo_path,
        shadow_area_photo_path: cs.shadow_area_photo_path,
        // Section 3
        mounting_procedure_explained: cs.mounting_procedure_explained,
        fixing_arrangement_discussed: cs.fixing_arrangement_discussed,
        // Section 4
        inverter_location_finalized: cs.inverter_location_finalized,
        inverter_location_photo_path: cs.inverter_location_photo_path,
        dc_routing_finalized: cs.dc_routing_finalized,
        dc_routing_photo_path: cs.dc_routing_photo_path,
        earthing_pit_finalized: cs.earthing_pit_finalized,
        earthing_pit_photo_path: cs.earthing_pit_photo_path,
        la_location_finalized: cs.la_location_finalized,
        la_location_photo_path: cs.la_location_photo_path,
        termination_point_finalized: cs.termination_point_finalized,
        termination_point_photo_path: cs.termination_point_photo_path,
        spare_feeder_available: cs.spare_feeder_available,
        spare_feeder_photo_path: cs.spare_feeder_photo_path,
        dg_eb_checked: cs.dg_eb_checked,
        dg_eb_photo_path: cs.dg_eb_photo_path,
        spare_feeder_rating: cs.spare_feeder_rating || null,
        spare_feeder_rating_photo_path: cs.spare_feeder_rating_photo_path,
        // Section 5
        ac_routing_finalized: cs.ac_routing_finalized,
        ac_routing_photo_path: cs.ac_routing_photo_path,
        // Section 6
        additional_panels_required: cs.additional_panels_required,
        additional_panels_remarks: str('additional_panels_remarks'),
        additional_inverter_required: cs.additional_inverter_required,
        additional_inverter_remarks: str('additional_inverter_remarks'),
        routing_changes: str('routing_changes'),
        cable_size_changes: str('cable_size_changes'),
        other_special_requests: str('other_special_requests'),
        // Section 7
        notes: str('notes'),
        surveyor_signature: str('surveyor_signature'),
        customer_signature: str('customer_signature'),
        // Status
        survey_status: status,
      },
    });

    setSaving(false);
    if (result.success) {
      if (silent) return; // auto-save draft — don't navigate
      if (status === 'draft') {
        setError(null);
        router.refresh();
      } else {
        setShowForm(false);
        router.push(`/projects/${projectId}?tab=bom`);
        router.refresh();
      }
    } else {
      if (!silent) setError(result.error ?? 'Failed to save survey');
    }
  }

  // ─── Auto-save draft every 60s ───────────────────────────────────────
  React.useEffect(() => {
    if (!showForm) return;
    const id = setInterval(() => {
      if (formRef.current && !saving) {
        const fakeEvent = {
          preventDefault: () => {},
          currentTarget: formRef.current,
        } as unknown as React.FormEvent<HTMLFormElement>;
        handleSubmit(fakeEvent, 'draft', true);
      }
    }, 60_000);
    return () => clearInterval(id);
  }, [showForm, saving]);

  // ─── Collapsed state: "+ Create Site Survey" button ──────────────────
  if (!showForm) {
    return (
      <div className="mb-4 flex items-center gap-3">
        <Button size="sm" onClick={() => setShowForm(true)}>
          {existing ? 'Edit Survey' : '+ Create Site Survey'}
        </Button>
        {existing?.survey_status && (
          <Badge
            variant={
              existing.survey_status === 'approved'
                ? 'success'
                : existing.survey_status === 'submitted'
                  ? 'pending'
                  : 'neutral'
            }
          >
            {existing.survey_status.charAt(0).toUpperCase() + existing.survey_status.slice(1)}
          </Badge>
        )}
      </div>
    );
  }

  // ─── Expanded form ───────────────────────────────────────────────────
  return (
    <Card className="mb-6">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">
          {existing ? 'Edit Site Survey' : 'New Site Survey'}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ProgressBar completed={completedCount} total={7} />

        <form ref={formRef} onSubmit={(e) => handleSubmit(e, 'submitted')} className="space-y-3">
          <CollapsibleSection
            num={1}
            title="Project Details"
            isOpen={openSections.has(1)}
            onToggle={() => toggleSection(1)}
            isComplete={sectionComplete[0]!}
          >
            <SectionProjectDetails
              existing={existing}
              gpsLat={gpsLat}
              gpsLng={gpsLng}
              setGpsLat={setGpsLat}
              setGpsLng={setGpsLng}
              captureGPS={captureGPS}
              gpsLoading={gpsLoading}
            />
          </CollapsibleSection>

          <CollapsibleSection
            num={2}
            title="Mounting & Site Feasibility"
            isOpen={openSections.has(2)}
            onToggle={() => toggleSection(2)}
            isComplete={sectionComplete[1]!}
          >
            <SectionFeasibility
              existing={existing}
              projectId={projectId}
              cs={cs}
              updateCs={updateCs}
              shadeSources={shadeSources}
              toggleShadeSource={toggleShadeSource}
            />
          </CollapsibleSection>

          <CollapsibleSection
            num={3}
            title="Client Discussion & Approvals"
            isOpen={openSections.has(3)}
            onToggle={() => toggleSection(3)}
            isComplete={sectionComplete[2]!}
          >
            <SectionClientDiscussion cs={cs} updateCs={updateCs} />
          </CollapsibleSection>

          <CollapsibleSection
            num={4}
            title="Equipment Location Finalization"
            isOpen={openSections.has(4)}
            onToggle={() => toggleSection(4)}
            isComplete={sectionComplete[3]!}
          >
            <SectionEquipment projectId={projectId} cs={cs} updateCs={updateCs} />
          </CollapsibleSection>

          <CollapsibleSection
            num={5}
            title="AC Cable Routing"
            isOpen={openSections.has(5)}
            onToggle={() => toggleSection(5)}
            isComplete={sectionComplete[4]!}
          >
            <SectionAcRouting projectId={projectId} cs={cs} updateCs={updateCs} />
          </CollapsibleSection>

          <CollapsibleSection
            num={6}
            title="Deviations & Special Requirements"
            isOpen={openSections.has(6)}
            onToggle={() => toggleSection(6)}
            isComplete={sectionComplete[5]!}
          >
            <SectionDeviations existing={existing} cs={cs} updateCs={updateCs} />
          </CollapsibleSection>

          <CollapsibleSection
            num={7}
            title="Notes & Signatures"
            isOpen={openSections.has(7)}
            onToggle={() => toggleSection(7)}
            isComplete={sectionComplete[6]!}
          >
            <SectionSignatures existing={existing} />
          </CollapsibleSection>

          {error && (
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 px-3 py-2 rounded">
              <X className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          <div className="flex items-center justify-between pt-4 border-t border-n-200">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setShowForm(false);
                onCancel?.();
              }}
            >
              Cancel
            </Button>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={(e) => {
                  const form = (e.target as HTMLElement).closest('form');
                  if (form) {
                    const fakeEvent = {
                      preventDefault: () => {},
                      currentTarget: form,
                    } as unknown as React.FormEvent<HTMLFormElement>;
                    handleSubmit(fakeEvent, 'draft');
                  }
                }}
              >
                {saving ? 'Saving...' : 'Save as Draft'}
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? 'Submitting...' : existing ? 'Update & Submit' : 'Submit Survey'}
              </Button>
            </div>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
