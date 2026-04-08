'use client';

import * as React from 'react';
import { createClient } from '@repo/supabase/client';
import { Dialog, DialogContent, DialogTitle } from '@repo/ui';
import { ChevronLeft, ChevronRight, Download, X } from 'lucide-react';

export interface ViewableImage {
  /** Unique key for the image */
  id: string;
  /** Display name */
  name: string;
  /** Supabase storage bucket name */
  bucket: string;
  /** Full path within the bucket (without bucket prefix) */
  path: string;
}

interface ImageViewerProps {
  images: ViewableImage[];
  initialIndex: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ImageViewer({ images, initialIndex, open, onOpenChange }: ImageViewerProps) {
  const [index, setIndex] = React.useState(initialIndex);
  const [signedUrl, setSignedUrl] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const current = images[index];

  // Reset index when initialIndex changes (new image clicked)
  React.useEffect(() => {
    setIndex(initialIndex);
  }, [initialIndex]);

  // Load signed URL when current image changes
  React.useEffect(() => {
    if (!open || !current) return;
    setLoading(true);
    setSignedUrl(null);

    const supabase = createClient();
    supabase.storage
      .from(current.bucket)
      .createSignedUrl(current.path, 300)
      .then(({ data, error }) => {
        if (error) {
          console.error('[ImageViewer] Signed URL failed:', error.message);
        } else {
          setSignedUrl(data.signedUrl);
        }
        setLoading(false);
      });
  }, [open, index, current?.bucket, current?.path]);

  function prev() {
    setIndex((i) => (i > 0 ? i - 1 : images.length - 1));
  }

  function next() {
    setIndex((i) => (i < images.length - 1 ? i + 1 : 0));
  }

  // Keyboard navigation
  React.useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'ArrowLeft') prev();
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'Escape') onOpenChange(false);
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, images.length]);

  if (!current) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[90vw] max-h-[90vh] w-auto p-0 bg-black/95 border-none overflow-hidden"
        onPointerDownOutside={() => onOpenChange(false)}
      >
        <DialogTitle className="sr-only">Image viewer</DialogTitle>

        {/* Close button */}
        <button
          onClick={() => onOpenChange(false)}
          className="absolute top-3 right-3 z-10 rounded-full bg-black/50 p-2 text-white hover:bg-black/70 transition-colors"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Image area */}
        <div className="flex items-center justify-center min-h-[60vh] max-h-[80vh] relative">
          {/* Prev arrow */}
          {images.length > 1 && (
            <button
              onClick={prev}
              className="absolute left-2 z-10 rounded-full bg-black/50 p-2 text-white hover:bg-black/70 transition-colors"
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
          )}

          {/* Image */}
          {loading ? (
            <div className="flex items-center justify-center w-full h-[60vh]">
              <div className="h-8 w-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            </div>
          ) : signedUrl ? (
            <img
              src={signedUrl}
              alt={current.name}
              className="max-w-full max-h-[80vh] object-contain select-none"
              draggable={false}
            />
          ) : (
            <p className="text-white/60 text-sm">Failed to load image</p>
          )}

          {/* Next arrow */}
          {images.length > 1 && (
            <button
              onClick={next}
              className="absolute right-2 z-10 rounded-full bg-black/50 p-2 text-white hover:bg-black/70 transition-colors"
            >
              <ChevronRight className="h-6 w-6" />
            </button>
          )}
        </div>

        {/* Bottom bar: filename + counter + download */}
        <div className="flex items-center justify-between px-4 py-3 bg-black/80 text-white">
          <span className="text-sm truncate max-w-[60%]" title={current.name}>
            {current.name}
          </span>
          <div className="flex items-center gap-3">
            <span className="text-xs text-white/60">
              {index + 1} / {images.length}
            </span>
            {signedUrl && (
              <a
                href={signedUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="p-1.5 rounded-full hover:bg-white/10 transition-colors"
                title="Download"
              >
                <Download className="h-4 w-4" />
              </a>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
