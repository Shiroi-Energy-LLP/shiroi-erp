'use client';

/**
 * Sections 3-7 of the Site Survey form:
 *   3 Client Discussion & Approvals
 *   4 Equipment Location Finalization
 *   5 AC Cable Routing
 *   6 Deviations & Special Requirements
 *   7 Notes & Signatures
 */
import * as React from 'react';
import { Input, Label, Checkbox, Badge } from '@repo/ui';

import type { SurveyData } from './types';
import { EQUIPMENT_ITEMS } from './types';
import type { ControlledState } from './shared';
import { PhotoUpload } from './shared';
import { SignaturePad } from '../signature-pad';

// ═══════════════════════════════════════════════════════════════════════
// Section 3 — Client Discussion & Approvals
// ═══════════════════════════════════════════════════════════════════════

export function SectionClientDiscussion({
  cs,
  updateCs,
}: {
  cs: ControlledState;
  updateCs: <K extends keyof ControlledState>(key: K, value: ControlledState[K]) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 p-3 rounded-lg border border-n-200 hover:bg-[#F8F9FA] transition-colors">
        <Checkbox
          id="mounting_procedure_explained"
          checked={cs.mounting_procedure_explained}
          onCheckedChange={(v: boolean) => updateCs('mounting_procedure_explained', v)}
        />
        <div>
          <Label htmlFor="mounting_procedure_explained" className="mb-0 font-medium">
            Mounting Procedure Explained
          </Label>
          <p className="text-xs text-[#7C818E]">
            Customer has been explained the mounting procedure and structure installation process
          </p>
        </div>
      </div>
      <div className="flex items-center gap-3 p-3 rounded-lg border border-n-200 hover:bg-[#F8F9FA] transition-colors">
        <Checkbox
          id="fixing_arrangement_discussed"
          checked={cs.fixing_arrangement_discussed}
          onCheckedChange={(v: boolean) => updateCs('fixing_arrangement_discussed', v)}
        />
        <div>
          <Label htmlFor="fixing_arrangement_discussed" className="mb-0 font-medium">
            Fixing Arrangement Discussed
          </Label>
          <p className="text-xs text-[#7C818E]">
            Panel fixing arrangement, clamps, and structure anchoring details discussed with client
          </p>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Section 4 — Equipment Location Finalization
// ═══════════════════════════════════════════════════════════════════════

export function SectionEquipment({
  projectId,
  cs,
  updateCs,
}: {
  projectId: string;
  cs: ControlledState;
  updateCs: <K extends keyof ControlledState>(key: K, value: ControlledState[K]) => void;
}) {
  return (
    <>
      <p className="text-xs text-[#7C818E] mb-4">
        For each equipment item, toggle whether the location has been finalized and upload a photo of the selected location.
      </p>
      <div className="space-y-3">
        {EQUIPMENT_ITEMS.map((item) => {
          const toggled = cs[item.toggleKey as keyof ControlledState] as boolean;
          const photoPath = cs[item.photoKey as keyof ControlledState] as string | null;
          return (
            <div key={item.key} className="p-3 rounded-lg border border-n-200">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id={item.toggleKey}
                    checked={toggled}
                    onCheckedChange={(v: boolean) =>
                      updateCs(item.toggleKey as keyof ControlledState, v as never)
                    }
                  />
                  <Label htmlFor={item.toggleKey} className="mb-0 font-medium text-sm">
                    {item.label}
                  </Label>
                </div>
                {toggled && (
                  <Badge variant="success" className="text-[10px]">Finalized</Badge>
                )}
              </div>
              {toggled && (
                <div className="mt-2 ml-6">
                  <PhotoUpload
                    projectId={projectId}
                    fieldName={item.key}
                    currentPath={photoPath}
                    onPathChange={(p) =>
                      updateCs(item.photoKey as keyof ControlledState, p as never)
                    }
                  />
                </div>
              )}
            </div>
          );
        })}

        {/* Spare Feeder Rating — has text field + photo */}
        <div className="p-3 rounded-lg border border-n-200">
          <Label htmlFor="spare_feeder_rating" className="font-medium text-sm">
            Spare Feeder Rating
          </Label>
          <div className="mt-1.5 flex items-center gap-3">
            <Input
              id="spare_feeder_rating"
              value={cs.spare_feeder_rating}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                updateCs('spare_feeder_rating', e.target.value)
              }
              placeholder="e.g. 32A, 63A..."
              className="max-w-[200px]"
            />
            {cs.spare_feeder_rating && (
              <Badge variant="success" className="text-[10px]">Recorded</Badge>
            )}
          </div>
          {cs.spare_feeder_rating && (
            <div className="mt-2">
              <PhotoUpload
                projectId={projectId}
                fieldName="spare_feeder_rating"
                currentPath={cs.spare_feeder_rating_photo_path}
                onPathChange={(p) => updateCs('spare_feeder_rating_photo_path', p)}
              />
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Section 5 — AC Cable Routing
// ═══════════════════════════════════════════════════════════════════════

export function SectionAcRouting({
  projectId,
  cs,
  updateCs,
}: {
  projectId: string;
  cs: ControlledState;
  updateCs: <K extends keyof ControlledState>(key: K, value: ControlledState[K]) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 p-3 rounded-lg border border-n-200">
        <Checkbox
          id="ac_routing_finalized"
          checked={cs.ac_routing_finalized}
          onCheckedChange={(v: boolean) => updateCs('ac_routing_finalized', v)}
        />
        <div>
          <Label htmlFor="ac_routing_finalized" className="mb-0 font-medium">
            AC Routing Finalized
          </Label>
          <p className="text-xs text-[#7C818E]">
            AC cable routing from inverter to distribution board has been planned and confirmed
          </p>
        </div>
      </div>
      {cs.ac_routing_finalized && (
        <div className="ml-6">
          <PhotoUpload
            projectId={projectId}
            fieldName="ac_routing"
            currentPath={cs.ac_routing_photo_path}
            onPathChange={(p) => updateCs('ac_routing_photo_path', p)}
          />
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Section 6 — Deviations & Special Requirements
// ═══════════════════════════════════════════════════════════════════════

export function SectionDeviations({
  existing,
  cs,
  updateCs,
}: {
  existing: SurveyData | null | undefined;
  cs: ControlledState;
  updateCs: <K extends keyof ControlledState>(key: K, value: ControlledState[K]) => void;
}) {
  return (
    <div className="space-y-4">
      {/* Additional Panels */}
      <div className="p-3 rounded-lg border border-n-200 space-y-2">
        <div className="flex items-center gap-2">
          <Checkbox
            id="additional_panels_required"
            checked={cs.additional_panels_required}
            onCheckedChange={(v: boolean) => updateCs('additional_panels_required', v)}
          />
          <Label htmlFor="additional_panels_required" className="mb-0 font-medium">
            Additional Panels Required
          </Label>
        </div>
        {cs.additional_panels_required && (
          <div className="ml-6">
            <Label htmlFor="additional_panels_remarks" className="text-xs">Remarks</Label>
            <Input
              id="additional_panels_remarks"
              name="additional_panels_remarks"
              defaultValue={existing?.additional_panels_remarks ?? ''}
              placeholder="Specify quantity, reason..."
            />
          </div>
        )}
      </div>

      {/* Additional Inverter */}
      <div className="p-3 rounded-lg border border-n-200 space-y-2">
        <div className="flex items-center gap-2">
          <Checkbox
            id="additional_inverter_required"
            checked={cs.additional_inverter_required}
            onCheckedChange={(v: boolean) => updateCs('additional_inverter_required', v)}
          />
          <Label htmlFor="additional_inverter_required" className="mb-0 font-medium">
            Additional Inverter Required
          </Label>
        </div>
        {cs.additional_inverter_required && (
          <div className="ml-6">
            <Label htmlFor="additional_inverter_remarks" className="text-xs">Remarks</Label>
            <Input
              id="additional_inverter_remarks"
              name="additional_inverter_remarks"
              defaultValue={existing?.additional_inverter_remarks ?? ''}
              placeholder="Specify model, reason..."
            />
          </div>
        )}
      </div>

      {/* Text deviations */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <Label htmlFor="routing_changes">Routing Changes</Label>
          <textarea
            id="routing_changes"
            name="routing_changes"
            rows={2}
            className="w-full rounded-md border border-n-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00B050]"
            defaultValue={existing?.routing_changes ?? ''}
            placeholder="Any changes to planned cable routing..."
          />
        </div>
        <div>
          <Label htmlFor="cable_size_changes">Cable Size Changes</Label>
          <textarea
            id="cable_size_changes"
            name="cable_size_changes"
            rows={2}
            className="w-full rounded-md border border-n-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00B050]"
            defaultValue={existing?.cable_size_changes ?? ''}
            placeholder="Any changes to cable sizing..."
          />
        </div>
        <div className="md:col-span-2">
          <Label htmlFor="other_special_requests">Other Special Requests</Label>
          <textarea
            id="other_special_requests"
            name="other_special_requests"
            rows={2}
            className="w-full rounded-md border border-n-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00B050]"
            defaultValue={existing?.other_special_requests ?? ''}
            placeholder="Any other special requirements or client requests..."
          />
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Section 7 — Notes & Signatures
// ═══════════════════════════════════════════════════════════════════════

export function SectionSignatures({
  existing,
}: {
  existing: SurveyData | null | undefined;
}) {
  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="notes">Additional Notes</Label>
        <textarea
          id="notes"
          name="notes"
          rows={3}
          className="w-full rounded-md border border-n-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00B050]"
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
  );
}
