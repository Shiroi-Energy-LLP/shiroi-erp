'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { deactivateEmployee } from '@/lib/employee-actions';
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@repo/ui';
import { UserX } from 'lucide-react';

interface DeactivateEmployeeButtonProps {
  employeeId: string;
  employeeName: string;
  isActive: boolean;
}

export function DeactivateEmployeeButton({ employeeId, employeeName, isActive }: DeactivateEmployeeButtonProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);

  if (!isActive) return null; // Already inactive — no button needed

  async function handleDeactivate() {
    setLoading(true);
    const result = await deactivateEmployee(employeeId);
    setLoading(false);
    setOpen(false);
    if (result.success) {
      router.refresh();
    }
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        className="h-7 text-xs text-status-error-text hover:text-status-error-text hover:bg-status-error-bg"
      >
        <UserX className="h-3.5 w-3.5" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Deactivate {employeeName}?</DialogTitle>
            <DialogDescription>
              This will deactivate the employee account and prevent them from logging in. Their data will be preserved. This can be reversed by reactivating them later.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={loading}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeactivate} disabled={loading}>
              {loading ? 'Deactivating...' : 'Deactivate'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
