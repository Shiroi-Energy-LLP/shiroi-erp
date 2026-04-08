# WhatsApp Import Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Node.js script that parses three WhatsApp group chat ZIP exports, uses Claude API to extract structured data, and imports it into the correct Supabase tables — with a review queue UI in the ERP for low-confidence and financial records.

**Architecture:** A standalone `scripts/whatsapp-import/` package (Node.js + TypeScript) parses each ZIP's `_chat.txt` + media files into message clusters, batches them to Claude API with a per-chat extraction profile, and writes approved records to Supabase. An ERP page `/whatsapp-import` shows the review queue for pending/low-confidence records. The Baileys live integration is scaffolded but not wired (Phase 2).

**Tech Stack:** Node.js 24 + TypeScript, `adm-zip` (ZIP parsing), `@anthropic-ai/sdk`, `@supabase/supabase-js`, `sharp` (image resize before upload), Next.js App Router (review queue UI), Supabase Storage (`site-photos` + `project-files` buckets).

---

## Source Chat Profiles

| Profile key | ZIP file | Primary data types |
|---|---|---|
| `marketing` | `WhatsApp Chat - Shiroi Marketing.zip` | Payments received, lead follow-up tasks, customer POs, sales activities, contacts |
| `llp` | `WhatsApp Chat - Shiroi Energy LLP _ rooftop _ Purchase.zip` | Vendor POs (SESTR/SEPANEL/SEELE/SECABLE/SEINV), payment requests, BOQ items, inflow payments |
| `shiroi_energy` | `WhatsApp Chat - Shiroi Energy ⚡.zip` | Main ops group (2018–today, 40,621 lines, 10,888 photos, 712 PDFs): daily site reports, progress photos, milestone completions, BOQ/BOM lists, material deliveries, net meter installations, CEIG updates, service issues, monitoring credentials |
| `site` | (future dedicated site group) | Reserved for future use |

---

## DB Tables Written To

| Table | Source |
|---|---|
| `customer_payments` | Payment received messages (both chats) |
| `activities` + `activity_associations` | Lead follow-ups, calls, visits, notes |
| `tasks` | Follow-up task lists, meter follow-ups, payment follow-ups |
| `purchase_orders` | Vendor PO PDFs + PO request messages (LLP chat) |
| `purchase_order_items` | Line items extracted from PO text/PDFs |
| `project_boq_items` | Panel/inverter/cable requests from LLP chat |
| `vendor_payments` | Vendor payment approvals from LLP chat |
| `contacts` | Phone numbers shared in Marketing chat |
| `site_photos` | Progress/payment photos (site chat Phase 1B) |
| `whatsapp_import_queue` | Pending/low-confidence records awaiting review (NEW TABLE — migration required) |

---

## File Map

```
scripts/
  whatsapp-import/
    package.json                     ← standalone Node package (adm-zip, sharp, @anthropic-ai/sdk)
    tsconfig.json
    run.ts                           ← CLI entry: --chat <profile> --zip <path>
    parser.ts                        ← Parse _chat.txt → MessageCluster[]
    extractor.ts                     ← Claude API extraction per cluster batch
    router.ts                        ← Route extracted JSON → correct Supabase table inserts
    profiles/
      marketing.ts                   ← System prompt + extraction schema for marketing chat
      llp.ts                         ← System prompt + extraction schema for LLP chat
      shiroi_energy.ts               ← System prompt + extraction schema for main ops group
      site.ts                        ← System prompt + extraction schema for site chat (future)
    media.ts                         ← Upload images to Supabase Storage
    db.ts                            ← Supabase client (uses SUPABASE_URL + SUPABASE_SECRET_KEY)
    dedup.ts                         ← Hash-based dedup check before insert
    fuzzy-match.ts                   ← Fuzzy project/lead name matching
    types.ts                         ← Shared TypeScript types
    README.md

supabase/migrations/
  025_whatsapp_import_queue.sql      ← whatsapp_import_queue table

apps/erp/src/app/(app)/
  whatsapp-import/
    page.tsx                         ← Review queue list
    [id]/
      page.tsx                       ← Record detail + approve/reject

apps/erp/src/lib/
  whatsapp-import-queries.ts         ← Supabase queries for queue
  whatsapp-import-actions.ts         ← Server actions: approve, reject, reassign project
```

---

## Task 1: Migration — `whatsapp_import_queue` table

**Files:**
- Create: `supabase/migrations/025_whatsapp_import_queue.sql`

- [ ] **Step 1: Write migration SQL**

```sql
-- supabase/migrations/025_whatsapp_import_queue.sql
-- Review queue for WhatsApp import records pending human approval

CREATE TABLE whatsapp_import_queue (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Source metadata
  chat_profile          TEXT NOT NULL CHECK (chat_profile IN ('marketing', 'llp', 'site')),
  message_hash          TEXT NOT NULL,          -- SHA-256 of timestamp+sender+text, for dedup
  message_timestamp     TIMESTAMPTZ NOT NULL,
  sender_name           TEXT NOT NULL,
  raw_message_text      TEXT,
  media_filenames       TEXT[],                 -- original filenames from ZIP

  -- Extraction result
  extraction_type       TEXT NOT NULL CHECK (extraction_type IN (
    'customer_payment', 'vendor_payment', 'purchase_order', 'boq_item',
    'task', 'activity', 'contact', 'site_photo', 'daily_report', 'unknown'
  )),
  extracted_data        JSONB NOT NULL DEFAULT '{}',   -- Claude's extracted fields
  confidence_score      NUMERIC(4,3),                  -- 0.000–1.000
  matched_project_id    UUID REFERENCES projects(id),
  matched_lead_id       UUID REFERENCES leads(id),
  matched_project_name  TEXT,                          -- name Claude matched to

  -- Review status
  review_status         TEXT NOT NULL DEFAULT 'pending'
                        CHECK (review_status IN ('pending', 'approved', 'rejected', 'auto_inserted')),
  reviewed_by           UUID REFERENCES employees(id),
  reviewed_at           TIMESTAMPTZ,
  review_notes          TEXT,

  -- If approved, where did it land?
  inserted_table        TEXT,
  inserted_id           UUID,

  -- Financial flag (always requires review regardless of confidence)
  requires_finance_review BOOLEAN NOT NULL DEFAULT FALSE,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_whatsapp_queue_hash ON whatsapp_import_queue(message_hash);
CREATE INDEX idx_whatsapp_queue_status ON whatsapp_import_queue(review_status);
CREATE INDEX idx_whatsapp_queue_profile ON whatsapp_import_queue(chat_profile);
CREATE INDEX idx_whatsapp_queue_project ON whatsapp_import_queue(matched_project_id);
CREATE INDEX idx_whatsapp_queue_type ON whatsapp_import_queue(extraction_type);

-- RLS
ALTER TABLE whatsapp_import_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "founder_pm_finance_read_queue"
  ON whatsapp_import_queue FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('founder', 'project_manager', 'finance', 'purchase_officer')
    )
  );

CREATE POLICY "founder_pm_finance_update_queue"
  ON whatsapp_import_queue FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('founder', 'project_manager', 'finance', 'purchase_officer')
    )
  );

-- Allow the import script (using admin/service key) to insert
CREATE POLICY "admin_insert_queue"
  ON whatsapp_import_queue FOR INSERT
  WITH CHECK (true);
```

- [ ] **Step 2: Apply migration to dev Supabase**

Paste SQL into Supabase SQL Editor at https://supabase.com/dashboard/project/actqtzoxjilqnldnacqz/sql/new and run it.

- [ ] **Step 3: Regenerate TypeScript types**

```bash
cd C:\Users\vivek\Projects\shiroi-erp
npx supabase gen types typescript --project-id actqtzoxjilqnldnacqz --schema public > packages/types/database.ts
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/025_whatsapp_import_queue.sql packages/types/database.ts
git commit -m "feat: add whatsapp_import_queue migration + regenerate types"
```

---

## Task 2: Script scaffold — package, types, parser

**Files:**
- Create: `scripts/whatsapp-import/package.json`
- Create: `scripts/whatsapp-import/tsconfig.json`
- Create: `scripts/whatsapp-import/types.ts`
- Create: `scripts/whatsapp-import/parser.ts`

- [ ] **Step 1: Create `scripts/whatsapp-import/package.json`**

```json
{
  "name": "whatsapp-import",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "run": "npx tsx run.ts",
    "test": "npx vitest run"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.36.0",
    "@supabase/supabase-js": "^2.49.0",
    "adm-zip": "^0.5.16",
    "sharp": "^0.33.5"
  },
  "devDependencies": {
    "@types/adm-zip": "^0.5.7",
    "@types/node": "^22.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: Create `scripts/whatsapp-import/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist"
  },
  "include": ["*.ts", "profiles/*.ts"]
}
```

- [ ] **Step 3: Create `scripts/whatsapp-import/types.ts`**

```typescript
// scripts/whatsapp-import/types.ts

export type ChatProfile = 'marketing' | 'llp' | 'site';

export interface RawMessage {
  timestamp: Date;
  sender: string;
  text: string;
  attachedMedia: string[];   // filenames from the ZIP, e.g. "00000019-PHOTO-2024-01-01.jpg"
  isDeleted: boolean;
}

export interface MessageCluster {
  id: string;                // hash of first message in cluster
  profile: ChatProfile;
  startTime: Date;
  endTime: Date;
  sender: string;
  messages: RawMessage[];
  combinedText: string;      // all message texts joined with \n
  mediaFiles: string[];      // all media across the cluster
}

export type ExtractionType =
  | 'customer_payment'
  | 'vendor_payment'
  | 'purchase_order'
  | 'boq_item'
  | 'task'
  | 'activity'
  | 'contact'
  | 'site_photo'
  | 'daily_report'
  | 'unknown';

export interface ProjectMatch {
  project_id: string | null;
  lead_id: string | null;
  matched_name: string | null;
  confidence: number;    // 0–1
}

