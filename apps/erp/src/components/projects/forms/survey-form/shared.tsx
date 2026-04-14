'use client';

/**
 * Shared building blocks for the Site Survey form:
 *   - CollapsibleSection: the numbered accordion card wrapping each section
 *   - PhotoUpload: file picker + Supabase Storage upload + preview
 *   - ProgressBar: "X% complete (Y/Z sections)"
 *   - ControlledState: toggles + photo paths held in React state
 *   - initControlledState: bootstraps state from the existing survey row
 *   - validateForSubmit: hard validation gate on "Submit"
 *
 * The heavy field-by-field validation stays in the main form shell
 * because it needs access to the ref to the <form> element to read
 * uncontrolled fields.
 */
import * as React from 'react';
import { createClient } from '@repo/supabase/client';
import { ChevronDown, ChevronUp, Check, Camera, Upload, X } from 'lucide-react';

import type { SurveyData } from './types';
import { EQUIPMENT_ITEMS } from './types';

// ═══════════════════════════════════════════════════════════════════════
// CollapsibleSection
// ═══════════════════════════════════════════════════════════════════════

export function CollapsibleSection({
  num,
  title,
  isOpen,
  onToggle,
  isComplete,
  children,
}: {
  num: number;
  title: string;
  isOpen: boolean;
  onToggle: () => void;
  isComplete: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-n-200 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 bg-[#F8F9FA] hover:bg-[#F0F1F3] transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          <span
            className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
              isComplete ? 'bg-green-100 text-green-700' : 'bg-n-200 text-n-600'
            }`}
          >
            {isComplete ? <Check className="h-3.5 w-3.5" /> : num}
          </span>
          <span className="text-sm font-semibold text-[#1A1D24]">{title}</span>
        </div>
        {isOpen ? (
          <ChevronUp className="h-4 w-4 text-[#7C818E]" />
        ) : (
          <ChevronDown className="h-4 w-4 text-[#7C818E]" />
        )}
      </button>
      {isOpen && <div className="px-4 py-4 bg-white border-t border-n-200">{children}</div>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// PhotoUpload — uploads to the `site-photos` bucket under
// surveys/{projectId}/{fieldName}_{timestamp}.{ext}
// ═══════════════════════════════════════════════════════════════════════

export function PhotoUpload({
  projectId,
  fieldName,
  currentPath,
  onPathChange,
}: {
  projectId: string;
  fieldName: string;
  currentPath: string | null;
  onPathChange: (path: string | null) => void;
}) {
  const [uploading, setUploading] = React.useState(false);
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!currentPath) {
      setPreviewUrl(null);
      return;
    }
    const supabase = createClient();
    supabase.storage.from('site-photos').createSignedUrl(currentPath, 300).then(({ data }) => {
      if (data?.signedUrl) setPreviewUrl(data.signedUrl);
    });
  }, [currentPath]);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
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
          <button
            type="button"
            onClick={handleRemove}
            className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-red-500 text-white flex items-center justify-center hover:bg-red-600 transition-colors"
          >
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
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="text-xs text-blue-600 hover:text-blue-800 underline"
            >
              Replace
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="text-xs text-[#7C818E] hover:text-[#1A1D24] flex items-center gap-1 border border-dashed border-n-300 rounded px-2 py-1 hover:border-n-400 transition-colors"
          >
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
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleFileChange}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// ProgressBar
// ═══════════════════════════════════════════════════════════════════════

export function ProgressBar({ completed, total }: { completed: number; total: number }) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  return (
    <div className="flex items-center gap-3 mb-4">
      <div className="flex-1 h-2 bg-n-200 rounded-full overflow-hidden">
        <div
          className="h-full bg-[#00B050] rounded-full transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs font-medium text-[#7C818E] whitespace-nowrap">
        {pct}% complete ({completed}/{total})
      </span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Controlled-state — toggles + photo paths held outside form fields
// ═══════════════════════════════════════════════════════════════════════

export interface ControlledState {
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

export function initControlledState(ex: SurveyData | null | undefined): ControlledState {
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

// ═══════════════════════════════════════════════════════════════════════
// validateForSubmit — the hard gate that runs on "Submit" (not "Draft")
// Returns an error message string, or null if the form is valid.
// Pass the form ref so we can read the signature inputs from FormData.
// ═══════════════════════════════════════════════════════════════════════

export function validateForSubmit(
  cs: ControlledState,
  gpsLat: string,
  gpsLng: string,
  formEl: HTMLFormElement | null,
): string | null {
  if (!gpsLat || !gpsLng) {
    return 'GPS coordinates are mandatory. Use "Capture GPS" or enter manually.';
  }
  if (!cs.roof_condition_photo_path) return 'Roof condition photo is mandatory.';
  if (!cs.shadow_area_photo_path) return 'Shadow area photo is mandatory.';

  for (const item of EQUIPMENT_ITEMS) {
    const toggled = cs[item.toggleKey as keyof ControlledState] as boolean;
    const photoPath = cs[item.photoKey as keyof ControlledState] as string | null;
    if (toggled && !photoPath) {
      return `${item.label}: photo is required when marked as finalized.`;
    }
  }

  if (cs.ac_routing_finalized && !cs.ac_routing_photo_path) {
    return 'AC routing photo is required when marked as finalized.';
  }

  if (formEl) {
    const fd = new FormData(formEl);
    const survSig = fd.get('surveyor_signature') as string | null;
    const custSig = fd.get('customer_signature') as string | null;
    if (!survSig) return 'Surveyor/Engineer signature is mandatory before submission.';
    if (!custSig) return 'Client/Customer signature is mandatory before submission.';
  }

  return null;
}
