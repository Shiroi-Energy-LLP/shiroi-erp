// scripts/whatsapp-import/dedup.ts
import * as crypto from 'node:crypto';
import { supabase } from './db.js';
import type { RawMessage } from './types.js';

const _seenHashes = new Set<string>();
let _loaded = false;

export function hashMessage(msg: RawMessage): string {
  const key = `${msg.timestamp.toISOString()}|${msg.sender}|${msg.text.slice(0, 100)}`;
  return crypto.createHash('sha256').update(key).digest('hex');
}

export async function loadExistingHashes(): Promise<void> {
  if (_loaded) return;
  const { data, error } = await supabase
    .from('whatsapp_import_queue')
    .select('message_hash');
  if (error) throw new Error(`[loadExistingHashes] ${error.message}`);
  for (const row of data ?? []) _seenHashes.add(row.message_hash);
  _loaded = true;
  console.log(`[dedup] Loaded ${_seenHashes.size} existing hashes`);
}

export function isAlreadyImported(hash: string): boolean {
  return _seenHashes.has(hash);
}

export function markSeen(hash: string): void {
  _seenHashes.add(hash);
}
