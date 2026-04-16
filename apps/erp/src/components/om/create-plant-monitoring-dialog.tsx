'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
  Button, Input, Label,
} from '@repo/ui';
import { Plus } from 'lucide-react';
import { createPlantMonitoringCredential } from '@/lib/plant-monitoring-actions';

interface ProjectOpt {
  id: string;
  customer_name: string;
}

interface CreatePlantMonitoringDialogProps {
  projects: ProjectOpt[];
}

export function CreatePlantMonitoringDialog({ projects }: CreatePlantMonitoringDialogProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [showPassword, setShowPassword] = React.useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const form = new FormData(e.currentTarget);
    const result = await createPlantMonitoringCredential({
      project_id: String(form.get('project_id') ?? ''),
      portal_url: String(form.get('portal_url') ?? ''),
      username: String(form.get('username') ?? ''),
      password: String(form.get('password') ?? ''),
      notes: String(form.get('notes') ?? '') || null,
    });

    setSaving(false);

    if (!result.success) {
      setError(result.error);
      return;
    }

    setOpen(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="h-8 text-xs">
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add Credential
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Monitoring Credential</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <Label htmlFor="project_id">Project *</Label>
            <select
              id="project_id"
              name="project_id"
              required
              className="w-full h-9 px-2 text-sm border border-n-300 rounded"
            >
              <option value="">— Select project —</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.customer_name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <Label htmlFor="portal_url">Portal URL *</Label>
            <Input
              id="portal_url"
              name="portal_url"
              type="url"
              required
              placeholder="https://isolarcloud.com/..."
              className="h-9 text-sm"
            />
          </div>

          <div>
            <Label htmlFor="username">Username *</Label>
            <Input id="username" name="username" required className="h-9 text-sm" />
          </div>

          <div>
            <Label htmlFor="password">Password *</Label>
            <div className="flex gap-1">
              <Input
                id="password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                required
                className="h-9 text-sm"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 text-xs"
                onClick={() => setShowPassword((s) => !s)}
              >
                {showPassword ? 'Hide' : 'Show'}
              </Button>
            </div>
          </div>

          <div>
            <Label htmlFor="notes">Notes (optional)</Label>
            <textarea
              id="notes"
              name="notes"
              rows={2}
              className="w-full rounded-md border border-n-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-shiroi-green"
            />
          </div>

          {error && (
            <p className="text-xs text-red-600">{error}</p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
