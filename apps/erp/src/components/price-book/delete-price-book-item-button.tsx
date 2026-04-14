'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@repo/ui';
import { Trash2 } from 'lucide-react';
import { deletePriceBookItem } from '@/lib/price-book-actions';

interface DeletePriceBookItemButtonProps {
  id: string;
  itemDescription: string;
}

export function DeletePriceBookItemButton({ id, itemDescription }: DeletePriceBookItemButtonProps) {
  const router = useRouter();
  const [deleting, setDeleting] = React.useState(false);

  async function handleDelete() {
    if (!confirm(`Delete "${itemDescription}" from the Price Book?`)) return;
    setDeleting(true);
    const result = await deletePriceBookItem(id);
    setDeleting(false);
    if (result.success) {
      router.refresh();
    }
  }

  return (
    <Button
      size="sm"
      variant="ghost"
      className="h-7 w-7 p-0 text-n-300 hover:text-red-500"
      onClick={handleDelete}
      disabled={deleting}
    >
      <Trash2 className="h-3.5 w-3.5" />
    </Button>
  );
}
