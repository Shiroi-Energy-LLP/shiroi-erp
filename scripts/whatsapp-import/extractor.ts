// scripts/whatsapp-import/extractor.ts
// Calls Claude API with batches of message clusters and returns structured extractions.

import Anthropic from '@anthropic-ai/sdk';
import type { MessageCluster, ClusterExtractionResult, ExtractedRecord, ExtractionType } from './types.js';
import type { ProjectRecord, LeadRecord } from './db.js';
import { fuzzyMatchProjects } from './fuzzy-match.js';
import { MARKETING_SYSTEM_PROMPT, MARKETING_USER_TEMPLATE } from './profiles/marketing.js';
import { LLP_SYSTEM_PROMPT, LLP_USER_TEMPLATE } from './profiles/llp.js';
import { SHIROI_ENERGY_SYSTEM_PROMPT, SHIROI_ENERGY_USER_TEMPLATE } from './profiles/shiroi_energy.js';
import { SITE_SYSTEM_PROMPT, SITE_USER_TEMPLATE } from './profiles/site.js';

const BATCH_SIZE = 12; // clusters per API call — keeps prompt size manageable
const FINANCIAL_TYPES: ExtractionType[] = ['customer_payment', 'vendor_payment', 'purchase_order'];

const client = new Anthropic({
  apiKey: process.env['ANTHROPIC_API_KEY'],
});

type UserTemplateFn = (clusterText: string, projectList: string, date: string) => string;

function getProfilePrompts(profile: string): { system: string; user: UserTemplateFn } {
  switch (profile) {
    case 'marketing':     return { system: MARKETING_SYSTEM_PROMPT,     user: MARKETING_USER_TEMPLATE };
    case 'llp':           return { system: LLP_SYSTEM_PROMPT,           user: LLP_USER_TEMPLATE };
    case 'shiroi_energy': return { system: SHIROI_ENERGY_SYSTEM_PROMPT, user: SHIROI_ENERGY_USER_TEMPLATE };
    case 'site':          return { system: SITE_SYSTEM_PROMPT,          user: SITE_USER_TEMPLATE };
    default: throw new Error(`Unknown profile: ${profile}`);
  }
}

function buildProjectList(projects: ProjectRecord[], leads: LeadRecord[]): string {
  const pLines = projects.slice(0, 300).map(p =>
    `PROJECT: ${p.customer_name} | ${p.project_number} | ${p.site_city ?? ''} | ${p.status}`
  );
  const lLines = leads.slice(0, 150).map(l =>
    `LEAD: ${l.name} | ${l.phone ?? ''} | ${l.city ?? ''} | ${l.status}`
  );
  return [...pLines, ...lLines].join('\n');
}

function formatCluster(cluster: MessageCluster): string {
  const ts = cluster.startTime.toISOString().slice(0, 16).replace('T', ' ');
  const mediaLine = cluster.mediaFiles.length
    ? `[MEDIA: ${cluster.mediaFiles.join(', ')}]`
    : '';
  const textPart = cluster.combinedText.trim();
  return `---\n[${ts}] ${cluster.sender}:\n${textPart}${mediaLine ? '\n' + mediaLine : ''}`.trim();
}

type LLMRecord = {
  type: string;
  project_name_mentioned: string | null;
  confidence: number;
  data: Record<string, unknown>;
};

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
  const jsonText = rawResponse
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  let parsed: LLMRecord[] = [];
  try {
    const result = JSON.parse(jsonText);
    parsed = Array.isArray(result) ? result : (result.records ?? []);
  } catch {
    console.warn(`${op} Failed to parse JSON response for batch of ${clusters.length} clusters`);
    console.warn(`${op} Raw response (first 500 chars): ${rawResponse.slice(0, 500)}`);
    return clusters.map(c => ({ cluster_id: c.id, records: [], raw_llm_response: rawResponse }));
  }

  // Map records back — Claude returns a flat array for the whole batch.
  // We distribute all records to cluster[0] of the batch (flat attribution is fine for queue).
  const results: ClusterExtractionResult[] = clusters.map(cluster => ({
    cluster_id: cluster.id,
    records: [],
    raw_llm_response: rawResponse,
  }));

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
      data: rawRecord.data ?? {},
      confidence: rawRecord.confidence ?? 0.5,
      requires_finance_review: FINANCIAL_TYPES.includes(rawRecord.type as ExtractionType),
    };

    // Assign to first cluster of the batch
    const firstResult = results[0];
    if (firstResult) firstResult.records.push(record);
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

  for (let i = 0; i < clusters.length; i += BATCH_SIZE) {
    const batch = clusters.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(clusters.length / BATCH_SIZE);
    console.log(`${op} Batch ${batchNum}/${totalBatches} (clusters ${i + 1}–${Math.min(i + BATCH_SIZE, clusters.length)})`);

    const batchResults = await extractBatch(batch, projects, leads, profile);
    results.push(...batchResults);

    // Polite rate-limit pause between batches
    if (i + BATCH_SIZE < clusters.length) {
      await new Promise(r => setTimeout(r, 600));
    }
  }

  const totalRecords = results.reduce((sum, r) => sum + r.records.length, 0);
  console.log(`${op} Done. ${results.length} clusters → ${totalRecords} extracted records`);
  return results;
}