export interface ExtractedRecord {
  extraction_type: ExtractionType;
  project_match: ProjectMatch;
  data: Record<string, unknown>;
  confidence: number;
  requires_finance_review: boolean;
}

export interface ClusterExtractionResult {
  cluster_id: string;
  records: ExtractedRecord[];
  raw_llm_response: string;
}

// What Claude returns per cluster (parsed from JSON)
export interface LLMExtractionResponse {
  records: Array<{
    type: ExtractionType;
    project_name_mentioned: string | null;
    confidence: number;
    data: Record<string, unknown>;
  }>;
}
```

- [ ] **Step 4: Create `scripts/whatsapp-import/parser.ts`**

```typescript
// scripts/whatsapp-import/parser.ts
// Parses WhatsApp export _chat.txt into MessageCluster[]

import * as crypto from 'node:crypto';
import type { ChatProfile, RawMessage, MessageCluster } from './types.js';

// WhatsApp export line formats:
// Android: [DD/MM/YYYY, HH:MM:SS AM/PM] Sender: text
// iPhone:  [DD/MM/YYYY, HH:MM:SS] Sender: text
// Attachment: <attached: filename>
// Deleted:  This message was deleted
const LINE_REGEX = /^\[(\d{2}\/\d{2}\/\d{4}),\s+(\d{1,2}:\d{2}:\d{2}(?:\s*[AP]M)?)\]\s+([^:]+):\s*(.*)/i;
const ATTACH_REGEX = /<attached:\s*([^>]+)>/gi;
const CLUSTER_GAP_MS = 5 * 60 * 1000; // 5 minutes

function parseTimestamp(date: string, time: string): Date {
  // date: DD/MM/YYYY, time: HH:MM:SS [AM/PM]
  const [day, month, year] = date.split('/');
  const cleanTime = time.replace(/\s*(AM|PM)/i, '').trim();
  const isPM = /pm/i.test(time);
  const isAM = /am/i.test(time);

  let [hours, minutes, seconds] = cleanTime.split(':').map(Number);
  if (isPM && hours !== 12) hours += 12;
  if (isAM && hours === 12) hours = 0;

  return new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    hours,
    minutes ?? 0,
    seconds ?? 0
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
      const [, date, time, sender, text] = match as RegExpExecArray & string[];
      const attachments: string[] = [];
      let cleanText = (text ?? '').trim();

      // Extract attachment filenames
      let attMatch: RegExpExecArray | null;
      ATTACH_REGEX.lastIndex = 0;
      while ((attMatch = ATTACH_REGEX.exec(cleanText)) !== null) {
        attachments.push(attMatch[1]!.trim());
      }
      cleanText = cleanText.replace(ATTACH_REGEX, '').trim();

      const isDeleted =
        cleanText === 'This message was deleted' ||
        cleanText === 'You deleted this message';

      currentMsg = {
        timestamp: parseTimestamp(date!, time!),
        sender: (sender ?? '').trim(),
        text: isDeleted ? '' : cleanText,
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
      msg.sender === profile ||
      msg.text.includes('end-to-end encrypted') ||
      msg.text.includes('created group') ||
      msg.text.includes('added you') ||
      msg.text.includes('changed the group')
    ) continue;

    const gap = current
      ? msg.timestamp.getTime() - current.endTime.getTime()
      : Infinity;

    const sameSender = current?.sender === msg.sender;

    if (current && sameSender && gap < CLUSTER_GAP_MS) {
      // Extend existing cluster
      current.messages.push(msg);
      current.endTime = msg.timestamp;
      current.combinedText += '\n' + msg.text;
      current.mediaFiles.push(...msg.attachedMedia);
    } else {
      if (current) clusters.push(current);
      const id = crypto
        .createHash('sha256')
        .update(`${msg.timestamp.toISOString()}|${msg.sender}|${msg.text}`)
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
```

- [ ] **Step 5: Install dependencies and verify parser compiles**

```bash
cd scripts/whatsapp-import
npm install
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add scripts/whatsapp-import/
git commit -m "feat: whatsapp import script scaffold — package, types, parser"
```

---

## Task 3: Fuzzy project matching + DB client

**Files:**
- Create: `scripts/whatsapp-import/db.ts`
- Create: `scripts/whatsapp-import/fuzzy-match.ts`
- Create: `scripts/whatsapp-import/dedup.ts`

- [ ] **Step 1: Create `scripts/whatsapp-import/db.ts`**

```typescript
// scripts/whatsapp-import/db.ts
import { createClient } from '@supabase/supabase-js';

const url = process.env['SUPABASE_URL'];
const key = process.env['SUPABASE_SECRET_KEY'];

if (!url || !key) {
  throw new Error('[db] SUPABASE_URL and SUPABASE_SECRET_KEY must be set in environment');
}

export const supabase = createClient(url, key, {
  auth: { persistSession: false },
});

export interface ProjectRecord {
  id: string;
  customer_name: string;
  project_number: string;
  site_city: string | null;
  status: string;
}

export interface LeadRecord {
  id: string;
  name: string;
  phone: string | null;
  city: string | null;
  status: string;
}

export interface EmployeeRecord {
  id: string;
  name: string;
  whatsapp_sender_name: string | null;  // stored in notes field for now
}

let _projects: ProjectRecord[] | null = null;
let _leads: LeadRecord[] | null = null;
let _employees: EmployeeRecord[] | null = null;

export async function getAllProjects(): Promise<ProjectRecord[]> {
  if (_projects) return _projects;
  const { data, error } = await supabase
    .from('projects')
    .select('id, customer_name, project_number, site_city, status')
    .is('deleted_at', null);
  if (error) throw new Error(`[getAllProjects] ${error.message}`);
  _projects = data ?? [];
  return _projects;
}

export async function getAllLeads(): Promise<LeadRecord[]> {
  if (_leads) return _leads;
  const { data, error } = await supabase
    .from('leads')
    .select('id, name, phone, city, status')
    .not('status', 'eq', 'lost');
  if (error) throw new Error(`[getAllLeads] ${error.message}`);
  _leads = data ?? [];
  return _leads;
}

export async function getAllEmployees(): Promise<EmployeeRecord[]> {
  if (_employees) return _employees;
  const { data, error } = await supabase
    .from('employees')
    .select('id, name')
    .eq('is_active', true);
  if (error) throw new Error(`[getAllEmployees] ${error.message}`);
  _employees = (data ?? []).map(e => ({ ...e, whatsapp_sender_name: null }));
  return _employees;
}
```

- [ ] **Step 2: Create `scripts/whatsapp-import/fuzzy-match.ts`**

```typescript
// scripts/whatsapp-import/fuzzy-match.ts
// Fuzzy matching of WhatsApp-mentioned names → projects/leads

import type { ProjectRecord, LeadRecord } from './db.js';

/**
 * Normalise a string for comparison: lowercase, remove common noise words,
 * strip punctuation.
 */
function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b(mr|mrs|ms|dr|sir|smt|shri)\b/g, '')
    .replace(/\b(pvt|ltd|llp|private|limited|constructions?|builders?|developers?|enterprises?|homes?|projects?|apartments?|flats?|nagar|colony|street)\b/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Bigram similarity (Dice coefficient) — handles typos and partial names well.
 */
function bigramSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  const getBigrams = (s: string) => {
    const bigrams = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) bigrams.add(s.slice(i, i + 2));
    return bigrams;
  };

  const aB = getBigrams(a);
  const bB = getBigrams(b);
  let intersection = 0;
  for (const bg of aB) if (bB.has(bg)) intersection++;
  return (2 * intersection) / (aB.size + bB.size);
}

export interface FuzzyMatch {
  id: string;
  type: 'project' | 'lead';
  matched_name: string;
  score: number;
}

export function fuzzyMatchProjects(
  mention: string,
  projects: ProjectRecord[],
  leads: LeadRecord[]
): FuzzyMatch | null {
  if (!mention || mention.trim().length < 3) return null;

  const query = normalise(mention);
  if (!query) return null;

  let best: FuzzyMatch | null = null;
  let bestScore = 0;

  for (const p of projects) {
    const score = bigramSimilarity(query, normalise(p.customer_name));
    // Also try project_number exact match
    const numMatch = p.project_number.toLowerCase().includes(query) ? 0.95 : 0;
    const final = Math.max(score, numMatch);
    if (final > bestScore) {
      bestScore = final;
      best = { id: p.id, type: 'project', matched_name: p.customer_name, score: final };
    }
  }

  for (const l of leads) {
    const score = bigramSimilarity(query, normalise(l.name));
    if (score > bestScore) {
      bestScore = score;
      best = { id: l.id, type: 'lead', matched_name: l.name, score };
    }
  }

  // Minimum threshold to count as a match
  if (!best || bestScore < 0.35) return null;
  return best;
}
```

- [ ] **Step 3: Create `scripts/whatsapp-import/dedup.ts`**

```typescript
// scripts/whatsapp-import/dedup.ts
// Check whether a message_hash already exists in whatsapp_import_queue
// to prevent re-processing on re-runs.

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
```

- [ ] **Step 4: Verify TypeScript compilation**

```bash
cd scripts/whatsapp-import
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add scripts/whatsapp-import/db.ts scripts/whatsapp-import/fuzzy-match.ts scripts/whatsapp-import/dedup.ts
git commit -m "feat: whatsapp import — db client, fuzzy matching, dedup"
```

---

## Task 4: Chat profiles (extraction prompts)

**Files:**
- Create: `scripts/whatsapp-import/profiles/marketing.ts`
- Create: `scripts/whatsapp-import/profiles/llp.ts`
- Create: `scripts/whatsapp-import/profiles/site.ts`

- [ ] **Step 1: Create `scripts/whatsapp-import/profiles/marketing.ts`**

```typescript
// scripts/whatsapp-import/profiles/marketing.ts

