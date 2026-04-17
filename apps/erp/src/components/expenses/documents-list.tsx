import { createClient } from '@repo/supabase/server';

interface DocRow {
  id: string;
  file_path: string;
  file_name: string | null;
  file_size: number | null;
  mime_type: string | null;
  uploaded_at: string;
}

async function signUrls(paths: string[]): Promise<Record<string, string>> {
  if (paths.length === 0) return {};
  const supabase = await createClient();
  const { data } = await supabase.storage.from('project-files').createSignedUrls(paths, 3600);
  const map: Record<string, string> = {};
  for (const s of data ?? []) if (s.path && s.signedUrl) map[s.path] = s.signedUrl;
  return map;
}

export async function DocumentsList({ docs }: { docs: DocRow[] }) {
  const urls = await signUrls(docs.map((d) => d.file_path));
  if (docs.length === 0) {
    return <div className="text-sm text-gray-500 py-2">No documents attached</div>;
  }
  return (
    <ul className="space-y-2">
      {docs.map((d) => {
        const url = urls[d.file_path];
        const isImage = (d.mime_type ?? '').startsWith('image/');
        return (
          <li key={d.id} className="flex items-center gap-3 p-2 border rounded">
            {isImage && url
              ? <img src={url} alt={d.file_name ?? ''} className="w-16 h-16 object-cover rounded" />
              : <div className="w-16 h-16 flex items-center justify-center bg-gray-100 rounded text-gray-400 text-xs">PDF</div>}
            <div className="flex-1 min-w-0">
              <div className="text-sm truncate">{d.file_name ?? d.file_path.split('/').pop()}</div>
              <div className="text-xs text-gray-500">{d.file_size ? `${Math.round(d.file_size / 1024)} KB` : ''} · {d.mime_type ?? ''}</div>
            </div>
            {url && <a href={url} target="_blank" rel="noreferrer" className="text-sm text-blue-600 hover:underline">Open</a>}
          </li>
        );
      })}
    </ul>
  );
}
