'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Card, CardHeader, CardTitle, CardContent,
  Button, Input, Label, Select, Checkbox,
} from '@repo/ui';
import { createOrUpdateSurvey } from '@/lib/project-step-actions';
import { SignaturePad } from './signature-pad';
import { MapPin } from 'lucide-react';

export interface SurveyData {
  id: string;
  // Original fields
  roof_type: string | null;
  structure_type: string | null;
  roof_area_sqft: number | null;
  usable_area_sqft: number | null;
  shading_assessment: string | null;
  shading_notes: string | null;
  existing_load_kw: number | null;
  sanctioned_load_kw: number | null;
  meter_type: string | null;
  discom_name: string | null;
  net_metering_eligible: boolean | null;
  recommended_size_kwp: number | null;
  recommended_system_type: string | null;
  survey_date: string;
  notes: string | null;
  // New: Section 1 - Site Info
  gps_lat: number | null;
  gps_lng: number | null;
  contact_person_name: string | null;
  contact_phone: string | null;
  site_access_notes: string | null;
  // New: Section 2 - Roof (additional)
  roof_condition: string | null;
  roof_age_years: number | null;
  roof_orientation: string | null;
  roof_tilt_degrees: number | null;
  number_of_floors: number | null;
  building_height_ft: number | null;
  // New: Section 3 - Structure (additional)
  existing_structure_condition: string | null;
  // New: Section 4 - Electrical (additional)
  supply_voltage: string | null;
  earthing_type: string | null;
  earthing_condition: string | null;
  // New: Section 5 - Shading (additional)
  shade_sources: string[] | null;
  morning_shade: boolean | null;
  afternoon_shade: boolean | null;
  // New: Section 6 - Recommendation (additional)
  panel_placement_notes: string | null;
  inverter_location: string | null;
  cable_routing_notes: string | null;
  estimated_generation_kwh_year: number | null;
  // New: Section 7 - Signatures
  surveyor_signature: string | null;
  customer_signature: string | null;
}

interface SurveyFormProps {
  projectId: string;
  existing?: SurveyData | null;
  onCancel?: () => void;
}

// value → label pairs matching DB check constraints
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

