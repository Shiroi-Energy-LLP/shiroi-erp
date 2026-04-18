'use client';

import { useState, useTransition } from 'react';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useToast,
} from '@repo/ui';
import type { Database } from '@repo/types/database';
import { updateUserRole, setUserActive } from '@/lib/settings-actions';
import { ROLE_LABELS, type AppRole } from '@/lib/roles';

type User = Pick<
  Database['public']['Tables']['profiles']['Row'],
  'id' | 'full_name' | 'email' | 'role' | 'is_active'
>;

interface UsersTabProps {
  users: User[];
  currentUserId: string;
}

export function UsersTab({ users, currentUserId }: UsersTabProps) {
  const [pending, startTransition] = useTransition();
  const { addToast } = useToast();
  const [confirmTarget, setConfirmTarget] = useState<User | null>(null);

  function onRoleChange(user: User, newRole: AppRole) {
    if (newRole === user.role) return;
    startTransition(async () => {
      const result = await updateUserRole(user.id, newRole);
      if (!result.success) {
        addToast({
          variant: 'destructive',
          title: 'Could not update role',
          description: result.error,
        });
        return;
      }
      addToast({
        variant: 'success',
        title: 'Role updated',
        description: `${user.full_name} is now ${ROLE_LABELS[newRole]}`,
      });
    });
  }

  function onActivate(user: User) {
    startTransition(async () => {
      const result = await setUserActive(user.id, true);
      if (!result.success) {
        addToast({
          variant: 'destructive',
          title: 'Could not activate user',
          description: result.error,
        });
        return;
      }
      addToast({
        variant: 'success',
        title: 'User activated',
        description: `${user.full_name} can sign in again.`,
      });
    });
  }

  function onConfirmDeactivate() {
    if (!confirmTarget) return;
    const target = confirmTarget;
    setConfirmTarget(null);
    startTransition(async () => {
      const result = await setUserActive(target.id, false);
      if (!result.success) {
        addToast({
          variant: 'destructive',
          title: 'Could not deactivate user',
          description: result.error,
        });
        return;
      }
      addToast({
        variant: 'success',
        title: 'User deactivated',
        description: `${target.full_name} will lose access on their next page load.`,
      });
    });
  }

  return (
    <section className="space-y-2 rounded-md border border-n-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-n-900">Users</h2>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((u) => {
            const isSelf = u.id === currentUserId;
            return (
              <TableRow key={u.id}>
                <TableCell className="font-medium">{u.full_name}</TableCell>
                <TableCell className="text-sm text-n-600">{u.email}</TableCell>
                <TableCell>
                  <Select
                    value={u.role}
                    onChange={(e) => onRoleChange(u, e.target.value as AppRole)}
                    disabled={isSelf || pending}
                    title={isSelf ? 'You cannot change your own role' : undefined}
                  >
                    {(Object.keys(ROLE_LABELS) as AppRole[]).map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </option>
                    ))}
                  </Select>
                </TableCell>
                <TableCell>
                  {u.is_active ? (
                    <Badge variant="success">Active</Badge>
                  ) : (
                    <Badge variant="destructive">Inactive</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {u.is_active ? (
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={isSelf || pending}
                      onClick={() => setConfirmTarget(u)}
                      title={isSelf ? 'You cannot deactivate yourself' : undefined}
                    >
                      Deactivate
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      disabled={pending}
                      onClick={() => onActivate(u)}
                    >
                      Activate
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <Dialog open={confirmTarget !== null} onOpenChange={(open) => !open && setConfirmTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Deactivate user?</DialogTitle>
            <DialogDescription>
              {confirmTarget
                ? `${confirmTarget.full_name} will lose access to the ERP on their next page load. You can reactivate them later.`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirmTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={onConfirmDeactivate}>
              Deactivate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
