'use client';

import * as React from 'react';
import { createClient } from '@repo/supabase/client';
import { Camera } from 'lucide-react';

/**
 * Read-only display of QC section photos (signed URLs loaded on mount).
 * Used in the ReadOnlyChecklist for submitted/approved inspections.
 */
export function QcSectionPhotos({ photoPaths }: { photoPaths: string[] }) {
  const [urls, setUrls] = React.useState<string[]>([]);

  React.useEffect(() => {
    if (photoPaths.length === 0) return;
    const supabase = createClient();
    Promise.all(
      photoPaths.map((p) =>
        supabase.storage
          .from('site-photos')
          .createSignedUrl(p, 600)
          .then(({ data }) => data?.signedUrl ?? null),
      ),
    ).then((results) => setUrls(results.filter(Boolean) as string[]));
  }, [photoPaths]);

  if (urls.length === 0) return null;

  return (
    <div className="flex gap-2 flex-wrap">
      {urls.map((url, i) => (
        <a key={i} href={url} target="_blank" rel="noopener noreferrer">
          <img
            src={url}
            alt={`QC photo ${i + 1}`}
            className="h-16 w-24 object-cover rounded border border-n-200 hover:border-p-400 transition-colors cursor-pointer"
          />
        </a>
      ))}
    </div>
  );
}
