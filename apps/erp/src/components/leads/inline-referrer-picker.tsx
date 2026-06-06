'use client';

import * as React from 'react';
import { Select, useToast } from '@repo/ui';
import { setLeadReferrer } from '@/lib/lead-referrer-actions';
import type { PartnerPickerOption } from '@/lib/partners-queries';

interface InlineReferrerPickerProps {
  leadId: string;
  currentPartnerId: string | null;
  partners: PartnerPickerOption[];
}

/**
 * Inline auto-save Referrer dropdown for the lead detail page.
 *
 * Replaces the previous "Change" link + dialog. Renders directly inside the
 * Lead Details card as a compact <select> that fires the server action on
 * change (debounced via a useTransition hook so quick clicks don't double-fire).
 *
 * The label "MGMT REF" is appended inline to internal-partner options so users
 * can see at a glance which choice means Vivek/Management.
 */
export function InlineReferrerPicker({
  leadId,
  currentPartnerId,
  partners,
}: InlineReferrerPickerProps) {
  const { addToast } = useToast();
  const [value, setValue] = React.useState<string>(currentPartnerId ?? '');
  const [saving, setSaving] = React.useState(false);

  const internal = partners.filter((p) => p.is_internal);
  const external = partners.filter((p) => !p.is_internal);

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const op = '[InlineReferrerPicker.handleChange]';
    const next = e.target.value || null;
    const prev = value;
    setValue(next ?? '');
    setSaving(true);
    try {
      const result = await setLeadReferrer(leadId, next);
      if (!result.success) {
        // Revert local state on failure
        setValue(prev);
        console.error(`${op} failed`, { leadId, next, error: result.error });
        addToast({ variant: 'destructive', title: 'Could not update referrer', description: result.error });
      } else {
        addToast({ variant: 'success', title: 'Referrer updated' });
      }
    } catch (err) {
      setValue(prev);
      console.error(`${op} threw`, { leadId, next, error: err instanceof Error ? err.message : String(err) });
      addToast({ variant: 'destructive', title: 'Unexpected error' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Select
      value={value}
      onChange={handleChange}
      disabled={saving}
      className="h-7 text-xs w-48"
      aria-label="Referrer"
    >
      <option value="">— No referrer —</option>
      {internal.length > 0 && (
        <optgroup label="Internal (MGMT REF)">
          {internal.map((p) => (
            <option key={p.id} value={p.id}>
              [MGMT REF] {p.partner_name}
            </option>
          ))}
        </optgroup>
      )}
      {external.length > 0 && (
        <optgroup label="External partners">
          {external.map((p) => (
            <option key={p.id} value={p.id}>
              {p.partner_name}
            </option>
          ))}
        </optgroup>
      )}
    </Select>
  );
}
