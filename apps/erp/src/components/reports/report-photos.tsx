'use client';

import { useState } from 'react';
import { createClient } from '@repo/supabase/client';

interface SitePhoto {
  id: string;
  storage_path: string;
  file_name: string;
  caption: string | null;
  file_size_bytes: number | null;
  captured_at: string | null;
}

interface ReportPhotosProps {
  photos: SitePhoto[];
}

export function ReportPhotos({ photos }: ReportPhotosProps) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [loadingUrl, setLoadingUrl] = useState<string | null>(null);

  async function getSignedUrl(storagePath: string): Promise<string | null> {
    if (signedUrls[storagePath]) return signedUrls[storagePath] ?? null;

    setLoadingUrl(storagePath);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.storage
        .from('site-photos')
        .createSignedUrl(storagePath, 3600); // 1 hour

      if (error) {
        console.error('[ReportPhotos] Failed to get signed URL:', error.message);
        return null;
      }

      setSignedUrls((prev) => ({ ...prev, [storagePath]: data.signedUrl }));
      return data.signedUrl;
    } finally {
      setLoadingUrl(null);
    }
  }

  async function handlePhotoClick(index: number, storagePath: string) {
    if (expandedIndex === index) {
      setExpandedIndex(null);
      return;
    }
    await getSignedUrl(storagePath);
    setExpandedIndex(index);
  }

  return (
    <div className="space-y-4">
      {/* Thumbnail grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {photos.map((photo, index) => (
          <button
            key={photo.id}
            type="button"
            onClick={() => handlePhotoClick(index, photo.storage_path)}
            className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-all cursor-pointer hover:opacity-90 ${
              expandedIndex === index ? 'border-[#00B050] ring-2 ring-[#00B050]/20' : 'border-transparent'
            }`}
          >
            {signedUrls[photo.storage_path] ? (
              <img
                src={signedUrls[photo.storage_path]}
                alt={photo.caption || photo.file_name}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full bg-[#F5F5F5] flex items-center justify-center">
                {loadingUrl === photo.storage_path ? (
                  <div className="w-5 h-5 border-2 border-[#7C818E] border-t-transparent rounded-full animate-spin" />
                ) : (
                  <div className="text-center px-2">
                    <svg className="w-6 h-6 text-[#7C818E] mx-auto mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0 0 22.5 18.75V5.25A2.25 2.25 0 0 0 20.25 3H3.75A2.25 2.25 0 0 0 1.5 5.25v13.5A2.25 2.25 0 0 0 3.75 21Z" />
                    </svg>
                    <span className="text-[10px] text-[#7C818E] truncate block">{photo.file_name}</span>
                  </div>
                )}
              </div>
            )}
            {photo.caption && (
              <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-2 py-1">
                <span className="text-[10px] text-white truncate block">{photo.caption}</span>
              </div>
            )}
          </button>
        ))}
      </div>

      {/* Expanded view */}
      {expandedIndex !== null && photos[expandedIndex] && signedUrls[photos[expandedIndex]!.storage_path] && (
        <div className="relative rounded-lg overflow-hidden bg-[#F5F5F5] border">
          <img
            src={signedUrls[photos[expandedIndex]!.storage_path]}
            alt={photos[expandedIndex]!.caption || photos[expandedIndex]!.file_name}
            className="w-full max-h-[600px] object-contain"
          />
          <div className="absolute top-2 right-2">
            <button
              type="button"
              onClick={() => setExpandedIndex(null)}
              className="w-8 h-8 bg-black/50 text-white rounded-full flex items-center justify-center text-sm hover:bg-black/70"
            >
              ✕
            </button>
          </div>
          {photos[expandedIndex]!.caption && (
            <div className="p-3 bg-white border-t">
              <p className="text-sm text-[#3F424D]">{photos[expandedIndex]!.caption}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
