// scripts/whatsapp-import/parser.ts
// Parses WhatsApp export _chat.txt into MessageCluster[]

import * as crypto from 'node:crypto';
import type { ChatProfile, RawMessage, MessageCluster } from './types.js';

// WhatsApp export line formats:
// Android: [DD/MM/YYYY, HH:MM:SS AM/PM] Sender: text
// iPhone:  [DD/MM/YYYY, HH:MM:SS] Sender: text
const LINE_REGEX = /^\[(\d{2}\/\d{2}\/\d{4}),\s+(\d{1,2}:\d{2}:\d{2}(?:\s*[AP]M)?)\]\s+([^:]+):\s*(.*)/i;
const ATTACH_REGEX = /<attached:\s*([^>]+)>/gi;
const CLUSTER_GAP_MS = 5 * 60 * 1000; // 5 minutes

function parseTimestamp(date: string, time: string): Date {
  const [day, month, year] = date.split('/');
  const cleanTime = time.replace(/\s*(AM|PM)/i, '').trim();
  const isPM = /pm/i.test(time);
  const isAM = /am/i.test(time);

  const parts = cleanTime.split(':').map(Number);
  let hours = parts[0] ?? 0;
  const minutes = parts[1] ?? 0;
  const seconds = parts[2] ?? 0;

  if (isPM && hours !== 12) hours += 12;
  if (isAM && hours === 12) hours = 0;

  return new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    hours,
    minutes,
    seconds
  );
}

export function parseChat(chatText: string, profile: ChatProfile): MessageCluster[] {
  const op = '[parseChat]';
  const lines = chatText.split('\n');
  const messages: RawMessage[] = [];
  let currentMsg: RawMessage | null = null;

  for (const rawLine of lines) {
    // Strip Unicode control chars WhatsApp inserts
    const line = rawLine.replace(/[\u200E\u200F\uFEFF\u202A-\u202E]/g, '').trim();
    if (!line) continue;

    const match = LINE_REGEX.exec(line);
    if (match) {
      if (currentMsg) messages.push(currentMsg);
      const date = match[1] ?? '';
      const time = match[2] ?? '';
      const sender = (match[3] ?? '').trim();
      let text = (match[4] ?? '').trim();
      const attachments: string[] = [];

      // Extract attachment filenames
      ATTACH_REGEX.lastIndex = 0;
      let attMatch: RegExpExecArray | null;
      while ((attMatch = ATTACH_REGEX.exec(text)) !== null) {
        attachments.push((attMatch[1] ?? '').trim());
      }
      text = text.replace(ATTACH_REGEX, '').trim();

      const isDeleted =
        text === 'This message was deleted' ||
        text === 'You deleted this message';

      currentMsg = {
        timestamp: parseTimestamp(date, time),
        sender,
        text: isDeleted ? '' : text,
        attachedMedia: attachments,
        isDeleted,
      };
    } else if (currentMsg) {
      // Continuation line (multi-line message)
      currentMsg.text += '\n' + line;
    }
  }
  if (currentMsg) messages.push(currentMsg);

  console.log(`${op} Parsed ${messages.length} raw messages from ${profile} chat`);
  return buildClusters(messages, profile);
}

function buildClusters(messages: RawMessage[], profile: ChatProfile): MessageCluster[] {
  const clusters: MessageCluster[] = [];
  let current: MessageCluster | null = null;

  for (const msg of messages) {
    // Skip system messages
    if (
      msg.text.includes('end-to-end encrypted') ||
      msg.text.includes('created group') ||
      msg.text.includes('created this group') ||
      msg.text.includes('added you') ||
      msg.text.includes('changed the group') ||
      msg.text.includes('left') ||
      (msg.attachedMedia.length === 0 && msg.text === '' && !msg.isDeleted)
    ) continue;

    const gap = current
      ? msg.timestamp.getTime() - current.endTime.getTime()
      : Infinity;

    const sameSender = current?.sender === msg.sender;

    if (current && sameSender && gap < CLUSTER_GAP_MS) {
      current.messages.push(msg);
      current.endTime = msg.timestamp;
      if (msg.text) current.combinedText += '\n' + msg.text;
      current.mediaFiles.push(...msg.attachedMedia);
    } else {
      if (current) clusters.push(current);
      const firstMsg = msg;
      const id = crypto
        .createHash('sha256')
        .update(`${firstMsg.timestamp.toISOString()}|${firstMsg.sender}|${firstMsg.text.slice(0, 50)}`)
        .digest('hex')
        .slice(0, 16);
      current = {
        id,
        profile,
        startTime: msg.timestamp,
        endTime: msg.timestamp,
        sender: msg.sender,
        messages: [msg],
        combinedText: msg.text,
        mediaFiles: [...msg.attachedMedia],
      };
    }
  }
  if (current) clusters.push(current);

  console.log(`[buildClusters] Built ${clusters.length} clusters`);
  return clusters;
}
