/**
 * sarvam-client.ts — Sarvam AI ASR client for Shiroi ERP.
 *
 * Uses Sarvam Saaras-v2 for Tamil + Tanglish + English speech-to-text.
 * Designed for the B1 Tamil voice-to-text site reports feature (S7).
 *
 * Usage:
 *   import { sarvamTranscribe } from '@/lib/ai/sarvam-client';
 *   const result = await sarvamTranscribe(audioBuffer, 'audio/ogg');
 *
 * Sarvam API docs: https://docs.sarvam.ai/api-reference-docs/speech-to-text
 */

const SARVAM_ASR_URL = 'https://api.sarvam.ai/speech-to-text';
const SUPPORTED_MIME_TYPES = new Set(['audio/ogg', 'audio/wav', 'audio/mpeg', 'audio/mp3', 'audio/webm']);
const TIMEOUT_MS = 30_000; // ASR can take longer than embeddings

export interface SarvamTranscribeResult {
  transcript: string;
  language: string;      // BCP-47 code, e.g. 'ta-IN', 'en-IN'
  durationSeconds: number;
}

interface SarvamASRResponse {
  transcript: string;
  language_code?: string;
  language?: string;
  duration?: number;
  durationSeconds?: number;
}

/**
 * sarvamTranscribe — transcribe audio using Sarvam Saaras-v2.
 *
 * Supports Tamil, English, and Tanglish (code-switched Tamil+English).
 * Audio should be single-channel, 16kHz preferred but any sample rate accepted.
 *
 * @param audioBuffer - Raw audio bytes (Buffer or Uint8Array)
 * @param mimeType    - MIME type of the audio ('audio/ogg', 'audio/wav', 'audio/mp3')
 * @returns Transcript text, detected language code, and duration in seconds
 * @throws if SARVAM_API_KEY is unset, MIME type unsupported, or API errors
 */
export async function sarvamTranscribe(
  audioBuffer: Uint8Array | ArrayBuffer,
  mimeType: string,
): Promise<SarvamTranscribeResult> {
  const op = '[sarvamTranscribe]';

  const apiKey = process.env.SARVAM_API_KEY;
  if (!apiKey) {
    throw new Error(
      `${op} SARVAM_API_KEY is not set. ` +
      'Add it to .env.local for local dev and to Vercel env vars for production. ' +
      'Get a key at https://app.sarvam.ai',
    );
  }

  // Normalize mime type: audio/mp3 → audio/mpeg
  const normalizedMime = mimeType === 'audio/mp3' ? 'audio/mpeg' : mimeType;

  if (!SUPPORTED_MIME_TYPES.has(normalizedMime)) {
    throw new Error(
      `${op} Unsupported MIME type: ${mimeType}. ` +
      `Supported types: ${[...SUPPORTED_MIME_TYPES].join(', ')}`,
    );
  }

  // Build multipart form — Sarvam ASR accepts multipart/form-data
  const formData = new FormData();
  // Normalise to Uint8Array for Blob.
  // Blob accepts Uint8Array as a BlobPart; the cast to unknown→BlobPart works around
  // a TS lib dom quirk where Uint8Array<ArrayBufferLike> !== Uint8Array<ArrayBuffer>.
  const uint8 = audioBuffer instanceof Uint8Array ? audioBuffer : new Uint8Array(audioBuffer);
  const blob = new Blob([uint8 as unknown as BlobPart], { type: normalizedMime });
  // Extension mapping for file name hint
  const ext = normalizedMime === 'audio/mpeg' ? 'mp3'
    : normalizedMime === 'audio/ogg' ? 'ogg'
    : normalizedMime === 'audio/webm' ? 'webm'
    : 'wav';
  formData.append('file', blob, `audio.${ext}`);
  formData.append('model', 'saaras:v2');
  // language_code: 'unknown' triggers auto-detection (Tamil + English)
  formData.append('language_code', 'unknown');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(SARVAM_ASR_URL, {
      method: 'POST',
      headers: {
        'api-subscription-key': apiKey,
      },
      body: formData,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '(unreadable)');
    throw new Error(
      `${op} Sarvam API error ${response.status}: ${body.substring(0, 400)}`,
    );
  }

  const json = (await response.json()) as SarvamASRResponse;

  const transcript = json.transcript ?? '';
  const language = json.language_code ?? json.language ?? 'unknown';
  const durationSeconds = json.durationSeconds ?? json.duration ?? 0;

  return { transcript, language, durationSeconds };
}
