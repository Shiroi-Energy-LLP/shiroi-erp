'use client';

/**
 * Small "End role" button shown next to each active contact_company_roles row
 * on the contact detail page. Wraps `endContactCompanyRole` which sets
 * `ended_at = today` (action does NOT delete the row).
 */

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@repo/ui';
import { LogOut } from 'lucide-react';
import { endContactCompanyRole } from '@/lib/contacts-actions';

interface EndRoleButtonProps {
  roleId: string;
  roleTitle: string;
  companyName: string;
}

export function EndRoleButton({ roleId, roleTitle, companyName }: EndRoleButtonProps) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  async function handle() {
    if (busy) return;
    if (!confirm(`End "${roleTitle}" at ${companyName}? This sets the end date to today.`)) return;
    setBusy(true);
    const r = await endContactCompanyRole(roleId);
    setBusy(false);
    if (!r.success) {
      alert(`Failed to end role: ${r.error}`);
      return;
    }
    router.refresh();
  }

  return (
    <Button
      type="button"
      onClick={handle}
      disabled={busy}
      variant="outline"
      size="sm"
      className="h-6 px-2 text-[10px] gap-1"
    >
      <LogOut className="h-3 w-3" />
      {busy ? 'Ending…' : 'End role'}
    </Button>
  );
}
