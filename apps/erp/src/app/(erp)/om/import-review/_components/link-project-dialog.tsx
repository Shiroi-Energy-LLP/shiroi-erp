'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, Button } from '@repo/ui';
import { Link2, Loader2 } from 'lucide-react';
import { linkPendingImportToProject } from '@/lib/import-review-actions';
import { ProjectCombobox } from '@/components/forms/project-combobox';

interface ProjectOpt {
  id: string;
  customer_name: string;
  project_number: string | null;
  project_name?: string | null;
}

interface Props {
  importId: string;
  importName: string;
  projects: ProjectOpt[];
}

export function LinkProjectDialog({ importId, importName, projects }: Props) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [projectId, setProjectId] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  function handleOpenChange(val: boolean) {
    setOpen(val);
    if (!val) {
      setProjectId('');
      setError(null);
      setSaving(false);
    }
  }

  async function handleLink() {
    if (!projectId) return;
    setSaving(true);
    setError(null);
    const result = await linkPendingImportToProject(importId, projectId);
    setSaving(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    handleOpenChange(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="h-7 text-xs">
          <Link2 className="h-3 w-3 mr-1" />
          Link
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Link to existing project</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-n-500">
            Attaches <span className="font-medium text-n-800">{importName}</span>&apos;s monitoring credential to an
            existing project — <span className="font-medium">no new project is created</span>. An inverter row is added
            only if the project has none and the import has a serial number.
          </p>
          <ProjectCombobox
            projects={projects}
            value={projectId}
            onChange={setProjectId}
            placeholder="Search by customer name or project number…"
            className="w-full"
          />
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="button" onClick={handleLink} disabled={saving || !projectId}>
              {saving && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
              Link credential
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
