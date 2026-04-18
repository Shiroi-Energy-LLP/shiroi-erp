'use client';

import { useState, useTransition } from 'react';
import { Badge, Button, Input, Label, useToast } from '@repo/ui';
import { changePassword } from '@/lib/settings-actions';
import { validateNewPassword } from '@/lib/settings-helpers';
import { getRoleLabel, type AppRole } from '@/lib/roles';

interface AccountTabProps {
  fullName: string;
  email: string;
  role: AppRole;
}

export function AccountTab({ fullName, email, role }: AccountTabProps) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pending, startTransition] = useTransition();
  const { addToast } = useToast();

  const clientValidation = validateNewPassword(newPassword, confirmPassword);
  const canSubmit =
    currentPassword.length > 0 &&
    newPassword.length > 0 &&
    confirmPassword.length > 0 &&
    clientValidation.ok &&
    !pending;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    startTransition(async () => {
      const result = await changePassword(currentPassword, newPassword, confirmPassword);
      if (!result.success) {
        addToast({
          variant: 'destructive',
          title: 'Could not change password',
          description: result.error,
        });
        return;
      }
      addToast({
        variant: 'success',
        title: 'Password changed',
        description: 'Your password has been updated.',
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    });
  }

  return (
    <div className="space-y-6">
      {/* Profile display */}
      <section className="space-y-2 rounded-md border border-n-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-n-900">Profile</h2>
        <dl className="grid grid-cols-[140px_1fr] gap-y-1 text-sm">
          <dt className="text-n-500">Name</dt>
          <dd className="text-n-900">{fullName}</dd>
          <dt className="text-n-500">Email</dt>
          <dd className="text-n-900">{email}</dd>
          <dt className="text-n-500">Role</dt>
          <dd>
            <Badge variant="success">{getRoleLabel(role)}</Badge>
          </dd>
        </dl>
      </section>

      {/* Change password */}
      <section className="space-y-4 rounded-md border border-n-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-n-900">Change password</h2>
        <form onSubmit={handleSubmit} className="space-y-3 max-w-md">
          <div className="space-y-1">
            <Label htmlFor="current-password">Current password</Label>
            <Input
              id="current-password"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              disabled={pending}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="new-password">New password</Label>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              disabled={pending}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="confirm-password">Confirm new password</Label>
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={pending}
              required
            />
            {!clientValidation.ok && confirmPassword.length > 0 && (
              <p className="text-xs text-status-error-text">{clientValidation.error}</p>
            )}
          </div>
          <Button type="submit" disabled={!canSubmit}>
            {pending ? 'Updating…' : 'Change password'}
          </Button>
        </form>
      </section>
    </div>
  );
}
