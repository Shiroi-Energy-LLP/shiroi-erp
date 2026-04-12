'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@repo/ui';
import { Trash2 } from 'lucide-react';
import { deleteServiceTicket } from '@/lib/service-ticket-actions';

interface DeleteTicketButtonProps {
  ticketId: string;
  ticketNumber: string;
}

export function DeleteTicketButton({ ticketId, ticketNumber }: DeleteTicketButtonProps) {
  const router = useRouter();
  const [deleting, setDeleting] = React.useState(false);

  async function handleDelete() {
    if (!confirm(`Close ticket ${ticketNumber}? This will mark it as closed.`)) return;
    setDeleting(true);
    const result = await deleteServiceTicket(ticketId);
    setDeleting(false);
    if (result.success) {
      router.refresh();
    }
  }

  return (
    <Button
      size="sm"
      variant="ghost"
      className="h-6 w-6 p-0 text-n-400 hover:text-red-600"
      onClick={handleDelete}
      disabled={deleting}
      title="Close ticket"
    >
      <Trash2 className="h-3 w-3" />
    </Button>
  );
}
