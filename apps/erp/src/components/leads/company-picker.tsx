'use client';

import * as React from 'react';
import { useState } from 'react';
import { Select, Label, Input, Button } from '@repo/ui';
import { createCompany } from '@/lib/contacts-actions';

interface CompanyPickerProps {
  companies: { id: string; name: string }[];
  value: string | null;
  onChange: (id: string | null) => void;
  /** Optional label override; defaults to "Company / Account". */
  label?: string;
  id?: string;
}

/**
 * Picker for linking a lead to an existing company or creating one inline.
 *
 * Inline-created companies default to segment 'commercial' — the founder
 * refines the segment and other details later on the /companies detail page.
 *
 * Receives the initial companies list as a prop (fetched server-side once)
 * and maintains a local copy so newly-created companies can be appended
 * and auto-selected without a full page reload.
 */
export function CompanyPicker({
  companies: initialCompanies,
  value,
  onChange,
  label = 'Company / Account',
  id = 'company_picker',
}: CompanyPickerProps) {
  // Local copy so we can append newly-created companies without a page reload.
  const [companies, setCompanies] = useState(initialCompanies);

  const [showInline, setShowInline] = useState(false);
  const [newName, setNewName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);

  async function handleCreate() {
    const trimmed = newName.trim();
    if (!trimmed) {
      setInlineError('Company name cannot be empty.');
      return;
    }

    setIsCreating(true);
    setInlineError(null);

    const result = await createCompany({ name: trimmed, segment: 'commercial' });

    if (!result.success) {
      setInlineError(result.error);
      setIsCreating(false);
      return;
    }

    const created = { id: result.data.companyId, name: trimmed };
    // Insert in alphabetical order.
    setCompanies((prev) => {
      const next = [...prev, created];
      next.sort((a, b) => a.name.localeCompare(b.name));
      return next;
    });
    onChange(result.data.companyId);
    setNewName('');
    setShowInline(false);
    setIsCreating(false);
  }

  function handleCancel() {
    setShowInline(false);
    setNewName('');
    setInlineError(null);
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Select
        id={id}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">No company</option>
        {companies.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </Select>

      {!showInline && (
        <button
          type="button"
          className="text-xs text-primary underline-offset-2 hover:underline"
          onClick={() => {
            setShowInline(true);
            setInlineError(null);
          }}
        >
          + Add new company
        </button>
      )}

      {showInline && (
        <div className="flex items-center gap-2 pt-1">
          <Input
            value={newName}
            onChange={(e) => {
              setNewName(e.target.value);
              if (inlineError) setInlineError(null);
            }}
            placeholder="Company name"
            className="max-w-xs"
            disabled={isCreating}
          />
          <Button
            type="button"
            size="sm"
            onClick={handleCreate}
            disabled={isCreating}
          >
            {isCreating ? 'Creating…' : 'Create'}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={handleCancel}
            disabled={isCreating}
          >
            Cancel
          </Button>
        </div>
      )}

      {inlineError && (
        <p className="text-xs text-status-error-text">{inlineError}</p>
      )}
    </div>
  );
}