export const MARKETING_SYSTEM_PROMPT = `You are a data extraction assistant for Shiroi Energy, a solar EPC company in Chennai, India.

You will receive batches of WhatsApp message clusters from the Shiroi Marketing group chat.
This group was used for: payment follow-ups, lead status updates, customer PO receipts, sales visit logs, and general sales coordination.

Your job is to extract ALL useful structured data from each cluster into JSON.

## Extraction rules

For each cluster, return a JSON array of records. Each record has:
- "type": one of ["customer_payment", "task", "activity", "contact", "purchase_order", "unknown"]
- "project_name_mentioned": the customer/project name as mentioned in the message (or null)
- "confidence": 0.0–1.0 how confident you are in the extraction
- "data": object with extracted fields (see per-type schema below)

## Per-type data schemas

### customer_payment
Triggered by: payment received, cheque received, amount received, UTR number, RTGS, NEFT
{
  "amount": number (in rupees, no commas),
  "payment_date": "YYYY-MM-DD" (use message timestamp date),
  "payment_method": "bank_transfer" | "upi" | "cheque" | "cash" | "dd",
  "payment_reference": "UTR number or cheque number if visible",
  "is_advance": true/false (advance/balance payment),
  "notes": "any extra context",
  "is_partial": true/false
}

### task
Triggered by: follow-up lists, meter follow-ups, payment follow-ups, action items, "pls follow up"
One task per action item — split numbered lists into individual tasks.
{
  "title": "string — concise task title",
  "due_date": "YYYY-MM-DD" (if a date is mentioned, else null),
  "entity_type": "lead" | "project" | "procurement" | "hr",
  "notes": "original message context"
}

### activity
Triggered by: visits, calls, meetings, site visits, WhatsApp messages to clients
{
  "activity_type": "call" | "site_visit" | "meeting" | "whatsapp" | "note" | "email",
  "title": "brief title",
  "body": "what was discussed or done",
  "occurred_at": "ISO timestamp from message"
}

### contact
Triggered by: phone numbers shared, new lead introductions, "pls visit", address + contact shared
{
  "name": "contact name",
  "phone": "10-digit Indian mobile number",
  "address": "if mentioned"
}

### purchase_order
Triggered by: "PO received", PDF filename like "KHPL-20-21-028.pdf", work order received from customer
{
  "po_number_from_customer": "customer's PO number",
  "po_date": "YYYY-MM-DD",
  "pdf_filename": "filename if attached",
  "notes": "context"
}

## Important rules
- Split ALL numbered lists into individual records (each list item = one task or one activity)
- Payment amounts: remove commas, convert lakhs (e.g. "3.5 lakhs" = 350000)
- If a message is just coordination noise ("Ok sir", "Will do", etc.), return []
- Deleted messages: return []
- Return only valid JSON — no markdown, no explanation outside the JSON
`;

export const MARKETING_USER_TEMPLATE = (
  clusterText: string,
  projectList: string,
  date: string
) => `Today's context date: ${date}

Active projects and leads for fuzzy matching:
${projectList}

Message cluster:
${clusterText}

Extract all records as a JSON array. Return [] if nothing useful.`;
```

- [ ] **Step 2: Create `scripts/whatsapp-import/profiles/llp.ts`**

```typescript
// scripts/whatsapp-import/profiles/llp.ts

export const LLP_SYSTEM_PROMPT = `You are a data extraction assistant for Shiroi Energy, a solar EPC company in Chennai, India.

You will receive batches of WhatsApp message clusters from the "Shiroi Energy LLP / rooftop / Purchase" group chat.
This group is the PURCHASE OPERATIONS channel. It contains:
- Vendor PO requests and confirmations (SESTR = structure POs, SEPANEL = panel POs, SEELE = electrical POs, SECABLE = cable POs, SEINV = invoices)
- Payment inflows from customers (photos labelled "inflow")
- Vendor payment requests and approvals
- Panel/inverter/cable requirements for projects (BOQ items)
- Structure specifications and pricing quotes

Your job is to extract ALL useful structured data from each cluster into JSON.

## Extraction rules

For each cluster, return a JSON array of records. Each record has:
- "type": one of ["purchase_order", "boq_item", "customer_payment", "vendor_payment", "task", "activity", "unknown"]
- "project_name_mentioned": the project name as mentioned (or null)
- "confidence": 0.0–1.0
- "data": object with extracted fields

## Per-type data schemas

### purchase_order
Triggered by: PO PDF filenames (SESTR*, SEPANEL*, SEELE*, SECABLE*), "raise PO", "place order", "PO for this"
{
  "po_number": "SE-format PO number if visible in filename e.g. SESTR23125-26",
  "vendor_name": "vendor company name if mentioned",
  "po_date": "YYYY-MM-DD",
  "pdf_filename": "filename if attached",
  "items": [  // extract line items from the message text if present
    {
      "item_description": "string",
      "quantity": number,
      "unit": "nos" | "mtr" | "kg" | "set",
      "unit_price": number or null,
      "brand": "string or null",
      "model": "string or null"
    }
  ],
  "payment_terms": "100% advance" | "30 days credit" | "as discussed" | null,
  "delivery_location": "site" | "office" | "specific address" | null,
  "notes": "any extra context"
}

### boq_item
Triggered by: panel requests, inverter requests, cable requirements, structure specs WITHOUT a PO number
{
  "item_category": "panels" | "inverter" | "structure" | "cable" | "electrical" | "other",
  "item_description": "string",
  "brand": "string or null",
  "model": "string or null",
  "quantity": number,
  "unit": "nos" | "mtr" | "kg" | "set",
  "system_size_kwp": number or null,
  "dcr": true/false (DCR = domestic content requirement subsidy panels),
  "unit_price": number or null,
  "notes": "string"
}

### customer_payment (inflow)
Triggered by: "inflow" label, payment screenshots, UTR numbers, amount received messages
{
  "amount": number,
  "payment_date": "YYYY-MM-DD",
  "payment_method": "bank_transfer" | "upi" | "cheque" | "cash" | "dd",
  "payment_reference": "UTR or reference number if visible",
  "is_advance": true/false,
  "notes": "project context from surrounding messages"
}

### vendor_payment
Triggered by: "process payment", "kindly process", "pay invoice", advance to vendor
{
  "vendor_name": "string",
  "amount": number or null,
  "invoice_reference": "invoice number or filename",
  "payment_type": "advance" | "milestone" | "final" | "balance",
  "notes": "string"
}

### task
Triggered by: "need PO", "follow up", "pls do needful", "update project details"
{
  "title": "string",
  "assigned_to_name": "name of person if tagged",
  "due_date": null,
  "entity_type": "project" | "procurement",
  "notes": "string"
}

## Structure spec parsing
When a structure spec is shared (North Leg, South Leg, Truss, Purlin, dimensions), extract as a boq_item:
- item_description: "Mounting Structure [table size e.g. 2x5, 10 panel]"
- item_category: "structure"
- unit_price: the "Total Cost = XXXXX Rs" value (before tax)

## Important rules
- SESTR = structure vendor PO, SEPANEL = panel PO, SEELE = electrical material PO, SECABLE = cable PO, SEINV = invoice
- "inflow" = customer payment received
- Panel specs: "DCR" = subsidy-eligible domestic panels; "Non DCR" = non-domestic
- Return only valid JSON. No markdown. No explanation outside JSON.
`;

export const LLP_USER_TEMPLATE = (
  clusterText: string,
  projectList: string,
  date: string
) => `Today's context date: ${date}

Active projects for fuzzy matching:
${projectList}

Message cluster:
${clusterText}

Extract all records as a JSON array. Return [] if nothing useful.`;
```

- [ ] **Step 3: Create `scripts/whatsapp-import/profiles/site.ts`**

```typescript
// scripts/whatsapp-import/profiles/site.ts

export const SITE_SYSTEM_PROMPT = `You are a data extraction assistant for Shiroi Energy, a solar EPC company in Chennai, India.

You will receive batches of WhatsApp message clusters from the Shiroi site updates group chat.
This group contains daily site progress updates, photo reports, material deliveries, issues, and milestone completions.

Your job is to extract ALL useful structured data from each cluster into JSON.

For each cluster, return a JSON array of records. Each record has:
- "type": one of ["daily_report", "site_photo", "task", "activity", "milestone_update", "delivery", "unknown"]
- "project_name_mentioned": project/customer name as mentioned (or null)
- "confidence": 0.0–1.0
- "data": object with extracted fields

## Per-type data schemas

### daily_report
{
  "report_date": "YYYY-MM-DD",
  "workers_count": number or null,
  "supervisors_count": number or null,
  "panels_installed_today": number or null,
  "work_description": "free text summary",
  "weather": "sunny" | "partly_cloudy" | "cloudy" | "rainy" | "stormy" | null,
  "weather_delay": true/false,
  "structure_progress": "not_started" | "columns_done" | "rails_done" | "bracing_done" | "complete" | null,
  "electrical_progress": "not_started" | "inverter_mounted" | "acdb_done" | "strings_done" | "ac_cable_done" | "complete" | null,
  "issues_reported": true/false,
  "issue_summary": "string or null",
  "materials_received": true/false,
  "pm_visited": true/false
}

### site_photo
For each attached media file in the cluster:
{
  "filename": "original filename from ZIP",
  "photo_type": "progress" | "material_received" | "qc_gate" | "issue" | "before_work" | "after_work" | "other",
  "caption": "any text associated with the photo",
  "report_date": "YYYY-MM-DD"
}

### milestone_update
Triggered by: "structure complete", "panels done", "inverter mounted", "commissioning done" etc.
{
  "milestone_name": "string",
  "status": "completed" | "in_progress",
  "date": "YYYY-MM-DD",
  "notes": "string"
}

### delivery
Triggered by: material arrival, "material received", "panels delivered"
{
  "item_description": "what was delivered",
  "quantity": number or null,
  "unit": "nos" | "mtr" | "set" | null,
  "delivery_date": "YYYY-MM-DD",
  "notes": "string"
}

### task
{
  "title": "string",
  "priority": "low" | "medium" | "high" | "critical",
  "due_date": "YYYY-MM-DD" or null,
  "notes": "string"
}

## Important rules
- One daily_report per project per date (merge info if multiple messages same project same day)
- Each photo attachment = one site_photo record
- Return only valid JSON. No markdown.
`;

