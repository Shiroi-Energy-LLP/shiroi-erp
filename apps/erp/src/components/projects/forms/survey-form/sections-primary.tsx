'use client';

/**
 * Sections 1 + 2 of the Site Survey form — the heaviest section
 * because Section 2 (Mounting & Site Feasibility) holds ~35 fields
 * across 6 sub-groups (Roof, Structure, Electrical, Shading,
 * Recommendation, Feasibility photos).
 *
 * These components receive their state as props — the main shell
 * (../index.tsx) owns the state and passes it down.
 */
import * as React from 'react';
import { Input, Label, Select, Checkbox, Button } from '@repo/ui';
import { MapPin } from 'lucide-react';

import type { SurveyData } from './types';
import {
  ROOF_TYPES, ROOF_CONDITIONS, ROOF_ORIENTATIONS,
  STRUCTURE_TYPES, STRUCTURE_CONDITIONS,
  METER_TYPES, SUPPLY_VOLTAGES, EARTHING_TYPES, EARTHING_CONDITIONS,
  SHADING_OPTIONS, SHADE_SOURCES, SYSTEM_TYPES,
} from './types';
import type { ControlledState } from './shared';
import { PhotoUpload } from './shared';

// ═══════════════════════════════════════════════════════════════════════
// Section 1 — Project Details / Site Info
// ═══════════════════════════════════════════════════════════════════════

export function SectionProjectDetails({
  existing,
  gpsLat,
  gpsLng,
  setGpsLat,
  setGpsLng,
  captureGPS,
  gpsLoading,
}: {
  existing: SurveyData | null | undefined;
  gpsLat: string;
  gpsLng: string;
  setGpsLat: (v: string) => void;
  setGpsLng: (v: string) => void;
  captureGPS: () => void;
  gpsLoading: boolean;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div>
        <Label htmlFor="survey_date">Survey Date *</Label>
        <Input
          id="survey_date"
          name="survey_date"
          type="date"
          defaultValue={existing?.survey_date ?? new Date().toISOString().split('T')[0]}
          required
        />
      </div>
      <div>
        <Label htmlFor="contact_person_name">Contact Person</Label>
        <Input
          id="contact_person_name"
          name="contact_person_name"
          defaultValue={existing?.contact_person_name ?? ''}
          placeholder="On-site contact"
        />
      </div>
      <div>
        <Label htmlFor="contact_phone">Contact Phone</Label>
        <Input
          id="contact_phone"
          name="contact_phone"
          type="tel"
          defaultValue={existing?.contact_phone ?? ''}
          placeholder="+91..."
        />
      </div>
      <div>
        <Label>GPS Coordinates</Label>
        <div className="flex items-center gap-2">
          <Input
            name="gps_lat"
            type="number"
            step="0.000001"
            placeholder="Latitude"
            value={gpsLat}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setGpsLat(e.target.value)}
            className="flex-1"
          />
          <Input
            name="gps_lng"
            type="number"
            step="0.000001"
            placeholder="Longitude"
            value={gpsLng}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setGpsLng(e.target.value)}
            className="flex-1"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={captureGPS}
            disabled={gpsLoading}
            className="h-9 px-2 shrink-0"
            title="Capture GPS"
          >
            <MapPin className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div className="md:col-span-2">
        <Label htmlFor="site_access_notes">Site Access Notes</Label>
        <Input
          id="site_access_notes"
          name="site_access_notes"
          defaultValue={existing?.site_access_notes ?? ''}
          placeholder="Parking, key person, gate code..."
        />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Section 2 — Mounting & Site Feasibility
// Six sub-groups rendered inline:
//   2a Roof · 2b Structure · 2c Electrical · 2d Shading
//   2e Recommendation · 2f Feasibility Checks + Photos
// ═══════════════════════════════════════════════════════════════════════

