/**
 * Phase 4.2: AI Photo Tagging with Claude Vision
 *
 * Reads photos from site_photos table, sends to Claude vision,
 * inserts tags into photo_tags table.
 *
 * Cost estimate: ~1,800 photos × ~300 tokens avg = ~540K tokens ≈ $20-30
 *
 * Usage:
 *   npx tsx scripts/tag-photos-ai.ts --dry-run
 *   npx tsx scripts/tag-photos-ai.ts --limit=50
 *   npx tsx scripts/tag-photos-ai.ts
 */

import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { PhotoTagSchema, type PhotoTag } from './ai-extract-schemas';
import { PHOTO_TAG_PROMPT } from './ai-extract-prompts';
import { isDryRun, logMigrationStart, logMigrationEnd } from './migration-utils';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  dotenv.config({ path: 'C:/Users/vivek/Projects/shiroi-erp/.env.local' });
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
);

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

const MODEL = 'claude-sonnet-4-20250514';

function getArg(name: string): string | undefined {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.split('=')[1] : undefined;
}

async function main() {
  const op = '[tag-photos]';
  const dry = isDryRun();
  const limitArg = getArg('limit');
  const limit = limitArg ? parseInt(limitArg, 10) : Infinity;

  console.log(`${op} Mode: ${dry ? 'DRY RUN' : 'LIVE'}, Limit: ${limit === Infinity ? 'ALL' : limit}`);

  // Get photos that don't have tags yet
  const { data: photos, error: photosError } = await supabase
    .from('site_photos')
    .select('id, project_id, storage_path, file_name, bucket_id')
    .order('created_at', { ascending: true });

  if (photosError || !photos) {
    console.error(`${op} Failed to fetch photos:`, photosError?.message);
    return;
  }

  // Check existing tags
  const { data: existingTags } = await supabase
    .from('photo_tags')
    .select('site_photo_id');

  const taggedPhotoIds = new Set((existingTags ?? []).map((t) => t.site_photo_id));
  const untaggedPhotos = photos.filter((p) => !taggedPhotoIds.has(p.id));

  console.log(`${op} ${photos.length} total photos, ${taggedPhotoIds.size} already tagged, ${untaggedPhotos.length} to tag`);

  let photosToProcess = untaggedPhotos;
  if (photosToProcess.length > limit) {
    photosToProcess = photosToProcess.slice(0, limit);
    console.log(`${op} Limited to first ${limit} photos`);
  }

  logMigrationStart('tag-photos-ai', photosToProcess.length);

  let stats = { processed: 0, tagged: 0, errors: 0, skipped: 0, totalTokens: 0 };

  // Process sequentially (vision API is rate-limited)
  for (let i = 0; i < photosToProcess.length; i++) {
    const photo = photosToProcess[i];
    stats.processed++;

    if (stats.processed % 25 === 0) {
      console.log(`${op} Progress: ${stats.processed}/${photosToProcess.length} (tagged: ${stats.tagged}, tokens: ${stats.totalTokens})`);
    }

    if (dry) {
      console.log(`  ${(photo.file_name ?? '').substring(0, 50).padEnd(52)} | bucket: ${photo.bucket_id}`);
      stats.tagged++;
      continue;
    }

    // Get signed URL for the photo
    const bucket = photo.bucket_id ?? 'proposal-files';
    const { data: urlData } = await supabase.storage
      .from(bucket)
      .createSignedUrl(photo.storage_path, 300); // 5 min expiry

    if (!urlData?.signedUrl) {
      stats.skipped++;
      continue;
    }

    try {
      const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 500,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'url', url: urlData.signedUrl },
              },
              {
                type: 'text',
                text: PHOTO_TAG_PROMPT,
              },
            ],
          },
        ],
      });

      const content = response.content[0];
      if (content.type !== 'text') {
        stats.errors++;
        continue;
      }

      // Parse JSON
      let jsonStr = content.text.trim();
      const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) jsonStr = jsonMatch[1].trim();

      const parsed = JSON.parse(jsonStr);
      const validated = PhotoTagSchema.safeParse(parsed);

      if (!validated.success) {
        console.log(`  ${op} Validation failed for ${photo.file_name}: ${validated.error.issues.map(i => i.message).join(', ')}`);
        stats.errors++;
        continue;
      }

      const tag = validated.data;
      stats.totalTokens += response.usage.input_tokens + response.usage.output_tokens;

      // Insert into photo_tags
      const { error: insertError } = await supabase.from('photo_tags').insert({
        site_photo_id: photo.id,
        content_type: tag.content_type,
        structure_type: tag.structure_type,
        roof_type: tag.roof_type,
        panel_orientation: tag.panel_orientation,
        building_type: tag.building_type,
        segment: tag.segment,
        estimated_panel_count: tag.estimated_panel_count,
        caption: tag.caption,
        photo_quality: tag.photo_quality,
        ai_model: MODEL,
        confidence_score: 0.85,
      });

      if (insertError) {
        console.error(`  ${op} Insert error: ${insertError.message}`);
        stats.errors++;
      } else {
        stats.tagged++;

        // Also update site_photos caption and photo_type
        await supabase.from('site_photos').update({
          caption: tag.caption,
          photo_type: tag.content_type,
        }).eq('id', photo.id);
      }
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes('rate_limit') || msg.includes('429')) {
        console.log(`  ${op} Rate limited, waiting 30s...`);
        await new Promise((r) => setTimeout(r, 30000));
        i--; // Retry this photo
        stats.processed--;
        continue;
      }
      console.error(`  ${op} Error: ${msg.substring(0, 100)}`);
      stats.errors++;
    }

    // Small delay between requests to avoid rate limits
    if (i % 5 === 4) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  console.log(`\n${op} Results:`);
  console.log(`  Processed:    ${stats.processed}`);
  console.log(`  Tagged:       ${stats.tagged}`);
  console.log(`  Skipped:      ${stats.skipped}`);
  console.log(`  Errors:       ${stats.errors}`);
  console.log(`  Total tokens: ${stats.totalTokens}`);
  console.log(`  Est. cost:    $${((stats.totalTokens / 1_000_000) * 3).toFixed(2)}`);

  logMigrationEnd('tag-photos-ai', {
    processed: stats.processed,
    inserted: stats.tagged,
    skipped: stats.skipped,
    errors: stats.errors,
  });
}

main().catch((err) => {
  console.error('[tag-photos-ai] Fatal error:', err);
  process.exit(1);
});
