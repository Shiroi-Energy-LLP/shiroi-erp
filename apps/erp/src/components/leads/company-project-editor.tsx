'use client';

import * as React from 'react';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input, Label, useToast } from '@repo/ui';
import { CompanyPicker } from '@/components/leads/company-picker';
import { updateLeadCompanyProject } from '@/lib/leads-actions';
import { updateProjectCompanyProject } from '@/lib/projects-actions';

interface CompanyProjectEditorProps {
  entityType: 'lead' | 'project';
  entityId: string;
  companyId: string | null;
  projectName: string | null;
  companies: { id: string; name: string }[];
}

/**
 * Inline editor card for linking a Company and setting the Project Name
 * on either a lead or a project detail page.
 *
 * Calls the appropriate server action based on entityType, shows a
 * success/error toast, and refreshes the router on success.
 */
export function CompanyProjectEditor({
  entityType,
  entityId,
  companyId: initialCompanyId,
  projectName: initialProjectName,
  companies,
}: CompanyProjectEditorProps) {
  const { addToast } = useToast();
  const router = useRouter();

  const [companyId, setCompanyId] = useState<string | null>(initialCompanyId);
  const [projectName, setProjectName] = useState<string>(initialProjectName ?? '');
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    const op = '[CompanyProjectEditor.handleSave]';
    setSaving(true);
    try {
      const input = {
        companyId,
        projectName: projectName.trim() || null,
      };

      const result =
        entityType === 'lead'
          ? await updateLeadCompanyProject(entityId, input)
          : await updateProjectCompanyProject(entityId, input);

      if (!result.success) {
        console.error(`${op} failed`, { error: result.error, entityType, entityId });
        addToast({
          variant: 'destructive',
          title: 'Save failed',
          description: result.error,
        });
      } else {
        addToast({ variant: 'success', title: 'Company / project name saved' });
        router.refresh();
      }
    } catch (e) {
      console.error(`${op} threw`, {
        error: e instanceof Error ? e.message : String(e),
        entityType,
        entityId,
      });
      addToast({ variant: 'destructive', title: 'Unexpected error' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <CompanyPicker
        companies={companies}
        value={companyId}
        onChange={setCompanyId}
      />

      <div className="space-y-1">
        <Label htmlFor={`project-name-${entityId}`}>Project Name</Label>
        <Input
          id={`project-name-${entityId}`}
          value={projectName}
          onChange={(e) => setProjectName(e.target.value)}
          placeholder="e.g. Rooftop 10 kWp — Sector 14"
          maxLength={200}
          disabled={saving}
        />
      </div>

      <Button size="sm" onClick={handleSave} disabled={saving}>
        {saving ? 'Saving…' : 'Save'}
      </Button>
    </div>
  );
}
