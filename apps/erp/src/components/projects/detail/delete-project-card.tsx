'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card, CardHeader, CardTitle, CardContent, Input } from '@repo/ui';
import { Trash2 } from 'lucide-react';
import { deleteProject } from '@/lib/project-detail-actions';

export function DeleteProjectCard({ projectId, projectNumber }: { projectId: string; projectNumber: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [confirm, setConfirm] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleDelete() {
    setBusy(true);
    setError(null);
    const result = await deleteProject({ projectId, confirmNumber: confirm });
    setBusy(false);
    if (result.success) router.push('/projects');
    else setError(result.error ?? 'Delete failed');
  }

  return (
    <Card className="border-red-200">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-red-700">Danger zone</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {!open ? (
          <Button size="sm" variant="outline" className="text-red-600 border-red-300 hover:bg-red-50"
            onClick={() => setOpen(true)}>
            <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Delete Project
          </Button>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-n-600">
              This hides the project everywhere (soft delete; restorable only via the database).
              Type <span className="font-mono font-semibold">{projectNumber}</span> to confirm.
            </p>
            <Input value={confirm} onChange={(e) => setConfirm(e.target.value)}
              placeholder={projectNumber} className="h-8 text-xs font-mono" />
            {error && <p className="text-xs text-red-600">{error}</p>}
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => { setOpen(false); setConfirm(''); setError(null); }} disabled={busy}>
                Cancel
              </Button>
              <Button size="sm" className="bg-red-600 hover:bg-red-700 text-white"
                onClick={handleDelete} disabled={busy || confirm.trim() !== projectNumber}>
                {busy ? 'Deleting…' : 'Delete permanently from lists'}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