export function SurveyForm({ projectId, existing, onCancel }: SurveyFormProps) {
  const router = useRouter();
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [showForm, setShowForm] = React.useState(false);
  const [gpsLat, setGpsLat] = React.useState(existing?.gps_lat?.toString() ?? '');
  const [gpsLng, setGpsLng] = React.useState(existing?.gps_lng?.toString() ?? '');
  const [gpsLoading, setGpsLoading] = React.useState(false);
  const [shadeSources, setShadeSources] = React.useState<string[]>(existing?.shade_sources ?? []);

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
    setShadeSources(prev =>
      prev.includes(val) ? prev.filter(s => s !== val) : [...prev, val]
    );
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const fd = new FormData(e.currentTarget);
    const getString = (key: string) => (fd.get(key) as string) || null;
    const getNum = (key: string) => {
      const v = fd.get(key) as string;
      return v ? parseFloat(v) : null;
    };
    const getInt = (key: string) => {
      const v = fd.get(key) as string;
      return v ? parseInt(v, 10) : null;
    };

    const result = await createOrUpdateSurvey({
      projectId,
      surveyId: existing?.id,
      data: {
        // Original fields
        roof_type: getString('roof_type') ?? '',
        structure_type: getString('structure_type') ?? '',
        roof_area_sqft: getNum('roof_area_sqft'),
        usable_area_sqft: getNum('usable_area_sqft'),
        shading_assessment: getString('shading_assessment'),
        shading_notes: getString('shading_notes'),
        existing_load_kw: getNum('existing_load_kw'),
        sanctioned_load_kw: getNum('sanctioned_load_kw'),
        meter_type: getString('meter_type'),
        discom_name: getString('discom_name'),
        net_metering_eligible: fd.get('net_metering_eligible') === 'on',
        recommended_size_kwp: getNum('recommended_size_kwp'),
        recommended_system_type: getString('recommended_system_type'),
        survey_date: getString('survey_date') ?? new Date().toISOString().split('T')[0]!,
        notes: getString('notes'),
        // Section 1: Site Info
        gps_lat: getNum('gps_lat'),
        gps_lng: getNum('gps_lng'),
        contact_person_name: getString('contact_person_name'),
        contact_phone: getString('contact_phone'),
        site_access_notes: getString('site_access_notes'),
        // Section 2: Roof (additional)
        roof_condition: getString('roof_condition'),
        roof_age_years: getInt('roof_age_years'),
        roof_orientation: getString('roof_orientation'),
        roof_tilt_degrees: getNum('roof_tilt_degrees'),
        number_of_floors: getInt('number_of_floors'),
        building_height_ft: getNum('building_height_ft'),
        // Section 3: Structure
        existing_structure_condition: getString('existing_structure_condition'),
        // Section 4: Electrical
        supply_voltage: getString('supply_voltage'),
        earthing_type: getString('earthing_type'),
        earthing_condition: getString('earthing_condition'),
        // Section 5: Shading
        shade_sources: shadeSources.length > 0 ? shadeSources : null,
        morning_shade: fd.get('morning_shade') === 'on',
        afternoon_shade: fd.get('afternoon_shade') === 'on',
        // Section 6: Recommendation
        panel_placement_notes: getString('panel_placement_notes'),
        inverter_location: getString('inverter_location'),
        cable_routing_notes: getString('cable_routing_notes'),
        estimated_generation_kwh_year: getNum('estimated_generation_kwh_year'),
        // Section 7: Signatures
        surveyor_signature: getString('surveyor_signature'),
        customer_signature: getString('customer_signature'),
      },
    });

    setSaving(false);
    if (result.success) {
      setShowForm(false);
      router.push(`/projects/${projectId}?tab=bom`);
      router.refresh();
    } else {
      setError(result.error ?? 'Failed to save survey');
    }
  }

  if (!showForm) {
    return (
      <div className="mb-4">
        <Button size="sm" onClick={() => setShowForm(true)}>
          {existing ? 'Edit Survey' : '+ Create Site Survey'}
        </Button>
      </div>
    );
  }

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="text-base">{existing ? 'Edit Site Survey' : 'New Site Survey'}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-8">
          {/* ─── Section 1: Site Information ─── */}
          <section>
            <h4 className="text-sm font-semibold text-n-700 mb-3 pb-2 border-b border-n-200">
              1. Site Information
            </h4>
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
                    className="h-9 px-2 shrink-0">
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
          </section>

          {/* ─── Section 2: Roof Details ─── */}
          <section>
            <h4 className="text-sm font-semibold text-n-700 mb-3 pb-2 border-b border-n-200">
              2. Roof Details
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label htmlFor="roof_type">Roof Type *</Label>
                <Select id="roof_type" name="roof_type" defaultValue={existing?.roof_type ?? ''} required>
                  <option value="" disabled>Select...</option>
                  {ROOF_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </Select>
              </div>
              <div>
                <Label htmlFor="roof_condition">Roof Condition</Label>
                <Select id="roof_condition" name="roof_condition" defaultValue={existing?.roof_condition ?? ''}>
                  <option value="">Select...</option>
                  {ROOF_CONDITIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </Select>
              </div>
              <div>
                <Label htmlFor="roof_age_years">Roof Age (years)</Label>
                <Input id="roof_age_years" name="roof_age_years" type="number" min="0"
                  defaultValue={existing?.roof_age_years ?? ''} />
              </div>
              <div>
                <Label htmlFor="roof_orientation">Orientation</Label>
                <Select id="roof_orientation" name="roof_orientation" defaultValue={existing?.roof_orientation ?? ''}>
                  <option value="">Select...</option>
                  {ROOF_ORIENTATIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </Select>
              </div>
              <div>
                <Label htmlFor="roof_tilt_degrees">Tilt (degrees)</Label>
                <Input id="roof_tilt_degrees" name="roof_tilt_degrees" type="number" step="0.1" min="0" max="90"
                  defaultValue={existing?.roof_tilt_degrees ?? ''} />
              </div>
              <div>
                <Label htmlFor="roof_area_sqft">Total Roof Area (sq.ft)</Label>
                <Input id="roof_area_sqft" name="roof_area_sqft" type="number" step="0.1"
                  defaultValue={existing?.roof_area_sqft ?? ''} />
              </div>
              <div>
                <Label htmlFor="usable_area_sqft">Usable Area (sq.ft)</Label>
                <Input id="usable_area_sqft" name="usable_area_sqft" type="number" step="0.1"
                  defaultValue={existing?.usable_area_sqft ?? ''} />
              </div>
              <div>
                <Label htmlFor="number_of_floors">Number of Floors</Label>
                <Input id="number_of_floors" name="number_of_floors" type="number" min="1"
                  defaultValue={existing?.number_of_floors ?? ''} />
              </div>
              <div>
                <Label htmlFor="building_height_ft">Building Height (ft)</Label>
                <Input id="building_height_ft" name="building_height_ft" type="number" step="0.1"
                  defaultValue={existing?.building_height_ft ?? ''} />
              </div>
            </div>
          </section>

          {/* ─── Section 3: Structure ─── */}
          <section>
            <h4 className="text-sm font-semibold text-n-700 mb-3 pb-2 border-b border-n-200">
              3. Structure
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label htmlFor="structure_type">Structure Type *</Label>
                <Select id="structure_type" name="structure_type" defaultValue={existing?.structure_type ?? ''} required>
                  <option value="" disabled>Select...</option>
                  {STRUCTURE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </Select>
              </div>
              <div>
                <Label htmlFor="existing_structure_condition">Existing Structure Condition</Label>
                <Select id="existing_structure_condition" name="existing_structure_condition"
                  defaultValue={existing?.existing_structure_condition ?? ''}>
                  <option value="">Select...</option>
                  {STRUCTURE_CONDITIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </Select>
              </div>
            </div>
          </section>

          {/* ─── Section 4: Electrical ─── */}
          <section>
            <h4 className="text-sm font-semibold text-n-700 mb-3 pb-2 border-b border-n-200">
              4. Electrical & Load
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
                  {METER_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </Select>
              </div>
              <div>
                <Label htmlFor="supply_voltage">Supply Voltage</Label>
                <Select id="supply_voltage" name="supply_voltage" defaultValue={existing?.supply_voltage ?? ''}>
                  <option value="">Select...</option>
                  {SUPPLY_VOLTAGES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
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
                  {EARTHING_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </Select>
              </div>
              <div>
                <Label htmlFor="earthing_condition">Earthing Condition</Label>
                <Select id="earthing_condition" name="earthing_condition" defaultValue={existing?.earthing_condition ?? ''}>
                  <option value="">Select...</option>
                  {EARTHING_CONDITIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </Select>
              </div>
              <div className="flex items-center gap-2 pt-6">
                <Checkbox id="net_metering_eligible" name="net_metering_eligible"
                  defaultChecked={existing?.net_metering_eligible ?? false} />
                <Label htmlFor="net_metering_eligible" className="mb-0">Net Metering Eligible</Label>
              </div>
            </div>
          </section>

          {/* ─── Section 5: Shading Analysis ─── */}
          <section>
            <h4 className="text-sm font-semibold text-n-700 mb-3 pb-2 border-b border-n-200">
              5. Shading Analysis
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="shading_assessment">Overall Shading</Label>
                <Select id="shading_assessment" name="shading_assessment" defaultValue={existing?.shading_assessment ?? ''}>
                  <option value="">Select...</option>
                  {SHADING_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </Select>
              </div>
              <div>
                <Label>Shade Sources</Label>
                <div className="flex flex-wrap gap-2 mt-1">
                  {SHADE_SOURCES.map((s) => (
                    <label key={s.value} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs cursor-pointer border transition-colors ${
                      shadeSources.includes(s.value)
                        ? 'bg-shiroi-green/10 border-shiroi-green text-shiroi-green'
                        : 'bg-white border-n-300 text-n-600 hover:border-n-400'
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
                  <Checkbox id="morning_shade" name="morning_shade"
                    defaultChecked={existing?.morning_shade ?? false} />
                  <Label htmlFor="morning_shade" className="mb-0">Morning Shade</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox id="afternoon_shade" name="afternoon_shade"
                    defaultChecked={existing?.afternoon_shade ?? false} />
                  <Label htmlFor="afternoon_shade" className="mb-0">Afternoon Shade</Label>
                </div>
              </div>
              <div>
                <Label htmlFor="shading_notes">Shading Notes</Label>
                <Input id="shading_notes" name="shading_notes"
                  defaultValue={existing?.shading_notes ?? ''} placeholder="Details about shading..." />
              </div>
            </div>
          </section>

          {/* ─── Section 6: Recommendation ─── */}
          <section>
            <h4 className="text-sm font-semibold text-n-700 mb-3 pb-2 border-b border-n-200">
              6. Recommendation
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
                  {SYSTEM_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </Select>
              </div>
              <div>
                <Label htmlFor="estimated_generation_kwh_year">Est. Generation (kWh/year)</Label>
                <Input id="estimated_generation_kwh_year" name="estimated_generation_kwh_year" type="number" step="0.1"
                  defaultValue={existing?.estimated_generation_kwh_year ?? ''} />
              </div>
              <div>
                <Label htmlFor="panel_placement_notes">Panel Placement Notes</Label>
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
          </section>

          {/* ─── Section 7: Notes & Signatures ─── */}
          <section>
            <h4 className="text-sm font-semibold text-n-700 mb-3 pb-2 border-b border-n-200">
              7. Notes & Sign-off
            </h4>
            <div className="space-y-4">
              <div>
                <Label htmlFor="notes">Additional Notes</Label>
                <textarea
                  id="notes"
                  name="notes"
                  rows={3}
                  className="w-full rounded-md border border-n-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-p-500"
                  defaultValue={existing?.notes ?? ''}
                  placeholder="Additional survey observations..."
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <SignaturePad
                  label="Surveyor Signature"
                  name="surveyor_signature"
                  defaultValue={existing?.surveyor_signature}
                />
                <SignaturePad
                  label="Customer Signature"
                  name="customer_signature"
                  defaultValue={existing?.customer_signature}
                />
              </div>
            </div>
          </section>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">{error}</p>
          )}

          <div className="flex justify-end gap-2 pt-4 border-t border-n-200">
            <Button type="button" variant="ghost" onClick={() => { setShowForm(false); onCancel?.(); }}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving...' : existing ? 'Update Survey' : 'Create Survey'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
