'use client';

import { useState } from 'react';
import { Button } from '@repo/ui';
import { QuickQuoteModal } from './quick-quote-modal';

interface QuickQuoteButtonProps {
  leadId: string;
  systemType: string | null;
  sizeKwp: number | null;
  segment: string | null;
}

export function QuickQuoteButton({ leadId, systemType, sizeKwp, segment }: QuickQuoteButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Quick Quote
      </Button>
      {open && (
        <QuickQuoteModal
          leadId={leadId}
          defaultSystemType={systemType}
          defaultSizeKwp={sizeKwp}
          defaultSegment={segment}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
