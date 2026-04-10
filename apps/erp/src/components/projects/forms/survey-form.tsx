'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Card, CardHeader, CardTitle, CardContent,
  Button, Input, Label, Select, Checkbox, Badge,
} from '@repo/ui';
import { createClient } from '@repo/supabase/client';
import { createOrUpdateSurvey } from '@/lib/project-step-actions';
import { SignaturePad } from './signature-pad';
import {
  MapPin, ChevronDown, ChevronUp, Check, Camera, Upload, X,
} from 'lucide-react';

/* ═══════════════════════════════════════════════════════════
   SurveyData — full type matching migration 035
   ═══════════════════════════════════════════════════════════ */

export interface SurveyData {
  id: string;
  survey_date: string;
  survey_status: string | null;
  // Section 1: Project Details / Site Info
  contact_person_name: string | null;
  contact_phone: string | null;
  gps_lat: number | null;
  gps_lng: number | null;
  site_access_notes: string | null;
  // Section 2: Mounting & Site Feasibility
  roof_type: string | null;
  roof_condition: string | null;
  roof_age_years: number | null;
  roof_orientation: string | null;
  roof_tilt_degrees: number | null;
  roof_area_sqft: number | null;
  usable_area_sqft: number | null;
  number_of_floors: number | null;
  building_height_ft: number | null;
  structure_type: string | null;
  existing_structure_condition: string | null;
  existing_load_kw: number | null;
  sanctioned_load_kw: number | null;
  meter_type: string | null;
  supply_voltage: string | null;
  discom_name: string | null;
  earthing_type: string | null;
  earthing_condition: string | null;
  net_metering_eligible: boolean | null;
  shading_assessment: string | null;
  shading_notes: string | null;
  shade_sources: string[] | null;
  morning_shade: boolean | null;
  afternoon_shade: boolean | null;
  recommended_size_kwp: number | null;
  recommended_system_type: string | null;
  estimated_generation_kwh_year: number | null;
  panel_placement_notes: string | null;
  inverter_location: string | null;
  cable_routing_notes: string | null;
  mounting_feasibility_checked: boolean | null;
  shadow_analysis_done: boolean | null;
  roof_condition_photo_path: string | null;
  shadow_area_photo_path: string | null;
  // Section 3: Client Discussion
  mounting_procedure_explained: boolean | null;
  fixing_arrangement_discussed: boolean | null;
  // Section 4: Equipment Location Finalization
  inverter_location_finalized: boolean | null;
  inverter_location_photo_path: string | null;
  dc_routing_finalized: boolean | null;
  dc_routing_photo_path: string | null;
  earthing_pit_finalized: boolean | null;
  earthing_pit_photo_path: string | null;
  la_location_finalized: boolean | null;
  la_location_photo_path: string | null;
  termination_point_finalized: boolean | null;
  termination_point_photo_path: string | null;
  spare_feeder_available: boolean | null;
  spare_feeder_photo_path: string | null;
  dg_eb_checked: boolean | null;
  dg_eb_photo_path: string | null;
  spare_feeder_rating: string | null;
  spare_feeder_rating_photo_path: string | null;
  // Section 5: AC Cable Routing
  ac_routing_finalized: boolean | null;
  ac_routing_photo_path: string | null;
  // Section 6: Deviations
  additional_panels_required: boolean | null;
  additional_panels_remarks: string | null;
  additional_inverter_required: boolean | null;
  additional_inverter_remarks: string | null;
  routing_changes: string | null;
  cable_size_changes: string | null;
  other_special_requests: string | null;
  // Section 7: Notes & Signatures
  notes: string | null;
  surveyor_signature: string | null;
  customer_signature: string | null;
}

/* ═══════════════════════════════════════════════════════════
   Constants — DB check constraint values
   ═══════════════════════════════════════════════════════════ */

const ROOF_TYPES = [
  { value: 'flat_rcc', label: 'RCC Flat' },
  { value: 'sloped_rcc', label: 'RCC Sloped' },
  { value: 'tin_sheet', label: 'Metal Sheet' },
  { value: 'mangalore_tile', label: 'Tiled' },
  { value: 'asbestos', label: 'Asbestos' },
  { value: 'metal_deck', label: 'Metal Deck' },
  { value: 'other', label: 'Other' },
];
const ROOF_CONDITIONS = [
  { value: 'good', label: 'Good' },
  { value: 'fair', label: 'Fair' },
  { value: 'poor', label: 'Poor' },
];
const ROOF_ORIENTATIONS = [
  { value: 'north', label: 'North' },
  { value: 'south', label: 'South' },
  { value: 'east', label: 'East' },
  { value: 'west', label: 'West' },
  { value: 'north_east', label: 'North-East' },
  { value: 'north_west', label: 'North-West' },
  { value: 'south_east', label: 'South-East' },
  { value: 'south_west', label: 'South-West' },
];
const STRUCTURE_TYPES = [
  { value: 'rcc_column', label: 'RCC Column' },
  { value: 'elevated_ms', label: 'Elevated MS' },
  { value: 'ground_mount', label: 'Ground Mount' },
  { value: 'carport', label: 'Carport' },
  { value: 'other', label: 'Other' },
];
const STRUCTURE_CONDITIONS = [
  { value: 'good', label: 'Good' },
  { value: 'needs_repair', label: 'Needs Repair' },
  { value: 'not_suitable', label: 'Not Suitable' },
];
const SHADING_OPTIONS = [
  { value: 'none', label: 'No Shade' },
  { value: 'minimal', label: 'Minimal' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'severe', label: 'Heavy / Severe' },
];
const SHADE_SOURCES = [
  { value: 'trees', label: 'Trees' },
  { value: 'buildings', label: 'Adjacent Buildings' },
  { value: 'towers', label: 'Towers / Poles' },
  { value: 'ac_units', label: 'AC / HVAC Units' },
  { value: 'water_tank', label: 'Water Tank' },
  { value: 'other', label: 'Other' },
];
const METER_TYPES = [
  { value: 'single_phase', label: 'Single Phase' },
  { value: 'three_phase', label: 'Three Phase' },
];
const SUPPLY_VOLTAGES = [
  { value: '230v_single', label: '230V Single Phase' },
  { value: '415v_three', label: '415V Three Phase' },
  { value: '11kv_ht', label: '11kV HT' },
  { value: '33kv_ht', label: '33kV HT' },
];
const EARTHING_TYPES = [
  { value: 'plate', label: 'Plate' },
  { value: 'pipe', label: 'Pipe' },
  { value: 'strip', label: 'Strip' },
  { value: 'rod', label: 'Rod' },
  { value: 'none', label: 'None' },
];
const EARTHING_CONDITIONS = [
  { value: 'good', label: 'Good' },
  { value: 'needs_upgrade', label: 'Needs Upgrade' },
  { value: 'absent', label: 'Absent' },
];
const SYSTEM_TYPES = [
  { value: 'on_grid', label: 'On Grid' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'off_grid', label: 'Off Grid' },
];

