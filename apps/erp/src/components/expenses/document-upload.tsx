'use client';

import { useState } from 'react';
import { createClient } from '@repo/supabase/client';

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = ['application/pdf', 'image/jpeg', 'image/png'];

export interface UploadedFile {
  path: string;
  name: string;
  size: number;
  mime: string;
}

export function DocumentUpload({
  expenseId,
  projectId,
  onUploaded,
}: {
  expenseId?: string;
  projectId?: string | null;
  onUploaded: (f: UploadedFile) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    setUploading(true);
    const supabase = createClient();
    for (const file of Array.from(files)) {
      if (!ALLOWED.includes(file.type)) { setError(`Rejected ${file.name}: type ${file.type}`); continue; }
      if (file.size > MAX_BYTES) { setError(`Rejected ${file.name}: over 5MB`); continue; }
      const scopePath = projectId
        ? `projects/${projectId}/expenses/${expenseId ?? 'pending'}/${file.name}`
        : `expenses/general/${expenseId ?? 'pending'}/${file.name}`;
      const { error: upErr } = await supabase.storage.from('project-files').upload(scopePath, file, { upsert: false });
      if (upErr) { setError(`Upload failed for ${file.name}: ${upErr.message}`); continue; }
      onUploaded({ path: scopePath, name: file.name, size: file.size, mime: file.type });
    }
    setUploading(false);
  }

  return (
    <div>
      <input
        type="file"
        multiple
        accept=".pdf,.jpg,.jpeg,.png"
        onChange={(e) => handleFiles(e.target.files)}
        disabled={uploading}
        className="text-sm"
      />
      {uploading && <div className="text-xs text-gray-500 mt-1">Uploading…</div>}
      {error && <div className="text-xs text-red-600 mt-1">{error}</div>}
    </div>
  );
}