export function SectionFeasibility({
  existing,
  projectId,
  cs,
  updateCs,
  shadeSources,
  toggleShadeSource,
}: {
  existing: SurveyData | null | undefined;
  projectId: string;
  cs: ControlledState;
  updateCs: <K extends keyof ControlledState>(key: K, value: ControlledState[K]) => void;
  shadeSources: string[];
  toggleShadeSource: (val: string) => void;
}) {
  return (
    <>
      {/* 2a: Roof Details */}
      <p className="text-[11px] font-semibold uppercase tracking-wider text-[#7C818E] mb-2">Roof Details</p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div>
          <Label htmlFor="roof_type">Roof Type *</Label>
          <Select id="roof_type" name="roof_type" defaultValue={existing?.roof_type ?? ''} required>
            <option value="" disabled>Select...</option>
            {ROOF_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="roof_condition">Condition</Label>
          <Select id="roof_condition" name="roof_condition" defaultValue={existing?.roof_condition ?? ''}>
            <option value="">Select...</option>
            {ROOF_CONDITIONS.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
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
            {ROOF_ORIENTATIONS.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
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
            {STRUCTURE_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="existing_structure_condition">Condition</Label>
          <Select
            id="existing_structure_condition"
            name="existing_structure_condition"
            defaultValue={existing?.existing_structure_condition ?? ''}
          >
            <option value="">Select...</option>
            {STRUCTURE_CONDITIONS.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </Select>
        </div>
      </div>

      {/* 2c: Electrical & Load */}
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
            {METER_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="supply_voltage">Supply Voltage</Label>
          <Select id="supply_voltage" name="supply_voltage" defaultValue={existing?.supply_voltage ?? ''}>
            <option value="">Select...</option>
            {SUPPLY_VOLTAGES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="discom_name">DISCOM</Label>
          <Input id="discom_name" name="discom_name" defaultValue={existing?.discom_name ?? ''}
            placeholder="e.g. TANGEDCO" />
        </div>
        <div>
          <Label htmlFor="earthing_type">Earthing Type</Label>
          <Select id="earthing_type" name="earthing_type" defaultValue={existing?.earthing_type ?? ''}>
            <option value="">Select...</option>
            {EARTHING_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="earthing_condition">Earthing Condition</Label>
          <Select id="earthing_condition" name="earthing_condition"
            defaultValue={existing?.earthing_condition ?? ''}>
            <option value="">Select...</option>
            {EARTHING_CONDITIONS.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
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
          <Select id="shading_assessment" name="shading_assessment"
            defaultValue={existing?.shading_assessment ?? ''}>
            <option value="">Select...</option>
            {SHADING_OPTIONS.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Shade Sources</Label>
          <div className="flex flex-wrap gap-2 mt-1">
            {SHADE_SOURCES.map((s) => (
              <label
                key={s.value}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs cursor-pointer border transition-colors ${
                  shadeSources.includes(s.value)
                    ? 'bg-[#00B050]/10 border-[#00B050] text-[#00B050]'
                    : 'bg-white border-n-300 text-[#7C818E] hover:border-n-400'
                }`}
              >
                <input type="checkbox" className="sr-only"
                  checked={shadeSources.includes(s.value)}
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
          <Input id="shading_notes" name="shading_notes" defaultValue={existing?.shading_notes ?? ''}
            placeholder="Details about shading..." />
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
            {SYSTEM_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="estimated_generation_kwh_year">Est. Generation (kWh/yr)</Label>
          <Input id="estimated_generation_kwh_year" name="estimated_generation_kwh_year"
            type="number" step="0.1"
            defaultValue={existing?.estimated_generation_kwh_year ?? ''} />
        </div>
        <div>
          <Label htmlFor="panel_placement_notes">Panel Placement</Label>
          <Input id="panel_placement_notes" name="panel_placement_notes"
            defaultValue={existing?.panel_placement_notes ?? ''}
            placeholder="Layout, rows, spacing..." />
        </div>
        <div>
          <Label htmlFor="inverter_location">Inverter Location</Label>
          <Input id="inverter_location" name="inverter_location"
            defaultValue={existing?.inverter_location ?? ''}
            placeholder="Ground floor, terrace..." />
        </div>
        <div>
          <Label htmlFor="cable_routing_notes">Cable Routing</Label>
          <Input id="cable_routing_notes" name="cable_routing_notes"
            defaultValue={existing?.cable_routing_notes ?? ''}
            placeholder="Route description..." />
        </div>
      </div>

      {/* 2f: Feasibility Checks + Photos */}
      <p className="text-[11px] font-semibold uppercase tracking-wider text-[#7C818E] mb-2">Feasibility Checks</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Checkbox
              id="mounting_feasibility_checked"
              checked={cs.mounting_feasibility_checked}
              onCheckedChange={(v: boolean) => updateCs('mounting_feasibility_checked', v)}
            />
            <Label htmlFor="mounting_feasibility_checked" className="mb-0">
              Mounting Feasibility Checked
            </Label>
          </div>
          <PhotoUpload
            projectId={projectId}
            fieldName="roof_condition"
            currentPath={cs.roof_condition_photo_path}
            onPathChange={(p) => updateCs('roof_condition_photo_path', p)}
          />
        </div>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Checkbox
              id="shadow_analysis_done"
              checked={cs.shadow_analysis_done}
              onCheckedChange={(v: boolean) => updateCs('shadow_analysis_done', v)}
            />
            <Label htmlFor="shadow_analysis_done" className="mb-0">Shadow Analysis Done</Label>
          </div>
          <PhotoUpload
            projectId={projectId}
            fieldName="shadow_area"
            currentPath={cs.shadow_area_photo_path}
            onPathChange={(p) => updateCs('shadow_area_photo_path', p)}
          />
        </div>
      </div>
    </>
  );
}