/* Equipment items config for Section 4 */
const EQUIPMENT_ITEMS: Array<{
  key: string;
  label: string;
  toggleKey: string;
  photoKey: string;
}> = [
  { key: 'inverter_location', label: 'Inverter Location', toggleKey: 'inverter_location_finalized', photoKey: 'inverter_location_photo_path' },
  { key: 'dc_routing', label: 'DC Cable Routing', toggleKey: 'dc_routing_finalized', photoKey: 'dc_routing_photo_path' },
  { key: 'earthing_pit', label: 'Earthing Pit', toggleKey: 'earthing_pit_finalized', photoKey: 'earthing_pit_photo_path' },
  { key: 'la_location', label: 'Lightning Arrestor', toggleKey: 'la_location_finalized', photoKey: 'la_location_photo_path' },
  { key: 'termination_point', label: 'Termination Point', toggleKey: 'termination_point_finalized', photoKey: 'termination_point_photo_path' },
  { key: 'spare_feeder', label: 'Spare Feeder Available', toggleKey: 'spare_feeder_available', photoKey: 'spare_feeder_photo_path' },
  { key: 'dg_eb', label: 'DG/EB Interconnection', toggleKey: 'dg_eb_checked', photoKey: 'dg_eb_photo_path' },
];

/* ═══════════════════════════════════════════════════════════
   Helpers: CollapsibleSection, PhotoUpload, ProgressBar
   ═══════════════════════════════════════════════════════════ */

