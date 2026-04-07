// scripts/whatsapp-import/media.ts
// Reads media files from the extracted ZIP buffer and uploads to Supabase Storage.

import sharp from 'sharp';
import AdmZip from 'adm-zip';
import { supabase } from './db.js';

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif']);
const MAX_RAW_SIZE_BYTES = 8 * 1024 * 1024; // skip originals > 8MB

export function isImage(filename: string): boolean {
  const dotIdx = filename.lastIndexOf('.');
  if (dotIdx === -1) return false;
  const ext = filename.slice(dotIdx).toLowerCase();
  return IMAGE_EXTS.has(ext);
}

async function resizeToJpeg(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
}

export async function uploadSitePhotoFromZip(
  zip: AdmZip,
  filename: string,
  projectId: string,
  reportDate: string  // YYYY-MM-DD
): Promise<string | null> {
  const op = '[uploadSitePhotoFromZip]';
  const entry = zip.getEntry(filename);
  if (!entry) {
    console.warn(`${op} Not found in ZIP: ${filename}`);
    return null;
  }

  const raw = entry.getData();
  if (raw.length > MAX_RAW_SIZE_BYTES && !isImage(filename)) return null;

  let buf = raw;
  try {
    buf = await resizeToJpeg(raw);
  } catch {
    if (raw.length > MAX_RAW_SIZE_BYTES) return null;
  }

  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storagePath = `projects/${projectId}/whatsapp/${reportDate}/${Date.now()}_${safeName}`;

  const { error } = await supabase.storage
    .from('site-photos')
    .upload(storagePath, buf, { contentType: 'image/jpeg', upsert: false });

  if (error) {
    if (error.message?.includes('already exists') || error.message?.includes('Duplicate')) return storagePath;
    console.error(`${op} Upload failed (${filename}):`, error.message);
    return null;
  }
  return storagePath;
}

export async function uploadPaymentPhotoFromZip(
  zip: AdmZip,
  filename: string,
  projectId: string,
  date: string  // YYYY-MM-DD
): Promise<string | null> {
  const op = '[uploadPaymentPhotoFromZip]';
  const entry = zip.getEntry(filename);
  if (!entry) return null;

  const raw = entry.getData();
  let buf = raw;
  try {
    buf = await resizeToJpeg(raw);
  } catch {
    if (raw.length > MAX_RAW_SIZE_BYTES) return null;
  }

  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storagePath = `${projectId}/payments/${date}_${safeName}`;

  const { error } = await supabase.storage
    .from('project-files')
    .upload(storagePath, buf, { contentType: 'image/jpeg', upsert: false });

  if (error) {
    if (error.message?.includes('already exists') || error.message?.includes('Duplicate')) return storagePath;
    console.error(`${op} Upload failed (${filename}):`, error.message);
    return null;
  }
  return storagePath;
}
