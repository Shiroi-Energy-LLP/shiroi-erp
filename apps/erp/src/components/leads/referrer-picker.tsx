'use client';

import * as React from 'react';
import { Select, Label } from '@repo/ui';
import type { PartnerPickerOption } from '@/lib/partners-queries';

interface ReferrerPickerProps {
  /** All active channel partners, grouped: internal first, then external. */
  partners: PartnerPickerOption[];
  /** Currently selected channel_partner_id, or null for "no referrer". */
  value: string | null;
  onChange: (id: string | null) => void;
  /** Optional label override; defaults to "Referrer". */
  label?: string;
  id?: string;
}

/**
 * Combobox for picking a channel partner as lead referrer.
 * Internal (MGMT REF) partners are listed first with a [MGMT REF] prefix;
 * external partners follow alphabetically.
 *
 * Receives partner list as props — fetched once server-side to avoid
 * a client-side round-trip on every render.
 */
export function ReferrerPicker({
  partners,
  value,
  onChange,
  label = 'Referrer',
  id = 'referrer_picker',
}: ReferrerPickerProps) {
  const internalPartners = partners.filter((p) => p.is_internal);
  const externalPartners = partners.filter((p) => !p.is_internal);

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Select
        id={id}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">No referrer</option>
        {internalPartners.length > 0 && (
          <optgroup label="Internal (MGMT REF)">
            {internalPartners.map((p) => (
              <option key={p.id} value={p.id}>
                [MGMT REF] {p.partner_name}
              </option>
            ))}
          </optgroup>
        )}
        {externalPartners.length > 0 && (
          <optgroup label="Customer">
            {externalPartners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.partner_name}
              </option>
            ))}
          </optgroup>
        )}
      </Select>
    </div>
  );
}