function CollapsibleSection({ num, title, isOpen, onToggle, isComplete, children }: {
  num: number;
  title: string;
  isOpen: boolean;
  onToggle: () => void;
  isComplete: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-n-200 rounded-lg overflow-hidden">
      <button type="button" onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 bg-[#F8F9FA] hover:bg-[#F0F1F3] transition-colors text-left">
        <div className="flex items-center gap-3">
          <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
            isComplete
              ? 'bg-green-100 text-green-700'
              : 'bg-n-200 text-n-600'
          }`}>
            {isComplete ? <Check className="h-3.5 w-3.5" /> : num}
          </span>
          <span className="text-sm font-semibold text-[#1A1D24]">{title}</span>
        </div>
        {isOpen
          ? <ChevronUp className="h-4 w-4 text-[#7C818E]" />
          : <ChevronDown className="h-4 w-4 text-[#7C818E]" />}
      </button>
      {isOpen && <div className="px-4 py-4 bg-white border-t border-n-200">{children}</div>}
    </div>
  );
}

function PhotoUpload({ projectId, fieldName, currentPath, onPathChange }: {
  projectId: string;
  fieldName: string;
  currentPath: string | null;
  onPathChange: (path: string | null) => void;
}) {
  const [uploading, setUploading] = React.useState(false);
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Load preview for existing photos
  React.useEffect(() => {
    if (!currentPath) { setPreviewUrl(null); return; }
    const supabase = createClient();
    supabase.storage.from('site-photos').createSignedUrl(currentPath, 300)
      .then(({ data }) => { if (data?.signedUrl) setPreviewUrl(data.signedUrl); });
  }, [currentPath]);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    // Show instant local preview
    const localUrl = URL.createObjectURL(file);
    setPreviewUrl(localUrl);
    const ext = file.name.split('.').pop() ?? 'jpg';
    const path = `surveys/${projectId}/${fieldName}_${Date.now()}.${ext}`;
    const supabase = createClient();
    const { error } = await supabase.storage.from('site-photos').upload(path, file, { upsert: true });
    setUploading(false);
    if (error) {
      console.error(`[PhotoUpload] Upload failed for ${fieldName}:`, error.message);
      setPreviewUrl(null);
      return;
    }
    onPathChange(path);
  }

  async function handleRemove() {
    if (currentPath) {
      const supabase = createClient();
      await supabase.storage.from('site-photos').remove([currentPath]);
    }
    onPathChange(null);
    setPreviewUrl(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  return (
    <div className="mt-1.5">
      {previewUrl && (
        <div className="mb-2 relative inline-block">
          <img src={previewUrl} alt={fieldName} className="h-16 w-24 object-cover rounded border border-n-200" />
          <button type="button" onClick={handleRemove}
            className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-red-500 text-white flex items-center justify-center hover:bg-red-600 transition-colors">
            <X className="h-3 w-3" />
          </button>
        </div>
      )}
      <div className="flex items-center gap-2">
        {currentPath ? (
          <>
            <span className="text-xs text-green-600 flex items-center gap-1">
              <Camera className="h-3 w-3" /> Photo attached
            </span>
            <button type="button" onClick={() => inputRef.current?.click()}
              className="text-xs text-blue-600 hover:text-blue-800 underline">Replace</button>
          </>
        ) : (
          <button type="button" onClick={() => inputRef.current?.click()}
            className="text-xs text-[#7C818E] hover:text-[#1A1D24] flex items-center gap-1 border border-dashed border-n-300 rounded px-2 py-1 hover:border-n-400 transition-colors">
            <Upload className="h-3 w-3" /> Upload photo
          </button>
        )}
        {uploading && (
          <span className="text-xs text-[#7C818E] flex items-center gap-1">
            <span className="h-3 w-3 border border-n-400 border-t-[#00B050] rounded-full animate-spin" />
            Uploading...
          </span>
        )}
      </div>
      <input ref={inputRef} type="file" accept="image/*" capture="environment"
        className="hidden" onChange={handleFileChange} />
    </div>
  );
}

function ProgressBar({ completed, total }: { completed: number; total: number }) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  return (
    <div className="flex items-center gap-3 mb-4">
      <div className="flex-1 h-2 bg-n-200 rounded-full overflow-hidden">
        <div className="h-full bg-[#00B050] rounded-full transition-all duration-300"
          style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-medium text-[#7C818E] whitespace-nowrap">
        {pct}% complete ({completed}/{total})
      </span>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   Controlled state type — toggles + photo paths
   ═══════════════════════════════════════════════════════════ */

interface ControlledState {
  // Section 2 extensions
  mounting_feasibility_checked: boolean;
  shadow_analysis_done: boolean;
  roof_condition_photo_path: string | null;
  shadow_area_photo_path: string | null;
  // Section 3
  mounting_procedure_explained: boolean;
  fixing_arrangement_discussed: boolean;
  // Section 4 — equipment
  inverter_location_finalized: boolean;
  inverter_location_photo_path: string | null;
  dc_routing_finalized: boolean;
  dc_routing_photo_path: string | null;
  earthing_pit_finalized: boolean;
  earthing_pit_photo_path: string | null;
  la_location_finalized: boolean;
  la_location_photo_path: string | null;
  termination_point_finalized: boolean;
  termination_point_photo_path: string | null;
  spare_feeder_available: boolean;
  spare_feeder_photo_path: string | null;
  dg_eb_checked: boolean;
  dg_eb_photo_path: string | null;
  spare_feeder_rating: string;
  spare_feeder_rating_photo_path: string | null;
  // Section 5
  ac_routing_finalized: boolean;
  ac_routing_photo_path: string | null;
  // Section 6
  additional_panels_required: boolean;
  additional_inverter_required: boolean;
}

function initControlledState(ex: SurveyData | null | undefined): ControlledState {
  return {
    mounting_feasibility_checked: ex?.mounting_feasibility_checked ?? false,
    shadow_analysis_done: ex?.shadow_analysis_done ?? false,
    roof_condition_photo_path: ex?.roof_condition_photo_path ?? null,
    shadow_area_photo_path: ex?.shadow_area_photo_path ?? null,
    mounting_procedure_explained: ex?.mounting_procedure_explained ?? false,
    fixing_arrangement_discussed: ex?.fixing_arrangement_discussed ?? false,
    inverter_location_finalized: ex?.inverter_location_finalized ?? false,
    inverter_location_photo_path: ex?.inverter_location_photo_path ?? null,
    dc_routing_finalized: ex?.dc_routing_finalized ?? false,
    dc_routing_photo_path: ex?.dc_routing_photo_path ?? null,
    earthing_pit_finalized: ex?.earthing_pit_finalized ?? false,
    earthing_pit_photo_path: ex?.earthing_pit_photo_path ?? null,
    la_location_finalized: ex?.la_location_finalized ?? false,
    la_location_photo_path: ex?.la_location_photo_path ?? null,
    termination_point_finalized: ex?.termination_point_finalized ?? false,
    termination_point_photo_path: ex?.termination_point_photo_path ?? null,
    spare_feeder_available: ex?.spare_feeder_available ?? false,
    spare_feeder_photo_path: ex?.spare_feeder_photo_path ?? null,
    dg_eb_checked: ex?.dg_eb_checked ?? false,
    dg_eb_photo_path: ex?.dg_eb_photo_path ?? null,
    spare_feeder_rating: ex?.spare_feeder_rating ?? '',
    spare_feeder_rating_photo_path: ex?.spare_feeder_rating_photo_path ?? null,
    ac_routing_finalized: ex?.ac_routing_finalized ?? false,
    ac_routing_photo_path: ex?.ac_routing_photo_path ?? null,
    additional_panels_required: ex?.additional_panels_required ?? false,
    additional_inverter_required: ex?.additional_inverter_required ?? false,
  };
}

/* ═══════════════════════════════════════════════════════════
   SurveyForm — Main Component
   ═══════════════════════════════════════════════════════════ */

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

  // GPS
  const [gpsLat, setGpsLat] = React.useState(existing?.gps_lat?.toString() ?? '');
  const [gpsLng, setGpsLng] = React.useState(existing?.gps_lng?.toString() ?? '');
  const [gpsLoading, setGpsLoading] = React.useState(false);

  // Shade sources
  const [shadeSources, setShadeSources] = React.useState<string[]>(existing?.shade_sources ?? []);

  // Controlled toggles + photo paths
  const [cs, setCs] = React.useState<ControlledState>(() => initControlledState(existing));

  function updateCs<K extends keyof ControlledState>(key: K, value: ControlledState[K]) {
    setCs(prev => ({ ...prev, [key]: value }));
  }

  /* ─── Section open/close ─── */
  function toggleSection(n: number) {
    setOpenSections(prev => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n); else next.add(n);
      return next;
    });
  }

  /* ─── GPS capture ─── */
  function captureGPS() {
    if (!navigator.geolocation) { setError('GPS not available on this device'); return; }
    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGpsLat(pos.coords.latitude.toFixed(6));
        setGpsLng(pos.coords.longitude.toFixed(6));
        setGpsLoading(false);
      },
      (err) => { setError(`GPS error: ${err.message}`); setGpsLoading(false); },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  function toggleShadeSource(val: string) {
    setShadeSources(prev => prev.includes(val) ? prev.filter(s => s !== val) : [...prev, val]);
  }

  /* ─── Progress calculation ─── */
  const sectionComplete = React.useMemo(() => {
    const s1 = true; // always has date
    const s2 = !!(existing?.roof_type || existing?.structure_type);
    const s3 = cs.mounting_procedure_explained || cs.fixing_arrangement_discussed;
    const s4 = cs.inverter_location_finalized || cs.dc_routing_finalized || cs.earthing_pit_finalized ||
      cs.la_location_finalized || cs.termination_point_finalized || cs.spare_feeder_available || cs.dg_eb_checked;
    const s5 = cs.ac_routing_finalized;
    const s6 = true; // optional
    const s7 = !!(existing?.surveyor_signature);
    return [s1, s2, s3, s4, s5, s6, s7];
  }, [existing, cs]);
  const completedCount = sectionComplete.filter(Boolean).length;

  /* ─── Auto-save draft every 60s ─── */
  const formRef = React.useRef<HTMLFormElement>(null);
  const autoSaveTimer = React.useRef<ReturnType<typeof setInterval> | null>(null);

  React.useEffect(() => {
    if (!showForm) return;
    autoSaveTimer.current = setInterval(() => {
      if (formRef.current && !saving) {
        const fakeEvent = {
          preventDefault: () => {},
          currentTarget: formRef.current,
        } as unknown as React.FormEvent<HTMLFormElement>;
        handleSubmit(fakeEvent, 'draft', true);
      }
    }, 60000); // Every 60 seconds
    return () => { if (autoSaveTimer.current) clearInterval(autoSaveTimer.current); };
  }, [showForm, saving]);

  /* ─── Validation for Submit ─── */
  function validateForSubmit(): string | null {
    // GPS mandatory
    if (!gpsLat || !gpsLng) return 'GPS coordinates are mandatory. Use "Capture GPS" or enter manually.';
    // Roof photo mandatory
    if (!cs.roof_condition_photo_path) return 'Roof condition photo is mandatory.';
    // Shadow photo mandatory
    if (!cs.shadow_area_photo_path) return 'Shadow area photo is mandatory.';
    // Equipment photos: if toggle=YES, photo required
    for (const item of EQUIPMENT_ITEMS) {
      const toggled = cs[item.toggleKey as keyof ControlledState] as boolean;
      const photoPath = cs[item.photoKey as keyof ControlledState] as string | null;
      if (toggled && !photoPath) return `${item.label}: photo is required when marked as finalized.`;
    }
    // AC routing photo if finalized
    if (cs.ac_routing_finalized && !cs.ac_routing_photo_path) {
      return 'AC routing photo is required when marked as finalized.';
    }
    // Both signatures mandatory (read from hidden inputs in the form)
    if (formRef.current) {
      const fd = new FormData(formRef.current);
      const survSig = fd.get('surveyor_signature') as string;
      const custSig = fd.get('customer_signature') as string;
      if (!survSig) return 'Surveyor/Engineer signature is mandatory before submission.';
      if (!custSig) return 'Client/Customer signature is mandatory before submission.';
    }
    return null;
  }

  /* ─── Submit handler ─── */
  async function handleSubmit(e: React.FormEvent<HTMLFormElement>, status: 'draft' | 'submitted', silent = false) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);

    // Validate only on submit (not draft)
    if (status === 'submitted') {
      const valErr = validateForSubmit();
      if (valErr) {
        setError(valErr);
        setSaving(false);
        return;
      }
    }

    const fd = new FormData(e.currentTarget);
    const str = (key: string) => (fd.get(key) as string) || null;
    const num = (key: string) => { const v = fd.get(key) as string; return v ? parseFloat(v) : null; };
    const int = (key: string) => { const v = fd.get(key) as string; return v ? parseInt(v, 10) : null; };

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
        // Stay on page, show success briefly
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

  /* ─── Toggle button to show/hide the form ─── */
  if (!showForm) {
    return (
      <div className="mb-4 flex items-center gap-3">
        <Button size="sm" onClick={() => setShowForm(true)}>
          {existing ? 'Edit Survey' : '+ Create Site Survey'}
        </Button>
        {existing?.survey_status && (
          <Badge variant={existing.survey_status === 'approved' ? 'success' : existing.survey_status === 'submitted' ? 'pending' : 'neutral'}>
            {existing.survey_status.charAt(0).toUpperCase() + existing.survey_status.slice(1)}
          </Badge>
        )}
      </div>
    );
  }

  /* ═══════════════════════════════════════════════════════════
     RENDER — The Full Survey Form
     ═══════════════════════════════════════════════════════════ */

  return (
    <Card className="mb-6">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{existing ? 'Edit Site Survey' : 'New Site Survey'}</CardTitle>
      </CardHeader>
      <CardContent>
        {/* Progress */}
        <ProgressBar completed={completedCount} total={7} />

        <form ref={formRef} onSubmit={(e) => handleSubmit(e, 'submitted')} className="space-y-3">

          {/* ═══ Section 1: Project Details ═══ */}
          <CollapsibleSection num={1} title="Project Details" isOpen={openSections.has(1)}
            onToggle={() => toggleSection(1)} isComplete={sectionComplete[0]!}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="survey_date">Survey Date *</Label>
                <Input id="survey_date" name="survey_date" type="date"
                  defaultValue={existing?.survey_date ?? new Date().toISOString().split('T')[0]} required />
              </div>
              <div>
                <Label htmlFor="contact_person_name">Contact Person</Label>
                <Input id="contact_person_name" name="contact_person_name"
                  defaultValue={existing?.contact_person_name ?? ''} placeholder="On-site contact" />
              </div>
              <div>
                <Label htmlFor="contact_phone">Contact Phone</Label>
                <Input id="contact_phone" name="contact_phone" type="tel"
                  defaultValue={existing?.contact_phone ?? ''} placeholder="+91..." />
              </div>
              <div>
                <Label>GPS Coordinates</Label>
                <div className="flex items-center gap-2">
                  <Input name="gps_lat" type="number" step="0.000001" placeholder="Latitude"
                    value={gpsLat} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setGpsLat(e.target.value)} className="flex-1" />
                  <Input name="gps_lng" type="number" step="0.000001" placeholder="Longitude"
                    value={gpsLng} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setGpsLng(e.target.value)} className="flex-1" />
                  <Button type="button" variant="outline" size="sm" onClick={captureGPS} disabled={gpsLoading}
                    className="h-9 px-2 shrink-0" title="Capture GPS">
                    <MapPin className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="md:col-span-2">
                <Label htmlFor="site_access_notes">Site Access Notes</Label>
                <Input id="site_access_notes" name="site_access_notes"
                  defaultValue={existing?.site_access_notes ?? ''} placeholder="Parking, key person, gate code..." />
              </div>
            </div>
          </CollapsibleSection>

          {/* ═══ Section 2: Mounting & Site Feasibility ═══ */}
          <CollapsibleSection num={2} title="Mounting & Site Feasibility" isOpen={openSections.has(2)}
            onToggle={() => toggleSection(2)} isComplete={sectionComplete[1]!}>

            {/* 2a: Roof Details */}
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#7C818E] mb-2">Roof Details</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <div>
                <Label htmlFor="roof_type">Roof Type *</Label>
                <Select id="roof_type" name="roof_type" defaultValue={existing?.roof_type ?? ''} required>
                  <option value="" disabled>Select...</option>
                  {ROOF_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </Select>
              </div>
              <div>
                <Label htmlFor="roof_condition">Condition</Label>
                <Select id="roof_condition" name="roof_condition" defaultValue={existing?.roof_condition ?? ''}>
                  <option value="">Select...</option>
                  {ROOF_CONDITIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </Select>
              </div>
              <div>
                <Label htmlFor="roof_age_years">Age (years)</Label>
                <Input id="roof_age_years" name="roof_age_years" type="number" min="0"
                  defaultValue={existing?.roof_age_years ?? ''} />
              </div>
              <div>
                <Label htmlFor="roof_orientation">Orientation</Label>
                <Select id="roof_orientation" name="roof_orientation" defaultValue={existing?.roof_orientation ?? ''}>
                  <option value="">Select...</option>
                  {ROOF_ORIENTATIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </Select>
              </div>
              <div>
                <Label htmlFor="roof_tilt_degrees">Tilt (degrees)</Label>
                <Input id="roof_tilt_degrees" name="roof_tilt_degrees" type="number" step="0.1" min="0" max="90"
                  defaultValue={existing?.roof_tilt_degrees ?? ''} />
              </div>
              <div>
                <Label htmlFor="roof_area_sqft">Total Area (sq.ft)</Label>
                <Input id="roof_area_sqft" name="roof_area_sqft" type="number" step="0.1"
                  defaultValue={existing?.roof_area_sqft ?? ''} />
              </div>
              <div>
                <Label htmlFor="usable_area_sqft">Usable Area (sq.ft)</Label>
                <Input id="usable_area_sqft" name="usable_area_sqft" type="number" step="0.1"
                  defaultValue={existing?.usable_area_sqft ?? ''} />
              </div>
              <div>
                <Label htmlFor="number_of_floors">Floors</Label>
                <Input id="number_of_floors" name="number_of_floors" type="number" min="1"
                  defaultValue={existing?.number_of_floors ?? ''} />
              </div>
              <div>
                <Label htmlFor="building_height_ft">Building Height (ft)</Label>
                <Input id="building_height_ft" name="building_height_ft" type="number" step="0.1"
                  defaultValue={existing?.building_height_ft ?? ''} />
              </div>
            </div>

            {/* 2b: Structure */}
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#7C818E] mb-2">Structure</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <div>
                <Label htmlFor="structure_type">Structure Type *</Label>
                <Select id="structure_type" name="structure_type" defaultValue={existing?.structure_type ?? ''} required>
                  <option value="" disabled>Select...</option>
                  {STRUCTURE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </Select>
              </div>
              <div>
                <Label htmlFor="existing_structure_condition">Condition</Label>
                <Select id="existing_structure_condition" name="existing_structure_condition"
                  defaultValue={existing?.existing_structure_condition ?? ''}>
                  <option value="">Select...</option>
                  {STRUCTURE_CONDITIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </Select>
              </div>
            </div>

            {/* 2c: Electrical */}
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#7C818E] mb-2">Electrical & Load</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <div>
                <Label htmlFor="existing_load_kw">Existing Load (kW)</Label>
                <Input id="existing_load_kw" name="existing_load_kw" type="number" step="0.1"
                  defaultValue={existing?.existing_load_kw ?? ''} />
              </div>
              <div>
                <Label htmlFor="sanctioned_load_kw">Sanctioned Load (kW)</Label>
                <Input id="sanctioned_load_kw" name="sanctioned_load_kw" type="number" step="0.1"
                  defaultValue={existing?.sanctioned_load_kw ?? ''} />
              </div>
              <div>
                <Label htmlFor="meter_type">Meter Type</Label>
                <Select id="meter_type" name="meter_type" defaultValue={existing?.meter_type ?? ''}>
                  <option value="">Select...</option>
                  {METER_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </Select>
              </div>
              <div>
                <Label htmlFor="supply_voltage">Supply Voltage</Label>
                <Select id="supply_voltage" name="supply_voltage" defaultValue={existing?.supply_voltage ?? ''}>
                  <option value="">Select...</option>
                  {SUPPLY_VOLTAGES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </Select>
              </div>
              <div>
                <Label htmlFor="discom_name">DISCOM</Label>
                <Input id="discom_name" name="discom_name"
                  defaultValue={existing?.discom_name ?? ''} placeholder="e.g. TANGEDCO" />
              </div>
              <div>
                <Label htmlFor="earthing_type">Earthing Type</Label>
                <Select id="earthing_type" name="earthing_type" defaultValue={existing?.earthing_type ?? ''}>
                  <option value="">Select...</option>
                  {EARTHING_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </Select>
              </div>
              <div>
                <Label htmlFor="earthing_condition">Earthing Condition</Label>
                <Select id="earthing_condition" name="earthing_condition" defaultValue={existing?.earthing_condition ?? ''}>
                  <option value="">Select...</option>
                  {EARTHING_CONDITIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </Select>
              </div>
              <div className="flex items-center gap-2 pt-6">
                <Checkbox id="net_metering_eligible" name="net_metering_eligible"
                  defaultChecked={existing?.net_metering_eligible ?? false} />
                <Label htmlFor="net_metering_eligible" className="mb-0">Net Metering Eligible</Label>
              </div>
            </div>

            {/* 2d: Shading */}
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#7C818E] mb-2">Shading Analysis</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
              <div>
                <Label htmlFor="shading_assessment">Overall Shading</Label>
                <Select id="shading_assessment" name="shading_assessment" defaultValue={existing?.shading_assessment ?? ''}>
                  <option value="">Select...</option>
                  {SHADING_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </Select>
              </div>
              <div>
                <Label>Shade Sources</Label>
                <div className="flex flex-wrap gap-2 mt-1">
                  {SHADE_SOURCES.map(s => (
                    <label key={s.value} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs cursor-pointer border transition-colors ${
                      shadeSources.includes(s.value)
                        ? 'bg-[#00B050]/10 border-[#00B050] text-[#00B050]'
                        : 'bg-white border-n-300 text-[#7C818E] hover:border-n-400'
                    }`}>
                      <input type="checkbox" className="sr-only" checked={shadeSources.includes(s.value)}
                        onChange={() => toggleShadeSource(s.value)} />
                      {s.label}
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-6">
                <div className="flex items-center gap-2">
                  <Checkbox id="morning_shade" name="morning_shade" defaultChecked={existing?.morning_shade ?? false} />
                  <Label htmlFor="morning_shade" className="mb-0">Morning Shade</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox id="afternoon_shade" name="afternoon_shade" defaultChecked={existing?.afternoon_shade ?? false} />
                  <Label htmlFor="afternoon_shade" className="mb-0">Afternoon Shade</Label>
                </div>
              </div>
              <div>
                <Label htmlFor="shading_notes">Shading Notes</Label>
                <Input id="shading_notes" name="shading_notes"
                  defaultValue={existing?.shading_notes ?? ''} placeholder="Details about shading..." />
              </div>
            </div>

            {/* 2e: Recommendation */}
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#7C818E] mb-2">Recommendation</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <div>
                <Label htmlFor="recommended_size_kwp">Recommended Size (kWp)</Label>
                <Input id="recommended_size_kwp" name="recommended_size_kwp" type="number" step="0.1"
                  defaultValue={existing?.recommended_size_kwp ?? ''} />
              </div>
              <div>
                <Label htmlFor="recommended_system_type">System Type</Label>
                <Select id="recommended_system_type" name="recommended_system_type"
                  defaultValue={existing?.recommended_system_type ?? ''}>
                  <option value="">Select...</option>
                  {SYSTEM_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </Select>
              </div>
              <div>
                <Label htmlFor="estimated_generation_kwh_year">Est. Generation (kWh/yr)</Label>
                <Input id="estimated_generation_kwh_year" name="estimated_generation_kwh_year" type="number" step="0.1"
                  defaultValue={existing?.estimated_generation_kwh_year ?? ''} />
              </div>
              <div>
                <Label htmlFor="panel_placement_notes">Panel Placement</Label>
                <Input id="panel_placement_notes" name="panel_placement_notes"
                  defaultValue={existing?.panel_placement_notes ?? ''} placeholder="Layout, rows, spacing..." />
              </div>
              <div>
                <Label htmlFor="inverter_location">Inverter Location</Label>
                <Input id="inverter_location" name="inverter_location"
                  defaultValue={existing?.inverter_location ?? ''} placeholder="Ground floor, terrace..." />
              </div>
              <div>
                <Label htmlFor="cable_routing_notes">Cable Routing</Label>
                <Input id="cable_routing_notes" name="cable_routing_notes"
                  defaultValue={existing?.cable_routing_notes ?? ''} placeholder="Route description..." />
              </div>
            </div>

            {/* 2f: Feasibility Checks + Photos */}
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#7C818E] mb-2">Feasibility Checks</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Checkbox id="mounting_feasibility_checked"
                    checked={cs.mounting_feasibility_checked}
                    onCheckedChange={(v: boolean) => updateCs('mounting_feasibility_checked', v)} />
                  <Label htmlFor="mounting_feasibility_checked" className="mb-0">Mounting Feasibility Checked</Label>
                </div>
                <PhotoUpload projectId={projectId} fieldName="roof_condition"
                  currentPath={cs.roof_condition_photo_path}
                  onPathChange={(p) => updateCs('roof_condition_photo_path', p)} />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Checkbox id="shadow_analysis_done"
                    checked={cs.shadow_analysis_done}
                    onCheckedChange={(v: boolean) => updateCs('shadow_analysis_done', v)} />
                  <Label htmlFor="shadow_analysis_done" className="mb-0">Shadow Analysis Done</Label>
                </div>
                <PhotoUpload projectId={projectId} fieldName="shadow_area"
                  currentPath={cs.shadow_area_photo_path}
                  onPathChange={(p) => updateCs('shadow_area_photo_path', p)} />
              </div>
            </div>
          </CollapsibleSection>

          {/* ═══ Section 3: Client Discussion ═══ */}
          <CollapsibleSection num={3} title="Client Discussion & Approvals" isOpen={openSections.has(3)}
            onToggle={() => toggleSection(3)} isComplete={sectionComplete[2]!}>
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-3 rounded-lg border border-n-200 hover:bg-[#F8F9FA] transition-colors">
                <Checkbox id="mounting_procedure_explained"
                  checked={cs.mounting_procedure_explained}
                  onCheckedChange={(v: boolean) => updateCs('mounting_procedure_explained', v)} />
                <div>
                  <Label htmlFor="mounting_procedure_explained" className="mb-0 font-medium">Mounting Procedure Explained</Label>
                  <p className="text-xs text-[#7C818E]">Customer has been explained the mounting procedure and structure installation process</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-lg border border-n-200 hover:bg-[#F8F9FA] transition-colors">
                <Checkbox id="fixing_arrangement_discussed"
                  checked={cs.fixing_arrangement_discussed}
                  onCheckedChange={(v: boolean) => updateCs('fixing_arrangement_discussed', v)} />
                <div>
                  <Label htmlFor="fixing_arrangement_discussed" className="mb-0 font-medium">Fixing Arrangement Discussed</Label>
                  <p className="text-xs text-[#7C818E]">Panel fixing arrangement, clamps, and structure anchoring details discussed with client</p>
                </div>
              </div>
            </div>
          </CollapsibleSection>

          {/* ═══ Section 4: Equipment Location Finalization ═══ */}
          <CollapsibleSection num={4} title="Equipment Location Finalization" isOpen={openSections.has(4)}
            onToggle={() => toggleSection(4)} isComplete={sectionComplete[3]!}>
            <p className="text-xs text-[#7C818E] mb-4">
              For each equipment item, toggle whether the location has been finalized and upload a photo of the selected location.
            </p>
            <div className="space-y-3">
              {EQUIPMENT_ITEMS.map(item => {
                const toggled = cs[item.toggleKey as keyof ControlledState] as boolean;
                const photoPath = cs[item.photoKey as keyof ControlledState] as string | null;
                return (
                  <div key={item.key} className="p-3 rounded-lg border border-n-200">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Checkbox id={item.toggleKey}
                          checked={toggled}
                          onCheckedChange={(v: boolean) => updateCs(item.toggleKey as keyof ControlledState, v as never)} />
                        <Label htmlFor={item.toggleKey} className="mb-0 font-medium text-sm">{item.label}</Label>
                      </div>
                      {toggled && (
                        <Badge variant="success" className="text-[10px]">Finalized</Badge>
                      )}
                    </div>
                    {toggled && (
                      <div className="mt-2 ml-6">
                        <PhotoUpload projectId={projectId} fieldName={item.key}
                          currentPath={photoPath}
                          onPathChange={(p) => updateCs(item.photoKey as keyof ControlledState, p as never)} />
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Spare Feeder Rating — has text field + photo */}
              <div className="p-3 rounded-lg border border-n-200">
                <Label htmlFor="spare_feeder_rating" className="font-medium text-sm">Spare Feeder Rating</Label>
                <div className="mt-1.5 flex items-center gap-3">
                  <Input id="spare_feeder_rating" value={cs.spare_feeder_rating}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateCs('spare_feeder_rating', e.target.value)}
                    placeholder="e.g. 32A, 63A..." className="max-w-[200px]" />
                  {cs.spare_feeder_rating && (
                    <Badge variant="success" className="text-[10px]">Recorded</Badge>
                  )}
                </div>
                {cs.spare_feeder_rating && (
                  <div className="mt-2">
                    <PhotoUpload projectId={projectId} fieldName="spare_feeder_rating"
                      currentPath={cs.spare_feeder_rating_photo_path}
                      onPathChange={(p) => updateCs('spare_feeder_rating_photo_path', p)} />
                  </div>
                )}
              </div>
            </div>
          </CollapsibleSection>

          {/* ═══ Section 5: AC Cable Routing ═══ */}
          <CollapsibleSection num={5} title="AC Cable Routing" isOpen={openSections.has(5)}
            onToggle={() => toggleSection(5)} isComplete={sectionComplete[4]!}>
            <div className="space-y-3">
              <div className="flex items-center gap-3 p-3 rounded-lg border border-n-200">
                <Checkbox id="ac_routing_finalized"
                  checked={cs.ac_routing_finalized}
                  onCheckedChange={(v: boolean) => updateCs('ac_routing_finalized', v)} />
                <div>
                  <Label htmlFor="ac_routing_finalized" className="mb-0 font-medium">AC Routing Finalized</Label>
                  <p className="text-xs text-[#7C818E]">AC cable routing from inverter to distribution board has been planned and confirmed</p>
                </div>
              </div>
              {cs.ac_routing_finalized && (
                <div className="ml-6">
                  <PhotoUpload projectId={projectId} fieldName="ac_routing"
                    currentPath={cs.ac_routing_photo_path}
                    onPathChange={(p) => updateCs('ac_routing_photo_path', p)} />
                </div>
              )}
            </div>
          </CollapsibleSection>

          {/* ═══ Section 6: Deviations & Special Requirements ═══ */}
          <CollapsibleSection num={6} title="Deviations & Special Requirements" isOpen={openSections.has(6)}
            onToggle={() => toggleSection(6)} isComplete={sectionComplete[5]!}>
            <div className="space-y-4">
              {/* Additional Panels */}
              <div className="p-3 rounded-lg border border-n-200 space-y-2">
                <div className="flex items-center gap-2">
                  <Checkbox id="additional_panels_required"
                    checked={cs.additional_panels_required}
                    onCheckedChange={(v: boolean) => updateCs('additional_panels_required', v)} />
                  <Label htmlFor="additional_panels_required" className="mb-0 font-medium">Additional Panels Required</Label>
                </div>
                {cs.additional_panels_required && (
                  <div className="ml-6">
                    <Label htmlFor="additional_panels_remarks" className="text-xs">Remarks</Label>
                    <Input id="additional_panels_remarks" name="additional_panels_remarks"
                      defaultValue={existing?.additional_panels_remarks ?? ''} placeholder="Specify quantity, reason..." />
                  </div>
                )}
              </div>

              {/* Additional Inverter */}
              <div className="p-3 rounded-lg border border-n-200 space-y-2">
                <div className="flex items-center gap-2">
                  <Checkbox id="additional_inverter_required"
                    checked={cs.additional_inverter_required}
                    onCheckedChange={(v: boolean) => updateCs('additional_inverter_required', v)} />
                  <Label htmlFor="additional_inverter_required" className="mb-0 font-medium">Additional Inverter Required</Label>
                </div>
                {cs.additional_inverter_required && (
                  <div className="ml-6">
                    <Label htmlFor="additional_inverter_remarks" className="text-xs">Remarks</Label>
                    <Input id="additional_inverter_remarks" name="additional_inverter_remarks"
                      defaultValue={existing?.additional_inverter_remarks ?? ''} placeholder="Specify model, reason..." />
                  </div>
                )}
              </div>

              {/* Text deviations */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="routing_changes">Routing Changes</Label>
                  <textarea id="routing_changes" name="routing_changes" rows={2}
                    className="w-full rounded-md border border-n-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00B050]"
                    defaultValue={existing?.routing_changes ?? ''}
                    placeholder="Any changes to planned cable routing..." />
                </div>
                <div>
                  <Label htmlFor="cable_size_changes">Cable Size Changes</Label>
                  <textarea id="cable_size_changes" name="cable_size_changes" rows={2}
                    className="w-full rounded-md border border-n-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00B050]"
                    defaultValue={existing?.cable_size_changes ?? ''}
                    placeholder="Any changes to cable sizing..." />
                </div>
                <div className="md:col-span-2">
                  <Label htmlFor="other_special_requests">Other Special Requests</Label>
                  <textarea id="other_special_requests" name="other_special_requests" rows={2}
                    className="w-full rounded-md border border-n-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00B050]"
                    defaultValue={existing?.other_special_requests ?? ''}
                    placeholder="Any other special requirements or client requests..." />
                </div>
              </div>
            </div>
          </CollapsibleSection>

          {/* ═══ Section 7: Notes & Signatures ═══ */}
          <CollapsibleSection num={7} title="Notes & Signatures" isOpen={openSections.has(7)}
            onToggle={() => toggleSection(7)} isComplete={sectionComplete[6]!}>
            <div className="space-y-4">
              <div>
                <Label htmlFor="notes">Additional Notes</Label>
                <textarea id="notes" name="notes" rows={3}
                  className="w-full rounded-md border border-n-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00B050]"
                  defaultValue={existing?.notes ?? ''}
                  placeholder="Additional survey observations..." />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <SignaturePad label="Surveyor Signature" name="surveyor_signature"
                  defaultValue={existing?.surveyor_signature} />
                <SignaturePad label="Customer Signature" name="customer_signature"
                  defaultValue={existing?.customer_signature} />
              </div>
            </div>
          </CollapsibleSection>

          {/* ═══ Error display ═══ */}
          {error && (
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 px-3 py-2 rounded">
              <X className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          {/* ═══ Action Buttons ═══ */}
          <div className="flex items-center justify-between pt-4 border-t border-n-200">
            <Button type="button" variant="ghost" onClick={() => { setShowForm(false); onCancel?.(); }}>
              Cancel
            </Button>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" disabled={saving}
                onClick={(e) => {
                  const form = (e.target as HTMLElement).closest('form');
                  if (form) {
                    // Trigger form submission with draft status
                    const fakeEvent = { preventDefault: () => {}, currentTarget: form } as unknown as React.FormEvent<HTMLFormElement>;
                    handleSubmit(fakeEvent, 'draft');
                  }
                }}>
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
