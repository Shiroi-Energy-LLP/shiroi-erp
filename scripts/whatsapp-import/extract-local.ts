// scripts/whatsapp-import/extract-local.ts
// Rule-based extraction — no LLM needed.
// Parses all 3 WhatsApp ZIPs and inserts records into whatsapp_import_queue.
// Usage: npx tsx extract-local.ts

import 'dotenv/config';
import AdmZip from 'adm-zip';
import StreamZip from 'node-stream-zip';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../../packages/types/database.js';

const supabase = createClient<Database>(
  process.env['SUPABASE_URL'] ?? '',
  process.env['SUPABASE_SECRET_KEY'] ?? '',
);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ChatProfile = 'marketing' | 'llp' | 'shiroi_energy';

interface RawMessage {
  timestamp: Date;
  sender: string;
  text: string;
  attachments: string[];
}

interface QueueInsert {
  chat_profile: ChatProfile;
  message_hash: string;
  extraction_type: string;
  raw_message_text: string;
  sender_name: string;
  message_timestamp: string;
  media_filenames?: string[];
  extracted_data: Record<string, unknown>;
  confidence_score: number;
  requires_finance_review: boolean;
  review_status: 'pending';
  review_notes?: string;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

// WhatsApp uses U+202F (NARROW NO-BREAK SPACE) between time and AM/PM
// Line format: [DD/MM/YYYY, HH:MM:SS\u202fAM/PM] Sender: text
// Optional U+200E (LEFT-TO-RIGHT MARK) prefix
const LINE_RE = /^\u200e?\[(\d{2}\/\d{2}\/\d{4}),\s+(\d{1,2}:\d{2}:\d{2}[\s\u202f][AP]M)\]\s+([^:]+):\s(.*)$/;

function clean(text: string): string {
  return text
    .replace(/[\u200e\u200f\u202a-\u202e\u202f\ufeff\u2028\u2029]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseMessages(text: string, profile: ChatProfile): RawMessage[] {
  const lines = text.split(/\r?\n/);
  const messages: RawMessage[] = [];
  let current: RawMessage | null = null;

  for (const rawLine of lines) {
    const match = LINE_RE.exec(rawLine);

    if (match) {
      if (current) messages.push(current);
      const [, dateStr, timeStr, senderRaw, content] = match;

      // Parse date/time
      const [day, month, year] = dateStr.split('/').map(Number);
      const timeClean = timeStr.replace(/[\s\u202f]/g, ' ').trim();
      const [timePart, ampm] = timeClean.split(' ');
      const [h, m, s] = timePart.split(':').map(Number);
      let hours = h;
      if (ampm === 'PM' && h !== 12) hours += 12;
      if (ampm === 'AM' && h === 12) hours = 0;
      const ts = new Date(year, month - 1, day, hours, m, s ?? 0);

      const sender = clean(senderRaw);

      // Skip system messages
      const lc = content.toLowerCase();
      if (
        lc.includes('messages and calls are end-to-end') ||
        lc.includes('you created this group') ||
        lc.includes('changed the group name') ||
        lc.includes('security code changed') ||
        lc.includes('this message was deleted') ||
        lc === '' ||
        sender === '' ||
        (lc.startsWith('null'))
      ) {
        current = null;
        continue;
      }

      // Extract attachments from content
      const attachments: string[] = [];
      const cleanedContent = content.replace(/<attached:\s*([^>]+)>/g, (_, f) => {
        attachments.push(f.trim());
        return '';
      }).trim();

      current = {
        timestamp: ts,
        sender,
        text: cleanedContent,
        attachments,
      };
    } else if (current && rawLine.trim()) {
      // Continuation line
      current.text += '\n' + rawLine.trim();
    }
  }
  if (current) messages.push(current);
  return messages;
}

// ---------------------------------------------------------------------------
// Hash
// ---------------------------------------------------------------------------

function hashMsg(msg: RawMessage): string {
  const key = `${msg.timestamp.toISOString()}|${msg.sender}|${msg.text.slice(0, 100)}`;
  return crypto.createHash('sha256').update(key).digest('hex');
}

// ---------------------------------------------------------------------------
// Amount parser (handles Indian number formats)
// ---------------------------------------------------------------------------

function parseAmount(text: string): number | null {
  const lakhs = /(\d+(?:\.\d+)?)\s*(?:lakh|L\b|lac)/i.exec(text);
  if (lakhs) return Math.round(parseFloat(lakhs[1]) * 100000);

  const crores = /(\d+(?:\.\d+)?)\s*(?:crore|Cr\b)/i.exec(text);
  if (crores) return Math.round(parseFloat(crores[1]) * 10000000);

  const rupees = /(?:₹|Rs\.?|INR)\s*([\d,]+(?:\.\d+)?)/i.exec(text);
  if (rupees) return parseFloat(rupees[1].replace(/,/g, ''));

  const plain = /([\d,]+(?:\.\d+)?)\s*(?:rs|\/-)(?:\s|$)/i.exec(text);
  if (plain) {
    const n = parseFloat(plain[1].replace(/,/g, ''));
    if (n >= 1000) return n;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Pattern-based extractors
// ---------------------------------------------------------------------------

function extractPayment(msg: RawMessage): Record<string, unknown> | null {
  const t = msg.text.toLowerCase();

  const isReceipt =
    t.includes('payment received') || t.includes('received payment') ||
    t.includes('advance received') || t.includes('balance received') ||
    t.includes('got cheque') || t.includes('cheque received') ||
    t.includes('payment collected') || t.includes('amount received') ||
    t.includes('received from customer') ||
    t.includes('pdc received') || t.includes('post dated cheque') ||
    (msg.attachments.some(a => /cheque|payment/i.test(a)) && t.includes('payment'));

  if (!isReceipt) return null;

  const amount = parseAmount(msg.text);
  const companyMatch = /^([A-Z][A-Za-z\s&.'/-]+?)(?:\s+payment|\s+balance|\s+advance|\s+cheque)/m.exec(msg.text);
  const company = companyMatch ? companyMatch[1].trim() : '';

  const paymentMethod = t.includes('cheque') ? 'cheque' :
    t.includes('neft') || t.includes('transfer') ? 'bank_transfer' :
    t.includes('cash') ? 'cash' :
    t.includes('upi') || t.includes('gpay') || t.includes('phonepe') ? 'upi' : 'unknown';

  return {
    description: `Payment received${company ? ' from ' + company : ''}`,
    amount: amount ?? null,
    company: company || null,
    payment_method: paymentMethod,
    notes: msg.text.slice(0, 500),
  };
}

function extractContact(msg: RawMessage): Record<string, unknown> | null {
  const phoneMatch = /(?:^|[\s,/])((?:\+91)?[6-9]\d{9})(?:[\s,/]|$)/m.exec(msg.text);
  if (!phoneMatch) return null;

  const phone = phoneMatch[1].replace(/\D/g, '').slice(-10);
  if (phone.length !== 10) return null;

  let name = '';
  const nameMatch = /^([A-Z][A-Za-z\s.]+?)(?:\s*[-:\n,]|$)/m.exec(msg.text);
  if (nameMatch) name = nameMatch[1].trim();

  if (!name) {
    const titleMatch = /(?:Mr\.|Ms\.|Mrs\.)\s*([A-Z][A-Za-z\s]+?)(?:\s*[-\n,]|$)/m.exec(msg.text);
    if (titleMatch) name = titleMatch[1].trim();
  }

  const co = /([A-Z][A-Za-z\s&.'-]+(?:Builders|Housing|Foundation|Construction|Homes|Properties|Estate|Group|Developers|Industries|Tech|Pvt|Ltd|LLP|Hospitals|Hospital|School|College))\b/i.exec(msg.text);
  const company = co ? co[1].trim() : null;

  const t = msg.text.toLowerCase();
  const inquiryType = t.includes('rental') ? 'rental' :
    t.includes('ongrid') || t.includes('on-grid') ? 'ongrid' :
    t.includes('offgrid') || t.includes('off-grid') ? 'offgrid' :
    t.includes('water heater') ? 'water_heater' :
    t.includes('amc') ? 'amc' : null;

  return { name: name || 'Unknown', phone, company, inquiry_type: inquiryType };
}

function extractPO(msg: RawMessage): Record<string, unknown> | null {
  const t = msg.text.toLowerCase();
  const hasPO =
    t.includes('po received') || t.includes('work order') ||
    t.includes('purchase order') || t.includes('order confirmed') ||
    t.includes('wo received') ||
    msg.attachments.some(a => /p\.o\.|po\s|purchase.order|work.order|wo[-_]/i.test(a));

  if (!hasPO) return null;

  const companyMatch = /([A-Z][A-Za-z\s&.'/-]+?)(?:\s+PO|\s+WO|\s+work order|\s+purchase order|\s+order confirmed)/im.exec(msg.text);
  const company = companyMatch ? companyMatch[1].trim() : 'Unknown';

  const kw = /(\d+(?:\.\d+)?)\s*kw/i.exec(msg.text);
  const systemSize = kw ? parseFloat(kw[1]) : null;

  const poRef = msg.attachments.find(a => /p\.o\.|po\s|wo[-_]/i.test(a)) ?? null;
  const amount = parseAmount(msg.text);

  return { company, system_size_kw: systemSize, po_reference: poRef, amount };
}

function extractActivity(msg: RawMessage, profile: ChatProfile): Record<string, unknown> | null {
  if (msg.text.length < 20) return null;
  const t = msg.text.toLowerCase();

  const isActivity =
    t.includes('visited') || t.includes('site visit') ||
    t.includes('met ') || t.includes('quotation sent') ||
    t.includes('measurements taken') || t.includes('order confirmed') ||
    t.includes('discussed') || t.includes('meeting held') ||
    (profile === 'shiroi_energy' && (
      t.includes('installation') || t.includes('completed') ||
      t.includes('work done') || t.includes('earthing') ||
      t.includes('panel fixed') || t.includes('inverter') ||
      t.includes('commissioned') || t.includes('energized') ||
      t.includes('testing done') || t.includes('net metering')
    ));

  if (!isActivity) return null;

  const activityType = t.includes('site visit') || t.includes('visited') ? 'site_visit' :
    t.includes('quotation') ? 'quotation_sent' :
    t.includes('meeting') ? 'meeting' :
    t.includes('installation') || t.includes('commissioned') ? 'installation_update' :
    'note';

  return {
    summary: msg.text.slice(0, 300),
    activity_type: activityType,
    sender: msg.sender,
  };
}

function extractDailyReport(msg: RawMessage): Record<string, unknown> | null {
  if (msg.text.length < 50) return null;
  const t = msg.text.toLowerCase();

  // Daily site update patterns
  const isDailyReport =
    (t.includes('today') || t.includes('work done') || t.includes('progress')) &&
    (t.includes('panel') || t.includes('module') || t.includes('inverter') ||
     t.includes('structure') || t.includes('cable') || t.includes('earthing') ||
     t.includes('mc4') || t.includes('installation') || t.includes('mounting'));

  if (!isDailyReport) return null;

  const kw = /(\d+(?:\.\d+)?)\s*kw/i.exec(msg.text);

  return {
    summary: msg.text.slice(0, 500),
    system_size_kw: kw ? parseFloat(kw[1]) : null,
    sender: msg.sender,
    report_type: 'daily_site_update',
  };
}

function extractVendorPayment(msg: RawMessage): Record<string, unknown> | null {
  const t = msg.text.toLowerCase();

  const isVendorPay =
    t.includes('vendor payment') || t.includes('payment to vendor') ||
    t.includes('paid to ') || t.includes('payment made') ||
    t.includes('neft done') || t.includes('rtgs done') ||
    t.includes('transferred to ') || t.includes('payment transferred');

  if (!isVendorPay) return null;

  const amount = parseAmount(msg.text);
  const vendorMatch = /(?:paid to|payment to|transferred to)\s+([A-Z][A-Za-z\s&.'/-]+?)(?:\s*[-\n,₹]|$)/im.exec(msg.text);
  const vendor = vendorMatch ? vendorMatch[1].trim() : null;

  return {
    description: `Vendor payment${vendor ? ' to ' + vendor : ''}`,
    amount: amount ?? null,
    vendor_name: vendor,
    notes: msg.text.slice(0, 500),
  };
}

function extractBOQItem(msg: RawMessage): Record<string, unknown> | null {
  const t = msg.text.toLowerCase();

  // LLP group commonly discusses BOM/BOQ items, panel specs, quantities
  const isBOQ =
    (t.includes('panel') || t.includes('module') || t.includes('inverter') ||
     t.includes('cable') || t.includes('mc4') || t.includes('structure') ||
     t.includes('earthing') || t.includes('dcr') || t.includes('non-dcr')) &&
    (t.includes('qty') || t.includes('nos') || t.includes('pcs') ||
     t.includes('unit') || t.includes('kw') || /\d+\s*(?:nos|pcs|units?)/.test(t));

  if (!isBOQ) return null;

  const qty = /(\d+)\s*(?:nos|pcs|units?)/i.exec(msg.text);
  const kw = /(\d+(?:\.\d+)?)\s*kw/i.exec(msg.text);
  const brand = /(?:havells|polycab|siemens|growatt|sungrow|luminous|microtek|waaree|adani|vikram|jinko|longi|canadian|risen)/i.exec(msg.text);

  return {
    summary: msg.text.slice(0, 400),
    quantity: qty ? parseInt(qty[1]) : null,
    system_size_kw: kw ? parseFloat(kw[1]) : null,
    brand: brand ? brand[0] : null,
  };
}

// ---------------------------------------------------------------------------
// Process all messages for a profile
// ---------------------------------------------------------------------------

function extractFromMessages(
  messages: RawMessage[],
  profile: ChatProfile,
  existingHashes: Set<string>,
): QueueInsert[] {
  const records: QueueInsert[] = [];

  for (const msg of messages) {
    if (!msg.text && msg.attachments.length === 0) continue;

    const hash = hashMsg(msg);
    if (existingHashes.has(hash)) continue;
    existingHashes.add(hash);

    const base = {
      chat_profile: profile,
      message_hash: hash,
      raw_message_text: msg.text,
      sender_name: msg.sender,
      message_timestamp: msg.timestamp.toISOString(),
      media_filenames: msg.attachments.length > 0 ? msg.attachments : undefined,
      review_status: 'pending' as const,
    };

    // Priority: payment > vendor_payment > PO > BOQ (LLP) > daily_report (site) > contact > activity

    // 1. Customer payment
    const payment = extractPayment(msg);
    if (payment) {
      records.push({ ...base, extraction_type: 'customer_payment', extracted_data: payment, confidence_score: 0.65, requires_finance_review: true });
      continue;
    }

    // 2. Vendor payment (LLP/shiroi_energy)
    if (profile !== 'marketing') {
      const vp = extractVendorPayment(msg);
      if (vp) {
        records.push({ ...base, extraction_type: 'vendor_payment', extracted_data: vp, confidence_score: 0.65, requires_finance_review: true });
        continue;
      }
    }

    // 3. Purchase Order
    const po = extractPO(msg);
    if (po) {
      records.push({ ...base, extraction_type: 'purchase_order', extracted_data: po, confidence_score: 0.7, requires_finance_review: true });
      continue;
    }

    // 4. BOQ items (LLP group)
    if (profile === 'llp') {
      const boq = extractBOQItem(msg);
      if (boq) {
        records.push({ ...base, extraction_type: 'boq_item', extracted_data: boq, confidence_score: 0.55, requires_finance_review: false });
        continue;
      }
    }

    // 5. Daily report (shiroi_energy)
    if (profile === 'shiroi_energy') {
      const dr = extractDailyReport(msg);
      if (dr) {
        records.push({ ...base, extraction_type: 'daily_report', extracted_data: dr, confidence_score: 0.6, requires_finance_review: false });
        continue;
      }
    }

    // 6. Contact (phone number present)
    const contact = extractContact(msg);
    if (contact) {
      records.push({ ...base, extraction_type: 'contact', extracted_data: contact, confidence_score: 0.75, requires_finance_review: false });
      continue;
    }

    // 7. Notable activity
    const activity = extractActivity(msg, profile);
    if (activity) {
      records.push({ ...base, extraction_type: 'activity', extracted_data: activity, confidence_score: 0.5, requires_finance_review: false });
    }
  }

  return records;
}

// ---------------------------------------------------------------------------
// ZIP reading helpers
// ---------------------------------------------------------------------------

async function readChatTextFromZip(zipPath: string): Promise<string | null> {
  const stats = fs.statSync(zipPath);
  const sizeMB = stats.size / (1024 * 1024);
  console.log(`  ZIP size: ${sizeMB.toFixed(0)} MB`);

  // For ZIPs < 1.8 GB use AdmZip (faster, in-memory)
  if (stats.size < 1.8 * 1024 * 1024 * 1024) {
    const zip = new AdmZip(zipPath);
    const entry = zip.getEntries().find(e => e.entryName === '_chat.txt');
    if (!entry) return null;
    return zip.readAsText(entry, 'utf8');
  }

  // For large ZIPs use node-stream-zip (streaming, finds _chat.txt without loading videos)
  console.log('  Using streaming ZIP reader for large file...');
  return new Promise((resolve, reject) => {
    const zip = new (StreamZip as unknown as { new(opts: object): NodeJS.EventEmitter & { stream(name: string, cb: (err: Error | null, stm: NodeJS.ReadableStream) => void): void; close(): void } })({ file: zipPath, storeEntries: true });

    zip.on('ready', () => {
      zip.stream('_chat.txt', (err, stm) => {
        if (err || !stm) {
          zip.close();
          resolve(null);
          return;
        }
        const chunks: Buffer[] = [];
        stm.on('data', (chunk: Buffer) => chunks.push(chunk));
        stm.on('end', () => {
          zip.close();
          resolve(Buffer.concat(chunks).toString('utf8'));
        });
        stm.on('error', (e: Error) => {
          zip.close();
          reject(e);
        });
      });
    });

    zip.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// DB insert
// ---------------------------------------------------------------------------

async function batchInsert(records: QueueInsert[]): Promise<{ inserted: number; skipped: number; errors: number }> {
  let inserted = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 0; i < records.length; i += 100) {
    const batch = records.slice(i, i + 100);
    const { error } = await supabase.from('whatsapp_import_queue').insert(batch);
    if (error) {
      if (error.code === '23505') {
        skipped += batch.length;
      } else {
        console.error(`  Insert error (batch ${Math.floor(i / 100)}):`, error.message);
        errors += batch.length;
      }
    } else {
      inserted += batch.length;
    }
  }
  return { inserted, skipped, errors };
}

// ---------------------------------------------------------------------------
// Load existing hashes
// ---------------------------------------------------------------------------

async function loadExistingHashes(): Promise<Set<string>> {
  const hashes = new Set<string>();
  let offset = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await supabase
      .from('whatsapp_import_queue')
      .select('message_hash')
      .range(offset, offset + pageSize - 1);

    if (error) break;
    if (!data || data.length === 0) break;
    for (const row of data) hashes.add(row.message_hash);
    if (data.length < pageSize) break;
    offset += pageSize;
  }

  console.log(`[dedup] ${hashes.size} existing hashes loaded`);
  return hashes;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const CHAT_ZIPS: Array<{ profile: ChatProfile; path: string }> = [
  {
    profile: 'marketing',
    path: 'C:/Users/vivek/OneDrive/Desktop/WhatsApp Chat - Shiroi Marketing.zip',
  },
  {
    profile: 'llp',
    path: 'C:/Users/vivek/OneDrive/Desktop/WhatsApp Chat - Shiroi Energy LLP _ rooftop _ Purchase.zip',
  },
  {
    profile: 'shiroi_energy',
    path: 'C:/Users/vivek/OneDrive/Desktop/WhatsApp Chat - Shiroi Energy \u26a1.zip',
  },
];

async function main() {
  if (!process.env['SUPABASE_URL'] || !process.env['SUPABASE_SECRET_KEY']) {
    console.error('Missing SUPABASE_URL or SUPABASE_SECRET_KEY');
    process.exit(1);
  }

  console.log('[WhatsApp Local Extract] Starting rule-based extraction');
  console.log(`[WhatsApp Local Extract] Time: ${new Date().toISOString()}\n`);

  const existingHashes = await loadExistingHashes();

  let totalInserted = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  for (const { profile, path: zipPath } of CHAT_ZIPS) {
    try {
      console.log(`\n[${profile}] Processing: ${path.basename(zipPath)}`);

      const chatText = await readChatTextFromZip(zipPath);
      if (!chatText) {
        console.log(`[${profile}] No _chat.txt found, skipping`);
        continue;
      }

      const messages = parseMessages(chatText, profile);
      console.log(`[${profile}] Parsed ${messages.length} messages`);

      const records = extractFromMessages(messages, profile, existingHashes);
      console.log(`[${profile}] Extracted ${records.length} records`);

      if (records.length > 0) {
        const result = await batchInsert(records);
        console.log(`[${profile}] Inserted: ${result.inserted}, Skipped: ${result.skipped}, Errors: ${result.errors}`);
        totalInserted += result.inserted;
        totalSkipped += result.skipped;
        totalErrors += result.errors;
      }
    } catch (err) {
      console.error(`[${profile}] Failed:`, err instanceof Error ? err.message : String(err));
    }
  }

  console.log('\n===== FINAL SUMMARY =====');
  console.log(`Total inserted: ${totalInserted}`);
  console.log(`Total skipped:  ${totalSkipped}`);
  console.log(`Total errors:   ${totalErrors}`);
  console.log('Done!');
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