export const SITE_USER_TEMPLATE = (
  clusterText: string,
  projectList: string,
  date: string
) => `Today's context date: ${date}

Active projects for fuzzy matching:
${projectList}

Message cluster:
${clusterText}

Extract all records as a JSON array. Return [] if nothing useful.`;
```

- [ ] **Step 4: Commit**

```bash
git add scripts/whatsapp-import/profiles/
git commit -m "feat: whatsapp import — extraction prompt profiles for all 3 chats"
```

---

## Task 5: Claude API extractor

**Files:**
- Create: `scripts/whatsapp-import/extractor.ts`

- [ ] **Step 1: Create `scripts/whatsapp-import/extractor.ts`**

```typescript
// scripts/whatsapp-import/extractor.ts
// Calls Claude API with batches of message clusters and returns structured extractions.

import Anthropic from '@anthropic-ai/sdk';
import type { MessageCluster, ClusterExtractionResult, LLMExtractionResponse, ExtractedRecord, ExtractionType } from './types.js';
import type { ProjectRecord, LeadRecord } from './db.js';
import { fuzzyMatchProjects } from './fuzzy-match.js';
import { MARKETING_SYSTEM_PROMPT, MARKETING_USER_TEMPLATE } from './profiles/marketing.js';
import { LLP_SYSTEM_PROMPT, LLP_USER_TEMPLATE } from './profiles/llp.js';
import { SITE_SYSTEM_PROMPT, SITE_USER_TEMPLATE } from './profiles/site.js';

const BATCH_SIZE = 15; // clusters per API call
const FINANCIAL_TYPES: ExtractionType[] = ['customer_payment', 'vendor_payment', 'purchase_order'];

const client = new Anthropic({
  apiKey: process.env['ANTHROPIC_API_KEY'],
});

function getProfilePrompts(profile: string) {
  switch (profile) {
    case 'marketing': return { system: MARKETING_SYSTEM_PROMPT, user: MARKETING_USER_TEMPLATE };
    case 'llp':       return { system: LLP_SYSTEM_PROMPT,       user: LLP_USER_TEMPLATE };
    case 'site':      return { system: SITE_SYSTEM_PROMPT,      user: SITE_USER_TEMPLATE };
    default: throw new Error(`Unknown profile: ${profile}`);
  }
}

function buildProjectList(projects: ProjectRecord[], leads: LeadRecord[]): string {
  const pLines = projects.slice(0, 200).map(p =>
    `PROJECT: ${p.customer_name} | ${p.project_number} | ${p.site_city ?? ''} | status:${p.status}`
  );
  const lLines = leads.slice(0, 100).map(l =>
    `LEAD: ${l.name} | ${l.phone ?? ''} | ${l.city ?? ''} | status:${l.status}`
  );
  return [...pLines, ...lLines].join('\n');
}

function formatCluster(cluster: MessageCluster): string {
  const ts = cluster.startTime.toISOString().slice(0, 16);
  const media = cluster.mediaFiles.length
    ? `[MEDIA: ${cluster.mediaFiles.join(', ')}]`
    : '';
  return `---\n[${ts}] ${cluster.sender}:\n${cluster.combinedText}\n${media}`.trim();
}

async function extractBatch(
  clusters: MessageCluster[],
  projects: ProjectRecord[],
  leads: LeadRecord[],
  profile: string
): Promise<ClusterExtractionResult[]> {
  const op = '[extractBatch]';
  const { system, user } = getProfilePrompts(profile);
  const projectList = buildProjectList(projects, leads);
  const date = new Date().toISOString().slice(0, 10);

  const batchText = clusters.map(formatCluster).join('\n\n');
  const userPrompt = user(batchText, projectList, date);

  let rawResponse = '';
  try {
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system,
      messages: [{ role: 'user', content: userPrompt }],
    });
    rawResponse = msg.content[0]?.type === 'text' ? msg.content[0].text : '';
  } catch (err) {
    console.error(`${op} Claude API error:`, err);
    return clusters.map(c => ({ cluster_id: c.id, records: [], raw_llm_response: '' }));
  }

  // Claude sometimes wraps in ```json ... ```
  const jsonText = rawResponse.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();

  let parsed: LLMExtractionResponse['records'] = [];
  try {
    const result = JSON.parse(jsonText);
    parsed = Array.isArray(result) ? result : (result.records ?? []);
  } catch {
    console.warn(`${op} Failed to parse JSON response, skipping batch`);
    return clusters.map(c => ({ cluster_id: c.id, records: [], raw_llm_response: rawResponse }));
  }

  // Map back to clusters — Claude returns a flat array for the whole batch
  // We attribute all records to the batch, then split back by cluster context
  const results: ClusterExtractionResult[] = clusters.map(cluster => ({
    cluster_id: cluster.id,
    records: [],
    raw_llm_response: rawResponse,
  }));

  // For each extracted record, fuzzy-match project and assign to cluster[0]
  // (since the batch is small and records are ordered by cluster)
  for (const rawRecord of parsed) {
    const match = rawRecord.project_name_mentioned
      ? fuzzyMatchProjects(rawRecord.project_name_mentioned, projects, leads)
      : null;

    const record: ExtractedRecord = {
      extraction_type: rawRecord.type as ExtractionType,
      project_match: {
        project_id: match?.type === 'project' ? match.id : null,
        lead_id: match?.type === 'lead' ? match.id : null,
        matched_name: match?.matched_name ?? rawRecord.project_name_mentioned ?? null,
        confidence: match?.score ?? 0,
      },
      data: rawRecord.data as Record<string, unknown>,
      confidence: rawRecord.confidence ?? 0.5,
      requires_finance_review: FINANCIAL_TYPES.includes(rawRecord.type as ExtractionType),
    };

    // Assign to first cluster result (batch-level attribution is fine for queue)
    results[0]?.records.push(record);
  }

  return results;
}

