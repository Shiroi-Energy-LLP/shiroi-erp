'use server';

/**
 * E9 — Milestone Photos server actions
 *
 * uploadMilestonePhoto: validates GPS location against project site (100m gate),
 * uploads to Supabase Storage, and inserts a milestone_photos row.
 *
 * GPS verification uses the haversine_distance_m SQL function added in migration 127.
 * Photos uploaded from off-site (>100m) are still saved but flagged with
 * location_verified=false — we warn but don't block (field conditions vary).
 */

import { createClient } from '@repo/supabase/server';
import { ok, err, type ActionResult } from '@/lib/types/actions';

export type MilestoneName =
  | 'panel_install_start'
  | 'panel_install_complete'
  | 'inverter_install'
  | 'commissioning'
  | 'post_commissioning';

export interface UploadMilestonePhotoInput {
  projectId: string;
  milestone: MilestoneName;
  fileBase64: string;       // base64-encoded image data
  fileType: string;         // MIME type, e.g. 'image/jpeg'
  fileName: string;
  latitude: number | null;
  longitude: number | null;
  exifTimestamp: string | null; // ISO 8601 if available from EXIF
}

const MILESTONE_NAMES: MilestoneName[] = [
  'panel_install_start',
  'panel_install_complete',
  'inverter_install',
  'commissioning',
  'post_commissioning',
];

/** 100 meters — photos taken farther than this from site are flagged. */
const LOCATION_GATE_METERS = 100;

export async function uploadMilestonePhoto(
  input: UploadMilestonePhotoInput,
): Promise<ActionResult<{ id: string; location_verified: boolean; distance_m: number | null }>> {
  const op = '[uploadMilestonePhoto]';

  if (!input.projectId) return err('projectId is required');
  if (!MILESTONE_NAMES.includes(input.milestone)) {
    return err(`Invalid milestone. Must be one of: ${MILESTONE_NAMES.join(', ')}`);
  }
  if (!input.fileBase64 || !input.fileType || !input.fileName) {
    return err('fileBase64, fileType, and fileName are required');
  }

  const supabase = await createClient();

  // 1. Verify project exists and get site coordinates
  const { data: project, error: projErr } = await supabase
    .from('projects')
    .select('id, site_latitude, site_longitude, project_number')
    .eq('id', input.projectId)
    .maybeSingle();

  if (projErr || !project) {
    console.error(`${op} project fetch failed`, { projectId: input.projectId, error: projErr?.message, timestamp: new Date().toISOString() });
    return err(projErr?.message ?? 'Project not found');
  }

  // 2. GPS verification against site coordinates
  let locationVerified = false;
  let distanceMeters: number | null = null;

  if (
    input.latitude !== null &&
    input.longitude !== null &&
    project.site_latitude != null &&
    project.site_longitude != null
  ) {
    const { data: distResult, error: distErr } = await supabase
      .rpc('haversine_distance_m', {
        lat1: project.site_latitude,
        lon1: project.site_longitude,
        lat2: input.latitude,
        lon2: input.longitude,
      });

    if (distErr) {
      console.error(`${op} haversine RPC failed`, { error: distErr.message, timestamp: new Date().toISOString() });
      // Non-blocking — continue without verification
    } else if (distResult !== null) {
      distanceMeters = Number(distResult);
      locationVerified = distanceMeters <= LOCATION_GATE_METERS;
      if (!locationVerified) {
        console.warn(`${op} photo location outside 100m gate`, {
          projectId: input.projectId,
          distanceMeters,
          photoLat: input.latitude,
          photoLon: input.longitude,
          timestamp: new Date().toISOString(),
        });
      }
    }
  }

  // 3. Decode base64 and upload to Supabase Storage
  const fileBuffer = Buffer.from(input.fileBase64, 'base64');
  const fileExt = input.fileName.split('.').pop() ?? 'jpg';
  const storagePath = `milestone-photos/${project.project_number}/${input.milestone}/${crypto.randomUUID()}.${fileExt}`;

  const { error: uploadErr } = await supabase.storage
    .from('documents')
    .upload(storagePath, fileBuffer, {
      contentType: input.fileType,
      upsert: false,
    });

  if (uploadErr) {
    console.error(`${op} storage upload failed`, { storagePath, error: uploadErr.message, timestamp: new Date().toISOString() });
    return err(`Storage upload failed: ${uploadErr.message}`);
  }

  // 4. Insert milestone_photos row
  const { data: inserted, error: insertErr } = await supabase
    .from('milestone_photos')
    .insert({
      id: crypto.randomUUID(),
      project_id: input.projectId,
      milestone: input.milestone,
      storage_path: storagePath,
      latitude: input.latitude,
      longitude: input.longitude,
      exif_timestamp: input.exifTimestamp,
      location_verified: input.latitude !== null ? locationVerified : null,
      location_distance_m: distanceMeters,
    })
    .select('id')
    .single();

  if (insertErr || !inserted) {
    console.error(`${op} insert failed`, { error: insertErr?.message, timestamp: new Date().toISOString() });
    // Attempt to clean up the uploaded file
    await supabase.storage.from('documents').remove([storagePath]);
    return err(insertErr?.message ?? 'Failed to save photo record');
  }

  console.log(`${op} uploaded milestone photo`, {
    id: inserted.id,
    projectId: input.projectId,
    milestone: input.milestone,
    locationVerified,
    distanceMeters,
    timestamp: new Date().toISOString(),
  });

  return ok({ id: inserted.id, location_verified: locationVerified, distance_m: distanceMeters });
}

export async function listMilestonePhotos(
  projectId: string,
): Promise<ActionResult<Array<{
  id: string;
  milestone: string;
  uploaded_at: string;
  storage_path: string;
  location_verified: boolean | null;
  location_distance_m: number | null;
  uploaded_by: string | null;
}>>> {
  const op = '[listMilestonePhotos]';

  if (!projectId) return err('projectId is required');

  const supabase = await createClient();

  const { data, error } = await supabase
    .from('milestone_photos')
    .select('id, milestone, uploaded_at, storage_path, location_verified, location_distance_m, uploaded_by')
    .eq('project_id', projectId)
    .order('uploaded_at', { ascending: false });

  if (error) {
    console.error(`${op} query failed`, { projectId, error: error.message, timestamp: new Date().toISOString() });
    return err(error.message);
  }

  if (!data) return ok([]);

  return ok(data);
}

/** Returns which milestones are still missing photos (for warning UI). */
export async function getMissingMilestones(
  projectId: string,
): Promise<ActionResult<MilestoneName[]>> {
  const op = '[getMissingMilestones]';

  if (!projectId) return err('projectId is required');

  const supabase = await createClient();

  const { data, error } = await supabase
    .from('milestone_photos')
    .select('milestone')
    .eq('project_id', projectId);

  if (error) {
    console.error(`${op} query failed`, { projectId, error: error.message, timestamp: new Date().toISOString() });
    return err(error.message);
  }

  const covered = new Set((data ?? []).map((r) => r.milestone as MilestoneName));
  const missing = MILESTONE_NAMES.filter((m) => !covered.has(m));

  return ok(missing);
}
