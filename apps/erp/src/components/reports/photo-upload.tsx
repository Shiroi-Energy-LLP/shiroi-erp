'use client';

import { useState, useRef } from 'react';
import { createClient } from '@repo/supabase/client';
import { Button, Input, Label } from '@repo/ui';

interface UploadedPhoto {
  storagePath: string;
  fileName: string;
  caption: string;
  fileSizeBytes: number;
  previewUrl: string;
}

interface PhotoUploadProps {
  projectId: string;
  reportDate: string;
  onPhotosChange: (
    photos: Array<{
      storagePath: string;
      fileName: string;
      caption: string;
      fileSizeBytes: number;
    }>,
  ) => void;
}

const MAX_FILE_SIZE_MB = 10;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];

export function PhotoUpload({ projectId, reportDate, onPhotosChange }: PhotoUploadProps) {
  const [photos, setPhotos] = useState<UploadedPhoto[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const op = '[PhotoUpload.handleFileSelect]';
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setError(null);
    setUploading(true);

    try {
      const supabase = createClient();
      const newPhotos: UploadedPhoto[] = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (!file) continue;

        // Validate type
        if (!ALLOWED_TYPES.includes(file.type)) {
          console.warn(`${op} Skipping unsupported file type: ${file.type}`);
          continue;
        }

        // Validate size
        if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
          console.warn(`${op} File too large: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)`);
          setError(`File "${file.name}" exceeds ${MAX_FILE_SIZE_MB}MB limit.`);
          continue;
        }

        // Build storage path: projects/{projectId}/reports/{date}/{timestamp}_{filename}
        const timestamp = Date.now();
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const storagePath = `projects/${projectId}/reports/${reportDate}/${timestamp}_${safeName}`;

        const { error: uploadError } = await supabase.storage
          .from('site-photos')
          .upload(storagePath, file, {
            cacheControl: '3600',
            upsert: false,
          });

        if (uploadError) {
          console.error(`${op} Upload failed for ${file.name}:`, uploadError.message);
          setError(`Failed to upload "${file.name}": ${uploadError.message}`);
          continue;
        }

        // Create preview URL
        const previewUrl = URL.createObjectURL(file);

        newPhotos.push({
          storagePath,
          fileName: file.name,
          caption: '',
          fileSizeBytes: file.size,
          previewUrl,
        });
      }

      const allPhotos = [...photos, ...newPhotos];
      setPhotos(allPhotos);
      onPhotosChange(
        allPhotos.map(({ storagePath, fileName, caption, fileSizeBytes }) => ({
          storagePath,
          fileName,
          caption,
          fileSizeBytes,
        })),
      );
    } catch (err) {
      console.error(`${op} Unexpected error:`, {
        error: err instanceof Error ? err.message : String(err),
        timestamp: new Date().toISOString(),
      });
      setError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setUploading(false);
      // Reset file input so the same file can be re-selected
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }

  function handleCaptionChange(index: number, caption: string) {
    const updated = [...photos];
    const existing = updated[index];
    if (!existing) return;
    updated[index] = { ...existing, caption };
    setPhotos(updated);
    onPhotosChange(
      updated.map(({ storagePath, fileName, caption: c, fileSizeBytes }) => ({
        storagePath,
        fileName,
        caption: c,
        fileSizeBytes,
      })),
    );
  }

  function handleRemove(index: number) {
    const photo = photos[index];
    if (!photo) return;
    const updated = photos.filter((_, i) => i !== index);
    // Revoke the preview URL
    URL.revokeObjectURL(photo.previewUrl);
    setPhotos(updated);
    onPhotosChange(
      updated.map(({ storagePath, fileName, caption, fileSizeBytes }) => ({
        storagePath,
        fileName,
        caption,
        fileSizeBytes,
      })),
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-[#FEF2F2] border border-[#991B1B] text-[#991B1B] px-3 py-2 rounded-md text-sm">
          {error}
        </div>
      )}

      {/* Upload button */}
      <div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic"
          multiple
          onChange={handleFileSelect}
          className="hidden"
          id="photo-upload-input"
        />
        <Button
          type="button"
          variant="outline"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? 'Uploading...' : 'Add Photos'}
        </Button>
        <p className="text-xs text-muted-foreground mt-1">
          JPEG, PNG, WebP, HEIC. Max {MAX_FILE_SIZE_MB}MB per file.
        </p>
      </div>

      {/* Thumbnails */}
      {photos.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {photos.map((photo, index) => (
            <div key={photo.storagePath} className="space-y-2">
              <div className="relative aspect-square rounded-md overflow-hidden bg-[#F5F5F5] border">
                <img
                  src={photo.previewUrl}
                  alt={photo.fileName}
                  className="w-full h-full object-cover"
                />
                <button
                  type="button"
                  onClick={() => handleRemove(index)}
                  className="absolute top-1 right-1 w-6 h-6 bg-[#991B1B] text-white rounded-full flex items-center justify-center text-xs hover:bg-[#6A0A0A]"
                  aria-label={`Remove ${photo.fileName}`}
                >
                  X
                </button>
              </div>
              <Input
                placeholder="Caption (optional)"
                value={photo.caption}
                onChange={(e) => handleCaptionChange(index, e.target.value)}
                className="text-xs"
              />
              <p className="text-xs text-muted-foreground truncate" title={photo.fileName}>
                {photo.fileName}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