export async function extractClusters(
  clusters: MessageCluster[],
  projects: ProjectRecord[],
  leads: LeadRecord[],
  profile: string
): Promise<ClusterExtractionResult[]> {
  const op = '[extractClusters]';
  const results: ClusterExtractionResult[] = [];

  // Process in batches
  for (let i = 0; i < clusters.length; i += BATCH_SIZE) {
    const batch = clusters.slice(i, i + BATCH_SIZE);
    console.log(`${op} Processing clusters ${i + 1}–${Math.min(i + BATCH_SIZE, clusters.length)} of ${clusters.length}`);
    const batchResults = await extractBatch(batch, projects, leads, profile);
    results.push(...batchResults);

    // Respectful rate limit pause
    if (i + BATCH_SIZE < clusters.length) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  console.log(`${op} Total clusters processed: ${results.length}`);
  return results;
}
```

- [ ] **Step 2: Commit**

```bash
git add scripts/whatsapp-import/extractor.ts
git commit -m "feat: whatsapp import — Claude API extractor with batching and profile routing"
```

---

## Task 6: Router — write extracted records to Supabase

**Files:**
- Create: `scripts/whatsapp-import/router.ts`

- [ ] **Step 1: Create `scripts/whatsapp-import/router.ts`**

```typescript
// scripts/whatsapp-import/router.ts
// Routes extracted records to the whatsapp_import_queue table.
// High-confidence non-financial records are also auto-inserted into their target tables.

import { supabase, getAllEmployees } from './db.js';
import type { ClusterExtractionResult, ExtractedRecord } from './types.js';
import type { MessageCluster } from './types.js';
import { hashMessage } from './dedup.js';

const AUTO_INSERT_THRESHOLD = 0.85;

// Sender name → employee id mapping (populated once)
const SENDER_MAP: Record<string, string> = {
  'Vivek Sridhar': '',
  'Manivel Shiroi Energy': '',
  'Prem Shiroi': '',
  '~vijayasundar': '',
  'Kesavamoorthy M': '',
  'Vinodh': '',
};

async function resolveEmployeeIds(): Promise<void> {
  const employees = await getAllEmployees();
  for (const emp of employees) {
    // Match by name contains (case-insensitive)
    for (const senderName of Object.keys(SENDER_MAP)) {
      if (
        emp.name.toLowerCase().includes(senderName.toLowerCase().split(' ')[0]?.toLowerCase() ?? '') ||
        senderName.toLowerCase().includes(emp.name.toLowerCase().split(' ')[0]?.toLowerCase() ?? '')
      ) {
        SENDER_MAP[senderName] = emp.id;
      }
    }
  }
}

function getEmployeeId(senderName: string): string | null {
  return SENDER_MAP[senderName] ?? null;
}

async function insertQueueRecord(
  cluster: MessageCluster,
  record: ExtractedRecord,
  messageHash: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from('whatsapp_import_queue')
    .insert({
      chat_profile: cluster.profile,
      message_hash: messageHash,
      message_timestamp: cluster.startTime.toISOString(),
      sender_name: cluster.sender,
      raw_message_text: cluster.combinedText.slice(0, 2000),
      media_filenames: cluster.mediaFiles,
      extraction_type: record.extraction_type,
      extracted_data: record.data,
      confidence_score: record.confidence,
      matched_project_id: record.project_match.project_id,
      matched_lead_id: record.project_match.lead_id,
      matched_project_name: record.project_match.matched_name,
      review_status: 'pending',
      requires_finance_review: record.requires_finance_review,
    })
    .select('id')
    .single();

  if (error) {
    // Ignore unique constraint violations (already imported)
    if (error.code === '23505') return null;
    console.error('[insertQueueRecord] Error:', error.message);
    return null;
  }
  return data?.id ?? null;
}

async function autoInsertCustomerPayment(
  record: ExtractedRecord,
  cluster: MessageCluster,
  queueId: string
): Promise<void> {
  const d = record.data as Record<string, unknown>;
  if (!record.project_match.project_id || !d['amount']) return;

  const empId = getEmployeeId(cluster.sender);
  if (!empId) return; // Can't insert without recorded_by

  // Generate receipt number: WA-{YYYYMMDD}-{queueId.slice(0,8)}
  const receiptDate = cluster.startTime.toISOString().slice(0, 10).replace(/-/g, '');
  const receiptNumber = `WA-${receiptDate}-${queueId.slice(0, 8).toUpperCase()}`;

  const { error } = await supabase.from('customer_payments').insert({
    project_id: record.project_match.project_id,
    recorded_by: empId,
    receipt_number: receiptNumber,
    amount: d['amount'],
    payment_date: (d['payment_date'] as string) ?? cluster.startTime.toISOString().slice(0, 10),
    payment_method: (d['payment_method'] as string) ?? 'bank_transfer',
    payment_reference: (d['payment_reference'] as string) ?? null,
    is_advance: (d['is_advance'] as boolean) ?? false,
    notes: `Imported from WhatsApp (${cluster.profile} chat). ${d['notes'] ?? ''}`.trim(),
  });

  if (error && error.code !== '23505') {
    console.warn('[autoInsertCustomerPayment] Insert failed:', error.message);
    return;
  }

  // Mark queue record as auto_inserted
  await supabase
    .from('whatsapp_import_queue')
    .update({ review_status: 'auto_inserted', inserted_table: 'customer_payments' })
    .eq('id', queueId);
}

async function autoInsertActivity(
  record: ExtractedRecord,
  cluster: MessageCluster,
  queueId: string
): Promise<void> {
  const d = record.data as Record<string, unknown>;
  const empId = getEmployeeId(cluster.sender);

  const { data: actData, error: actError } = await supabase
    .from('activities')
    .insert({
      activity_type: (d['activity_type'] as string) ?? 'note',
      title: (d['title'] as string) ?? null,
      body: (d['body'] as string) ?? cluster.combinedText.slice(0, 1000),
      occurred_at: (d['occurred_at'] as string) ?? cluster.startTime.toISOString(),
      owner_id: empId ?? null,
      metadata: { whatsapp_import: true, chat_profile: cluster.profile },
    })
    .select('id')
    .single();

  if (actError || !actData) {
    console.warn('[autoInsertActivity] Insert failed:', actError?.message);
    return;
  }

  // Link to project or lead
  const assocInserts = [];
  if (record.project_match.project_id) {
    assocInserts.push({
      activity_id: actData.id,
      entity_type: 'project',
      entity_id: record.project_match.project_id,
    });
  }
  if (record.project_match.lead_id) {
    assocInserts.push({
      activity_id: actData.id,
      entity_type: 'lead',
      entity_id: record.project_match.lead_id,
    });
  }
  if (assocInserts.length > 0) {
    await supabase.from('activity_associations').insert(assocInserts);
  }

  await supabase
    .from('whatsapp_import_queue')
    .update({ review_status: 'auto_inserted', inserted_table: 'activities', inserted_id: actData.id })
    .eq('id', queueId);
}

async function autoInsertTask(
  record: ExtractedRecord,
  cluster: MessageCluster,
  queueId: string
): Promise<void> {
  const d = record.data as Record<string, unknown>;
  const empId = getEmployeeId(cluster.sender);
  if (!d['title']) return;

  const entityType = (d['entity_type'] as string) ?? 'project';
  const entityId = record.project_match.project_id ?? record.project_match.lead_id;

  const { data: taskData, error } = await supabase
    .from('tasks')
    .insert({
      entity_type: entityType,
      entity_id: entityId ?? null,
      project_id: record.project_match.project_id ?? null,
      title: d['title'] as string,
      description: (d['notes'] as string) ?? null,
      created_by: empId ?? null,
      assigned_to: empId ?? null,
      priority: 'medium',
      due_date: (d['due_date'] as string) ?? null,
    })
    .select('id')
    .single();

  if (error || !taskData) {
    console.warn('[autoInsertTask] Insert failed:', error?.message);
    return;
  }

  await supabase
    .from('whatsapp_import_queue')
    .update({ review_status: 'auto_inserted', inserted_table: 'tasks', inserted_id: taskData.id })
    .eq('id', queueId);
}

export async function routeResults(
  results: ClusterExtractionResult[],
  clusters: MessageCluster[]
): Promise<void> {
  const op = '[routeResults]';
  await resolveEmployeeIds();

  let queued = 0, autoInserted = 0, skipped = 0;

  for (let i = 0; i < results.length; i++) {
    const result = results[i]!;
    const cluster = clusters[i] ?? clusters[clusters.length - 1]!;

    for (const record of result.records) {
      if (record.extraction_type === 'unknown') { skipped++; continue; }

      const msgHash = cluster.messages[0]
        ? hashMessage(cluster.messages[0]) + '_' + record.extraction_type
        : result.cluster_id + '_' + record.extraction_type;

      const queueId = await insertQueueRecord(cluster, record, msgHash);
      if (!queueId) { skipped++; continue; }

      // Auto-insert if high confidence and NOT financial
      const canAutoInsert =
        record.confidence >= AUTO_INSERT_THRESHOLD &&
        !record.requires_finance_review &&
        record.project_match.confidence >= 0.75;

      if (canAutoInsert) {
        switch (record.extraction_type) {
          case 'activity':
            await autoInsertActivity(record, cluster, queueId);
            autoInserted++;
            break;
          case 'task':
            await autoInsertTask(record, cluster, queueId);
            autoInserted++;
            break;
          default:
            queued++;
        }
      } else {
        queued++;
      }
    }
  }

  console.log(`${op} Done. Queued: ${queued}, Auto-inserted: ${autoInserted}, Skipped: ${skipped}`);
}
```

- [ ] **Step 2: Commit**

```bash
git add scripts/whatsapp-import/router.ts
git commit -m "feat: whatsapp import — router writes to queue + auto-inserts activities/tasks"
```

---

## Task 7: Media upload helper

**Files:**
- Create: `scripts/whatsapp-import/media.ts`

- [ ] **Step 1: Create `scripts/whatsapp-import/media.ts`**

```typescript
// scripts/whatsapp-import/media.ts
// Reads media files from the extracted ZIP buffer and uploads to Supabase Storage.

import sharp from 'sharp';
import AdmZip from 'adm-zip';
import { supabase } from './db.js';

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif']);
const MAX_SIZE_BYTES = 8 * 1024 * 1024; // 8MB after resize

export function isImage(filename: string): boolean {
  const ext = filename.toLowerCase().slice(filename.lastIndexOf('.'));
  return IMAGE_EXTS.has(ext);
}

export async function uploadMediaFromZip(
  zip: AdmZip,
  filename: string,
  projectId: string,
  reportDate: string   // YYYY-MM-DD
): Promise<string | null> {
  const op = '[uploadMediaFromZip]';

  const entry = zip.getEntry(filename);
  if (!entry) {
    console.warn(`${op} File not found in ZIP: ${filename}`);
    return null;
  }

  const buffer = entry.getData();
  let processedBuffer: Buffer = buffer;
  let mimeType = 'image/jpeg';

  try {
    // Resize to max 2400px width, convert to JPEG for storage efficiency
    processedBuffer = await sharp(buffer)
      .resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
    mimeType = 'image/jpeg';
  } catch {
    // If sharp fails (e.g. video thumbnail), skip
    console.warn(`${op} Sharp processing failed for ${filename}, using original`);
    if (processedBuffer.length > MAX_SIZE_BYTES) return null;
  }

  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const timestamp = Date.now();
  const storagePath = `projects/${projectId}/whatsapp/${reportDate}/${timestamp}_${safeName}`;

  const { error } = await supabase.storage
    .from('site-photos')
    .upload(storagePath, processedBuffer, {
      contentType: mimeType,
      upsert: false,
    });

  if (error) {
    if (error.message.includes('already exists')) return storagePath;
    console.error(`${op} Upload failed for ${filename}:`, error.message);
    return null;
  }

  return storagePath;
}

export async function uploadPaymentPhotoFromZip(
  zip: AdmZip,
  filename: string,
  projectId: string,
  date: string
): Promise<string | null> {
  const op = '[uploadPaymentPhotoFromZip]';
  const entry = zip.getEntry(filename);
  if (!entry) return null;

  const buffer = entry.getData();
  let processedBuffer: Buffer = buffer;

  try {
    processedBuffer = await sharp(buffer)
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
  } catch {
    if (buffer.length > MAX_SIZE_BYTES) return null;
  }

  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storagePath = `${projectId}/payments/${date}_${safeName}`;

  const { error } = await supabase.storage
    .from('project-files')
    .upload(storagePath, processedBuffer, {
      contentType: 'image/jpeg',
      upsert: false,
    });

  if (error) {
    if (error.message.includes('already exists')) return storagePath;
    console.error(`${op} Upload failed:`, error.message);
    return null;
  }
  return storagePath;
}
```

- [ ] **Step 2: Commit**

```bash
git add scripts/whatsapp-import/media.ts
git commit -m "feat: whatsapp import — media upload with sharp resize"
```

---

## Task 8: Main CLI entry point

**Files:**
- Create: `scripts/whatsapp-import/run.ts`

- [ ] **Step 1: Create `scripts/whatsapp-import/run.ts`**

```typescript
// scripts/whatsapp-import/run.ts
// CLI: node run.ts --chat marketing --zip "/path/to/export.zip"

import AdmZip from 'adm-zip';
import * as path from 'node:path';
import { parseChat } from './parser.js';
import { extractClusters } from './extractor.js';
import { routeResults } from './router.js';
import { loadExistingHashes, isAlreadyImported, hashMessage } from './dedup.js';
import { getAllProjects, getAllLeads } from './db.js';
import type { ChatProfile } from './types.js';

function parseArgs(): { chat: ChatProfile; zip: string } {
  const args = process.argv.slice(2);
  const chatIdx = args.indexOf('--chat');
  const zipIdx = args.indexOf('--zip');

  if (chatIdx === -1 || zipIdx === -1) {
    console.error('Usage: npx tsx run.ts --chat <marketing|llp|site> --zip <path-to-zip>');
    process.exit(1);
  }

  const chat = args[chatIdx + 1] as ChatProfile;
  const zipPath = args[zipIdx + 1] ?? '';

  if (!['marketing', 'llp', 'site'].includes(chat)) {
    console.error(`Invalid chat profile: ${chat}. Must be one of: marketing, llp, site`);
    process.exit(1);
  }

  return { chat, zip: zipPath };
}

async function main() {
  const op = '[WhatsApp Import]';
  const { chat, zip: zipPath } = parseArgs();

  console.log(`${op} Starting import: profile=${chat}, zip=${path.basename(zipPath)}`);

  // Load ZIP
  let zipFile: AdmZip;
  try {
    zipFile = new AdmZip(zipPath);
  } catch (err) {
    console.error(`${op} Failed to open ZIP file: ${zipPath}`, err);
    process.exit(1);
  }

  // Extract chat text
  const txtEntry = zipFile.getEntries().find(e => e.name === '_chat.txt');
  if (!txtEntry) {
    console.error(`${op} No _chat.txt found in ZIP. Is this a WhatsApp export?`);
    process.exit(1);
  }

  const chatText = txtEntry.getData().toString('utf8');
  console.log(`${op} Read ${chatText.length} characters from _chat.txt`);

  // Parse into clusters
  const clusters = parseChat(chatText, chat);
  console.log(`${op} Parsed ${clusters.length} message clusters`);

  // Load dedup hashes
  await loadExistingHashes();

  // Filter out already-imported clusters
  const newClusters = clusters.filter(c => {
    if (!c.messages[0]) return false;
    const hash = hashMessage(c.messages[0]) + '_first';
    return !isAlreadyImported(hash);
  });
  console.log(`${op} ${newClusters.length} new clusters (${clusters.length - newClusters.length} already imported)`);

  if (newClusters.length === 0) {
    console.log(`${op} Nothing new to import. Done.`);
    return;
  }

  // Load project/lead data for fuzzy matching
  const [projects, leads] = await Promise.all([getAllProjects(), getAllLeads()]);
  console.log(`${op} Loaded ${projects.length} projects + ${leads.length} leads for matching`);

  // Extract via Claude API
  const results = await extractClusters(newClusters, projects, leads, chat);

  // Route to DB
  await routeResults(results, newClusters);

  console.log(`${op} Import complete.`);
}

main().catch(err => {
  console.error('[WhatsApp Import] Fatal error:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Commit**

```bash
git add scripts/whatsapp-import/run.ts
git commit -m "feat: whatsapp import — CLI entry point (run.ts)"
```

---

## Task 9: ERP Review Queue — server queries + actions

**Files:**
- Create: `apps/erp/src/lib/whatsapp-import-queries.ts`
- Create: `apps/erp/src/lib/whatsapp-import-actions.ts`

- [ ] **Step 1: Create `apps/erp/src/lib/whatsapp-import-queries.ts`**

```typescript
// apps/erp/src/lib/whatsapp-import-queries.ts
import { createClient } from '@repo/supabase/server';

export type QueueItem = {
  id: string;
  chat_profile: string;
  message_timestamp: string;
  sender_name: string;
  raw_message_text: string | null;
  media_filenames: string[] | null;
  extraction_type: string;
  extracted_data: Record<string, unknown>;
  confidence_score: number | null;
  matched_project_id: string | null;
  matched_lead_id: string | null;
  matched_project_name: string | null;
  review_status: string;
  requires_finance_review: boolean;
  reviewed_at: string | null;
  review_notes: string | null;
  inserted_table: string | null;
  inserted_id: string | null;
  created_at: string;
};

export async function getQueueItems(filters: {
  status?: string;
  profile?: string;
  type?: string;
  page?: number;
  pageSize?: number;
}): Promise<{ items: QueueItem[]; total: number }> {
  const op = '[getQueueItems]';
  const supabase = await createClient();
  const { status = 'pending', profile, type, page = 1, pageSize = 50 } = filters;

  let query = supabase
    .from('whatsapp_import_queue')
    .select('*', { count: 'exact' })
    .eq('review_status', status)
    .order('message_timestamp', { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);

  if (profile) query = query.eq('chat_profile', profile);
  if (type) query = query.eq('extraction_type', type);

  const { data, error, count } = await query;

  if (error) {
    console.error(`${op} Query failed:`, { code: error.code, message: error.message });
    throw new Error(`Failed to fetch import queue: ${error.message}`);
  }

  return { items: (data ?? []) as QueueItem[], total: count ?? 0 };
}

export async function getQueueStats(): Promise<{
  pending: number;
  pending_finance: number;
  auto_inserted: number;
  rejected: number;
  by_type: Record<string, number>;
}> {
  const op = '[getQueueStats]';
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('whatsapp_import_queue')
    .select('review_status, extraction_type, requires_finance_review');

  if (error) {
    console.error(`${op} Query failed:`, error.message);
    throw new Error(`Failed to fetch queue stats: ${error.message}`);
  }

  const rows = data ?? [];
  const pending = rows.filter(r => r.review_status === 'pending').length;
  const pending_finance = rows.filter(r => r.review_status === 'pending' && r.requires_finance_review).length;
  const auto_inserted = rows.filter(r => r.review_status === 'auto_inserted').length;
  const rejected = rows.filter(r => r.review_status === 'rejected').length;

  const by_type: Record<string, number> = {};
  for (const r of rows.filter(x => x.review_status === 'pending')) {
    by_type[r.extraction_type] = (by_type[r.extraction_type] ?? 0) + 1;
  }

  return { pending, pending_finance, auto_inserted, rejected, by_type };
}
```

- [ ] **Step 2: Create `apps/erp/src/lib/whatsapp-import-actions.ts`**

```typescript
// apps/erp/src/lib/whatsapp-import-actions.ts
'use server';

import { createClient } from '@repo/supabase/server';
import { revalidatePath } from 'next/cache';

export async function approveQueueItem(
  id: string,
  overrideProjectId?: string
): Promise<{ success: boolean; error?: string }> {
  const op = '[approveQueueItem]';
  const supabase = await createClient();

  // Get the queue item
  const { data: item, error: fetchError } = await supabase
    .from('whatsapp_import_queue')
    .select('*')
    .eq('id', id)
    .single();

  if (fetchError || !item) {
    return { success: false, error: 'Queue item not found' };
  }

  const projectId = overrideProjectId ?? item.matched_project_id;
  const data = item.extracted_data as Record<string, unknown>;
  let insertedTable: string | null = null;
  let insertedId: string | null = null;

  try {
    switch (item.extraction_type) {
      case 'customer_payment': {
        if (!projectId || !data['amount']) {
          return { success: false, error: 'Missing project or amount for payment' };
        }
        const receiptNumber = `WA-APPROVED-${id.slice(0, 8).toUpperCase()}`;
        const { data: payData, error } = await supabase
          .from('customer_payments')
          .insert({
            project_id: projectId,
            recorded_by: item.reviewed_by ?? (await getCurrentUserId(supabase)),
            receipt_number: receiptNumber,
            amount: data['amount'],
            payment_date: (data['payment_date'] as string) ?? item.message_timestamp.slice(0, 10),
            payment_method: (data['payment_method'] as string) ?? 'bank_transfer',
            payment_reference: (data['payment_reference'] as string) ?? null,
            is_advance: (data['is_advance'] as boolean) ?? false,
            notes: `Approved from WhatsApp import (${item.chat_profile}). ${data['notes'] ?? ''}`.trim(),
          })
          .select('id')
          .single();
        if (error) throw new Error(error.message);
        insertedTable = 'customer_payments';
        insertedId = payData?.id ?? null;
        break;
      }

      case 'task': {
        const { data: taskData, error } = await supabase
          .from('tasks')
          .insert({
            entity_type: (data['entity_type'] as string) ?? 'project',
            entity_id: projectId ?? null,
            project_id: projectId ?? null,
            title: data['title'] as string,
            description: (data['notes'] as string) ?? null,
            priority: 'medium',
            due_date: (data['due_date'] as string) ?? null,
          })
          .select('id')
          .single();
        if (error) throw new Error(error.message);
        insertedTable = 'tasks';
        insertedId = taskData?.id ?? null;
        break;
      }

      case 'activity': {
        const userId = await getCurrentUserId(supabase);
        const { data: actData, error: actError } = await supabase
          .from('activities')
          .insert({
            activity_type: (data['activity_type'] as string) ?? 'note',
            title: (data['title'] as string) ?? null,
            body: (data['body'] as string) ?? item.raw_message_text,
            occurred_at: (data['occurred_at'] as string) ?? item.message_timestamp,
            owner_id: userId,
            metadata: { whatsapp_import: true, chat_profile: item.chat_profile, approved: true },
          })
          .select('id')
          .single();
        if (actError || !actData) throw new Error(actError?.message ?? 'Insert failed');

        if (projectId) {
          await supabase.from('activity_associations').insert({
            activity_id: actData.id,
            entity_type: 'project',
            entity_id: projectId,
          });
        }
        if (item.matched_lead_id) {
          await supabase.from('activity_associations').insert({
            activity_id: actData.id,
            entity_type: 'lead',
            entity_id: item.matched_lead_id,
          });
        }
        insertedTable = 'activities';
        insertedId = actData.id;
        break;
      }

      case 'purchase_order':
      case 'vendor_payment':
      case 'boq_item':
        // Finance review items — just mark approved in queue for now
        // Full auto-insert requires more context (vendor_id, etc.)
        insertedTable = null;
        break;
    }

    // Update queue record
    const userId = await getCurrentUserId(supabase);
    const { error: updateError } = await supabase
      .from('whatsapp_import_queue')
      .update({
        review_status: 'approved',
        reviewed_by: userId,
        reviewed_at: new Date().toISOString(),
        matched_project_id: projectId,
        inserted_table: insertedTable,
        inserted_id: insertedId,
      })
      .eq('id', id);

    if (updateError) throw new Error(updateError.message);
  } catch (err) {
    console.error(`${op} Failed:`, err);
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }

  revalidatePath('/whatsapp-import');
  return { success: true };
}

export async function rejectQueueItem(
  id: string,
  notes?: string
): Promise<{ success: boolean; error?: string }> {
  const op = '[rejectQueueItem]';
  const supabase = await createClient();
  const userId = await getCurrentUserId(supabase);

  const { error } = await supabase
    .from('whatsapp_import_queue')
    .update({
      review_status: 'rejected',
      reviewed_by: userId,
      reviewed_at: new Date().toISOString(),
      review_notes: notes ?? null,
    })
    .eq('id', id);

  if (error) {
    console.error(`${op} Failed:`, error.message);
    return { success: false, error: error.message };
  }

  revalidatePath('/whatsapp-import');
  return { success: true };
}

export async function reassignProject(
  id: string,
  newProjectId: string
): Promise<{ success: boolean; error?: string }> {
  const op = '[reassignProject]';
  const supabase = await createClient();

  const { error } = await supabase
    .from('whatsapp_import_queue')
    .update({ matched_project_id: newProjectId })
    .eq('id', id);

  if (error) {
    console.error(`${op} Failed:`, error.message);
    return { success: false, error: error.message };
  }

  revalidatePath('/whatsapp-import');
  return { success: true };
}

async function getCurrentUserId(supabase: Awaited<ReturnType<typeof import('@repo/supabase/server').createClient>>): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  return user.id;
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/erp/src/lib/whatsapp-import-queries.ts apps/erp/src/lib/whatsapp-import-actions.ts
git commit -m "feat: whatsapp import — server queries + approve/reject/reassign actions"
```

---

## Task 10: ERP Review Queue UI

**Files:**
- Create: `apps/erp/src/app/(app)/whatsapp-import/page.tsx`
- Create: `apps/erp/src/app/(app)/whatsapp-import/[id]/page.tsx`

- [ ] **Step 1: Create queue list page `apps/erp/src/app/(app)/whatsapp-import/page.tsx`**

```tsx
// apps/erp/src/app/(app)/whatsapp-import/page.tsx
import { Suspense } from 'react';
import { getQueueItems, getQueueStats } from '@/lib/whatsapp-import-queries';
import { Badge } from '@repo/ui/badge';
import { Skeleton } from '@repo/ui/skeleton';
import Link from 'next/link';

export const metadata = { title: 'WhatsApp Import Queue' };

const PROFILE_LABELS: Record<string, string> = {
  marketing: 'Marketing',
  llp: 'LLP / Purchase',
  site: 'Site Updates',
};

const TYPE_LABELS: Record<string, { label: string; variant: 'default' | 'destructive' | 'secondary' | 'outline' }> = {
  customer_payment: { label: 'Payment', variant: 'default' },
  vendor_payment:   { label: 'Vendor Pay', variant: 'destructive' },
  purchase_order:   { label: 'PO', variant: 'destructive' },
  boq_item:         { label: 'BOQ Item', variant: 'secondary' },
  task:             { label: 'Task', variant: 'outline' },
  activity:         { label: 'Activity', variant: 'outline' },
  contact:          { label: 'Contact', variant: 'outline' },
  site_photo:       { label: 'Photo', variant: 'secondary' },
  daily_report:     { label: 'Daily Report', variant: 'secondary' },
  unknown:          { label: 'Unknown', variant: 'outline' },
};

interface PageProps {
  searchParams: Promise<{ status?: string; profile?: string; type?: string; page?: string }>;
}

export default async function WhatsAppImportPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const status = params.status ?? 'pending';
  const profile = params.profile;
  const type = params.type;
  const page = Number(params.page ?? 1);

  const [{ items, total }, stats] = await Promise.all([
    getQueueItems({ status, profile, type, page, pageSize: 50 }),
    getQueueStats(),
  ]);

  const totalPages = Math.ceil(total / 50);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">WhatsApp Import Queue</h1>
        <p className="text-sm text-gray-500 mt-1">Review extracted records before they enter the database</p>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <StatCard label="Pending Review" value={stats.pending} highlight />
        <StatCard label="Finance Review" value={stats.pending_finance} highlight variant="destructive" />
        <StatCard label="Auto-Inserted" value={stats.auto_inserted} />
        <StatCard label="Rejected" value={stats.rejected} />
      </div>

      {/* Breakdown by type */}
      {Object.keys(stats.by_type).length > 0 && (
        <div className="flex flex-wrap gap-2 mb-6">
          {Object.entries(stats.by_type).map(([t, count]) => (
            <Link key={t} href={`/whatsapp-import?type=${t}`}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-gray-100 hover:bg-gray-200 text-gray-700">
              {TYPE_LABELS[t]?.label ?? t} <span className="font-bold">{count}</span>
            </Link>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3 mb-4 flex-wrap">
        {['pending', 'approved', 'auto_inserted', 'rejected'].map(s => (
          <Link key={s} href={`/whatsapp-import?status=${s}`}
            className={`px-3 py-1.5 text-sm rounded-md font-medium transition-colors ${
              status === s
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}>
            {s.replace('_', ' ')}
          </Link>
        ))}
        <div className="flex-1" />
        {['marketing', 'llp', 'site'].map(p => (
          <Link key={p} href={`/whatsapp-import?status=${status}&profile=${p}`}
            className={`px-3 py-1.5 text-sm rounded-md font-medium transition-colors ${
              profile === p
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}>
            {PROFILE_LABELS[p]}
          </Link>
        ))}
      </div>

      {/* Table */}
      <div className="border rounded-lg overflow-hidden bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left py-3 px-4 font-medium text-gray-600">Date</th>
              <th className="text-left py-3 px-4 font-medium text-gray-600">Sender</th>
              <th className="text-left py-3 px-4 font-medium text-gray-600">Type</th>
              <th className="text-left py-3 px-4 font-medium text-gray-600">Project Match</th>
              <th className="text-left py-3 px-4 font-medium text-gray-600">Confidence</th>
              <th className="text-left py-3 px-4 font-medium text-gray-600">Summary</th>
              <th className="text-left py-3 px-4 font-medium text-gray-600">Chat</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {items.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center py-12 text-gray-400">
                  No items in this queue
                </td>
              </tr>
            )}
            {items.map(item => {
              const typeInfo = TYPE_LABELS[item.extraction_type] ?? { label: item.extraction_type, variant: 'outline' as const };
              const conf = item.confidence_score ?? 0;
              const confColor = conf >= 0.85 ? 'text-green-600' : conf >= 0.60 ? 'text-yellow-600' : 'text-red-500';
              const summary = extractSummary(item.extracted_data, item.extraction_type);
              return (
                <tr key={item.id} className="hover:bg-gray-50">
                  <td className="py-3 px-4 text-gray-600 whitespace-nowrap">
                    {new Date(item.message_timestamp).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })}
                  </td>
                  <td className="py-3 px-4 text-gray-700">{item.sender_name}</td>
                  <td className="py-3 px-4">
                    <Badge variant={typeInfo.variant}>{typeInfo.label}</Badge>
                    {item.requires_finance_review && (
                      <Badge variant="destructive" className="ml-1 text-xs">₹</Badge>
                    )}
                  </td>
                  <td className="py-3 px-4 text-gray-700 max-w-[160px] truncate">
                    {item.matched_project_name ?? <span className="text-red-400 italic">unmatched</span>}
                  </td>
                  <td className={`py-3 px-4 font-mono font-medium ${confColor}`}>
                    {(conf * 100).toFixed(0)}%
                  </td>
                  <td className="py-3 px-4 text-gray-600 max-w-[200px] truncate">{summary}</td>
                  <td className="py-3 px-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-gray-400">{PROFILE_LABELS[item.chat_profile]}</span>
                      <Link href={`/whatsapp-import/${item.id}`}
                        className="text-blue-600 hover:text-blue-800 text-xs font-medium">
                        Review →
                      </Link>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center gap-2 mt-4">
          {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
            <Link key={p} href={`/whatsapp-import?status=${status}&page=${p}`}
              className={`px-3 py-1.5 text-sm rounded ${
                page === p ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'
              }`}>
              {p}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, highlight, variant }: { label: string; value: number; highlight?: boolean; variant?: string }) {
  return (
    <div className={`rounded-lg border p-4 ${highlight ? 'bg-white' : 'bg-gray-50'}`}>
      <div className={`text-2xl font-bold ${variant === 'destructive' ? 'text-red-600' : 'text-gray-900'}`}>{value}</div>
      <div className="text-xs text-gray-500 mt-0.5">{label}</div>
    </div>
  );
}

function extractSummary(data: Record<string, unknown>, type: string): string {
  switch (type) {
    case 'customer_payment':
    case 'vendor_payment':
      if (data['amount']) return `₹${Number(data['amount']).toLocaleString('en-IN')}`;
      return 'Payment';
    case 'task':
      return String(data['title'] ?? 'Task');
    case 'activity':
      return String(data['title'] ?? data['body'] ?? 'Activity').slice(0, 60);
    case 'purchase_order':
      return String(data['po_number'] ?? data['pdf_filename'] ?? 'PO');
    case 'boq_item':
      return String(data['item_description'] ?? 'BOQ item');
    case 'contact':
      return `${data['name'] ?? ''} ${data['phone'] ?? ''}`.trim();
    default:
      return JSON.stringify(data).slice(0, 60);
  }
}
```

- [ ] **Step 2: Create detail page `apps/erp/src/app/(app)/whatsapp-import/[id]/page.tsx`**

```tsx
// apps/erp/src/app/(app)/whatsapp-import/[id]/page.tsx
import { notFound } from 'next/navigation';
import { createClient } from '@repo/supabase/server';
import { approveQueueItem, rejectQueueItem } from '@/lib/whatsapp-import-actions';
import { Badge } from '@repo/ui/badge';
import Link from 'next/link';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function QueueItemDetailPage({ params }: PageProps) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: item } = await supabase
    .from('whatsapp_import_queue')
    .select('*')
    .eq('id', id)
    .single();

  if (!item) notFound();

  const data = item.extracted_data as Record<string, unknown>;
  const conf = item.confidence_score ?? 0;
  const confColor = conf >= 0.85 ? 'text-green-600' : conf >= 0.60 ? 'text-yellow-600' : 'text-red-500';

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-4">
        <Link href="/whatsapp-import" className="text-sm text-blue-600 hover:underline">← Back to queue</Link>
      </div>

      <div className="bg-white border rounded-lg p-6 space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">
              {item.extraction_type.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())}
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {new Date(item.message_timestamp).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} · {item.sender_name} · {item.chat_profile}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={item.review_status === 'pending' ? 'outline' : item.review_status === 'approved' ? 'default' : 'destructive'}>
              {item.review_status}
            </Badge>
            {item.requires_finance_review && <Badge variant="destructive">Finance Review Required</Badge>}
          </div>
        </div>

        {/* Raw message */}
        <div>
          <h2 className="text-sm font-medium text-gray-700 mb-2">Original Message</h2>
          <pre className="bg-gray-50 border rounded p-3 text-sm text-gray-600 whitespace-pre-wrap font-sans">
            {item.raw_message_text ?? '(no text)'}
          </pre>
          {(item.media_filenames?.length ?? 0) > 0 && (
            <p className="text-xs text-gray-400 mt-1">
              Attachments: {item.media_filenames?.join(', ')}
            </p>
          )}
        </div>

        {/* Project match */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <h2 className="text-sm font-medium text-gray-700 mb-1">Project Match</h2>
            <p className="text-sm text-gray-900">
              {item.matched_project_name ?? <span className="text-red-400 italic">No match found</span>}
            </p>
          </div>
          <div>
            <h2 className="text-sm font-medium text-gray-700 mb-1">Confidence</h2>
            <p className={`text-sm font-mono font-bold ${confColor}`}>{(conf * 100).toFixed(1)}%</p>
          </div>
        </div>

        {/* Extracted data */}
        <div>
          <h2 className="text-sm font-medium text-gray-700 mb-2">Extracted Data</h2>
          <div className="bg-gray-50 border rounded p-3 space-y-2">
            {Object.entries(data).map(([key, value]) => (
              <div key={key} className="flex gap-3 text-sm">
                <span className="text-gray-500 font-medium min-w-[160px]">{key}:</span>
                <span className="text-gray-900">{JSON.stringify(value)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Actions */}
        {item.review_status === 'pending' && (
          <div className="flex gap-3 pt-2 border-t">
            <form action={async () => {
              'use server';
              await approveQueueItem(id);
            }}>
              <button type="submit"
                className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700">
                ✓ Approve & Insert
              </button>
            </form>
            <form action={async () => {
              'use server';
              await rejectQueueItem(id, 'Manually rejected');
            }}>
              <button type="submit"
                className="px-4 py-2 bg-red-50 border border-red-200 text-red-700 text-sm font-medium rounded-lg hover:bg-red-100">
                ✗ Reject
              </button>
            </form>
          </div>
        )}

        {item.review_status !== 'pending' && (
          <div className="pt-2 border-t text-sm text-gray-500">
            {item.review_status === 'auto_inserted' && `Auto-inserted into ${item.inserted_table}`}
            {item.review_status === 'approved' && `Approved · inserted into ${item.inserted_table ?? 'queue'}`}
            {item.review_status === 'rejected' && `Rejected · ${item.review_notes ?? ''}`}
            {item.reviewed_at && ` · ${new Date(item.reviewed_at).toLocaleString('en-IN')}`}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/erp/src/app/\(app\)/whatsapp-import/
git commit -m "feat: whatsapp import — review queue UI (list + detail pages)"
```

---

## Task 11: Add sidebar nav link + install script deps

**Files:**
- Modify: `apps/erp/src/components/sidebar/sidebar-nav-config.ts` (or equivalent nav config file)

- [ ] **Step 1: Find and update the sidebar nav config**

Search for the nav config file:
```bash
grep -r "whatsapp\|import\|procurement" apps/erp/src/components/sidebar/ --include="*.ts" --include="*.tsx" -l
grep -r "navItems\|sidebarLinks\|navigation" apps/erp/src/components/sidebar/ --include="*.ts" --include="*.tsx" -l | head -5
```

Add a link to `/whatsapp-import` under the "Founder" or "Admin" section — visible only to `founder`, `finance`, `project_manager`, `purchase_officer` roles.

The exact insertion depends on the nav config structure found. Add:
```typescript
{
  href: '/whatsapp-import',
  label: 'WA Import Queue',
  icon: MessageSquare,  // or equivalent icon from lucide-react
  roles: ['founder', 'finance', 'project_manager', 'purchase_officer'],
}
```

- [ ] **Step 2: Install script dependencies**

```bash
cd scripts/whatsapp-import
npm install
```

- [ ] **Step 3: Verify ERP builds without errors**

```bash
cd apps/erp
npx tsc --noEmit
```

Expected: no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: whatsapp import — sidebar nav link, script deps"
```

---

## Task 12: Run the actual import — Marketing ZIP

- [ ] **Step 1: Set environment variables**

Create a `.env` file in `scripts/whatsapp-import/` (this file is gitignored):
```bash
cat > scripts/whatsapp-import/.env << 'EOF'
SUPABASE_URL=https://actqtzoxjilqnldnacqz.supabase.co
SUPABASE_SECRET_KEY=<paste SUPABASE_SECRET_KEY from .env.local>
ANTHROPIC_API_KEY=<paste ANTHROPIC_API_KEY from .env.local>
EOF
```

- [ ] **Step 2: Run the Marketing import**

```bash
cd scripts/whatsapp-import
npx dotenv-cli -e .env -- npx tsx run.ts \
  --chat marketing \
  --zip "C:/Users/vivek/OneDrive/Desktop/WhatsApp Chat - Shiroi Marketing.zip"
```

Expected output: parsing progress, Claude API calls, final count of queued/auto-inserted records.

- [ ] **Step 3: Verify records appear in queue**

Open https://erp.shiroienergy.com/whatsapp-import (or localhost:3000/whatsapp-import) and confirm records are visible with correct types and project matches.

- [ ] **Step 4: Commit progress log** (optional)

```bash
git commit --allow-empty -m "chore: marketing chat import run complete"
```

---

## Task 13: Run LLP import

- [ ] **Step 1: Run the LLP import**

```bash
cd scripts/whatsapp-import
npx dotenv-cli -e .env -- npx tsx run.ts \
  --chat llp \
  --zip "C:/Users/vivek/OneDrive/Desktop/WhatsApp Chat - Shiroi Energy LLP _ rooftop _ Purchase.zip"
```

- [ ] **Step 2: Spot-check extracted POs in queue**

In the ERP queue, filter by type=purchase_order. Verify that PO numbers like SESTR*, SEPANEL*, SEELE* are correctly extracted with vendor names and line items.

- [ ] **Step 3: Spot-check inflow payments**

Filter by type=customer_payment. Verify amounts and project matches look correct. Reject obvious noise records.

---

## Task 14: Update CLAUDE.md + master reference + push

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/SHIROI_MASTER_REFERENCE_3_0.md`

- [ ] **Step 1: Update CLAUDE.md current state table**

In the `## CURRENT STATE` table, add:

```markdown
| WhatsApp Import | ✅ Complete | scripts/whatsapp-import/ — ZIP parser, Claude extraction, review queue UI at /whatsapp-import. Migrations 022-024 + 025 applied dev. Marketing + LLP chats imported. |
| Migration 025 | ✅ Applied (dev) | whatsapp_import_queue table — review queue for all extracted WA records |
```

Update current phase to reflect completion.

- [ ] **Step 2: Update master reference**

Add a section in `docs/SHIROI_MASTER_REFERENCE_3_0.md` under Data Imports covering the WhatsApp import pipeline architecture, chat profiles, confidence thresholds, and review queue.

- [ ] **Step 3: Commit all docs**

```bash
git add CLAUDE.md docs/SHIROI_MASTER_REFERENCE_3_0.md
git commit -m "docs: update CLAUDE.md + master reference with WhatsApp import pipeline"
```

- [ ] **Step 4: Push to main**

```bash
git push origin claude/mystifying-dirac
```

Then open a PR to main, or if Vivek approves direct merge:
```bash
git checkout main
git merge claude/mystifying-dirac
git push origin main
```

Vercel auto-deploys on push to main. Confirm deployment at https://erp.shiroienergy.com.

---

## Verification Checklist

- [ ] `npx tsc --noEmit` in `apps/erp` — zero errors
- [ ] `scripts/whatsapp-import` parses both ZIPs without crashing
- [ ] Marketing import: 7771 lines → clusters → records visible in /whatsapp-import queue
- [ ] LLP import: 3848 lines → POs, BOQ items, inflow payments in queue
- [ ] Queue page loads at /whatsapp-import with stats, filter tabs, and table
- [ ] Approve action on a task record → task appears in /tasks
- [ ] Approve action on a payment → customer_payments record created
- [ ] Reject action marks record as rejected with note
- [ ] Re-running import doesn't create duplicate queue records (dedup by hash)
- [ ] Vercel deployment succeeds

---

## Phase 2 (Baileys live integration) — scaffold only in this plan

The `scripts/whatsapp-import/profiles/` folder and `extractor.ts` are designed to accept any cluster regardless of source. The Baileys service will be a separate Node.js process that:
1. Connects with bot phone number using `@whiskeysockets/baileys`
2. Listens for incoming messages in the group
3. Formats each message as a `MessageCluster` and calls the same `extractClusters()` + `routeResults()` pipeline
4. Runs as a background process on the spare laptop alongside n8n

This is NOT implemented in this plan — it is deferred to Phase 2.
