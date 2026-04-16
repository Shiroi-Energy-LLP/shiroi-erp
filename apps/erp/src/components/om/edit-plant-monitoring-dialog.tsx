'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
  Button, Input, Label,
} from '@repo/ui';
import { Pencil } from 'lucide-react';
import { updatePlantMonitoringCredential } from '@/lib/plant-monitoring-actions';

interface EditPlantMonitoringDialogProps {
  credential: {
    id: string;
    portal_url: string;
    username: string;
    password: string;
    notes: string | null;
  };
}

export function EditPlantMonitoringDialog({ credential }: EditPlantMonitoringDialogProps) {
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
    const result = await updatePlantMonitoringCredential(credential.id, {
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
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" aria-label="Edit">
          <Pencil className="h-3.5 w-3.5 text-n-500" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Credential</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <Label htmlFor="portal_url_edit">Portal URL *</Label>
            <Input
              id="portal_url_edit"
              name="portal_url"
              type="url"
              required
              defaultValue={credential.portal_url}
              className="h-9 text-sm"
            />
          </div>

          <div>
            <Label htmlFor="username_edit">Username *</Label>
            <Input
              id="username_edit"
              name="username"
              required
              defaultValue={credential.username}
              className="h-9 text-sm"
            />
          </div>

          <div>
            <Label htmlFor="password_edit">Password *</Label>
            <div className="flex gap-1">
              <Input
                id="password_edit"
                name="password"
                type={showPassword ? 'text' : 'password'}
                required
                defaultValue={credential.password}
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
            <Label htmlFor="notes_edit">Notes (optional)</Label>
            <textarea
              id="notes_edit"
              name="notes"
              rows={2}
              defaultValue={credential.notes ?? ''}
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
