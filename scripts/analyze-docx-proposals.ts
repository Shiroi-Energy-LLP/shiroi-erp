/**
 * Walk every .docx in scripts/data/proposal-samples/docx and extract text + HTML
 * via mammoth so we can analyse the commercial proposal structure across years.
 *
 * Output: scripts/data/proposal-samples/docx/_analysis.json
 *         scripts/data/proposal-samples/docx/_summary.md
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import mammoth from 'mammoth';

interface DocxAnalysis {
  path: string;
  year: string;
  name: string;
  text_chars: number;
  html_chars: number;
  table_count: number;
  image_count: number;
  detected_sections: string[];
  has_bom_table: boolean;
  has_payment_terms: boolean;
  has_savings: boolean;
  has_warranty: boolean;
  has_signature: boolean;
  has_pricing: boolean;
  has_scope: boolean;
  first_1000_chars: string;
  paragraph_count: number;
  heading_lines: string[];
  amount_mentions: string[];
}

const SECTION_KEYWORDS: Record<string, RegExp> = {
  cover: /\b(proposal for|quotation|estimate|offer|technical (and )?commercial proposal)\b/i,
  about: /\b(about (us|shiroi)|company profile|introduction|who we are|company overview)\b/i,
  system_design: /\b(system design|technical specifications?|scope of work|project details|system details)\b/i,
  bom: /\b(bill of materials?|BOM\b|material list|components used|specifications? of components?|major equipment)\b/i,
  savings: /\b(savings|generation|payback|ROI|return on investment|annual generation|year(ly)? generation)\b/i,
  pricing: /\b(price summary|investment|cost summary|total (project )?value|grand total|net amount|tax invoice|all inclusive)\b/i,
  payment: /\b(payment (terms|schedule|milestone)|installments?|booking advance|advance amount|terms of payment)\b/i,
  warranty: /\b(warranty|guarantee|after sales|service|maintenance|amc)\b/i,
  scope_exclusion: /\b(scope (of work|inclusions?)|inclusions? and exclusions?|exclusions?|out of scope|not in (our )?scope)\b/i,
  signature: /\b(authoris(ed|ed) signator|accepted (and )?signed|signature|stamp|kind acceptance|for (and on behalf|shiroi))\b/i,
  contact: /\b(contact us|reach us|address|email|phone|whatsapp|gst|gstin|llpin|pan)\b/i,
};

function classify(text: string): string[] {
  const sections: string[] = [];
  for (const [k, re] of Object.entries(SECTION_KEYWORDS)) {
    if (re.test(text)) sections.push(k);
  }
  return sections;
}

function extractHeadingLines(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const headings: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.length > 90) continue;
    const isMostlyCaps = /^[A-Z][A-Z\s&,\-\.()0-9\/]{4,}$/.test(trimmed);
    const startsWithNumber = /^\d+\.\s+[A-Z]/.test(trimmed);
    const isShortTitleCase =
      /^(([A-Z][a-z]+|of|and|to|the|for|in|with|&)\s*){2,7}$/.test(trimmed) && trimmed.length > 6 && trimmed.length < 60;
    if (isMostlyCaps || startsWithNumber || isShortTitleCase) {
      headings.push(trimmed);
    }
  }
  const seen = new Set<string>();
  return headings.filter((h) => {
    if (seen.has(h)) return false;
    seen.add(h);
    return true;
  });
}

function extractAmountMentions(text: string): string[] {
  const matches = text.match(/(?:Rs\.?|₹|INR)\s*[\d,]+(?:\.\d{1,2})?(?:\s*(?:lakhs?|crores?|cr|L|lakh|Lakhs|Lacs))?/gi);
  return Array.from(new Set(matches ?? [])).slice(0, 12);
}

function findDocxs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = path.join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...findDocxs(p));
    else if (p.toLowerCase().endsWith('.docx')) out.push(p);
  }
  return out;
}

async function analyzeDocx(p: string): Promise<DocxAnalysis> {
  const buffer = readFileSync(p);
  let text = '';
  let html = '';
  let imageCount = 0;

  try {
    const textRes = await mammoth.extractRawText({ buffer });
    text = textRes.value;
  } catch (e: any) {
    return baseFailure(p, `extractRawText: ${e?.message}`);
  }

  try {
    const htmlRes = await mammoth.convertToHtml({
      buffer,
      // count images instead of inlining base64 (we just want stats)
      convertImage: mammoth.images.imgElement(async () => {
        imageCount++;
        return { src: '' };
      }),
    });
    html = htmlRes.value;
  } catch (e: any) {
    // text-only fallback is fine
  }

  const tableCount = (html.match(/<table[\s>]/gi) ?? []).length;
  const sections = classify(text);
  const headings = extractHeadingLines(text).slice(0, 30);

  return {
    path: p,
    year: path.basename(path.dirname(p)),
    name: path.basename(p),
    text_chars: text.length,
    html_chars: html.length,
    table_count: tableCount,
    image_count: imageCount,
    detected_sections: sections,
    has_bom_table: sections.includes('bom'),
    has_payment_terms: sections.includes('payment'),
    has_savings: sections.includes('savings'),
    has_warranty: sections.includes('warranty'),
    has_signature: sections.includes('signature'),
    has_pricing: sections.includes('pricing'),
    has_scope: sections.includes('scope_exclusion'),
    first_1000_chars: text.replace(/\s+/g, ' ').slice(0, 1000),
    paragraph_count: text.split(/\n\s*\n/).length,
    heading_lines: headings,
    amount_mentions: extractAmountMentions(text),
  };
}

function baseFailure(p: string, msg: string): DocxAnalysis {
  return {
    path: p,
    year: path.basename(path.dirname(p)),
    name: path.basename(p),
    text_chars: 0,
    html_chars: 0,
    table_count: 0,
    image_count: 0,
    detected_sections: [],
    has_bom_table: false,
    has_payment_terms: false,
    has_savings: false,
    has_warranty: false,
    has_signature: false,
    has_pricing: false,
    has_scope: false,
    first_1000_chars: `ERROR: ${msg}`,
    paragraph_count: 0,
    heading_lines: [],
    amount_mentions: [],
  };
}

async function main() {
  const baseDir = path.join('scripts', 'data', 'proposal-samples', 'docx');
  const docxs = findDocxs(baseDir);
  console.log(`Analyzing ${docxs.length} .docx files...`);

  const analyses: DocxAnalysis[] = [];
  for (const p of docxs) {
    const a = await analyzeDocx(p);
    analyses.push(a);
    console.log(`  ${a.text_chars}ch ${a.table_count}tab ${a.image_count}img [${a.detected_sections.join(',')}] — ${a.name}`);
  }

  writeFileSync(path.join(baseDir, '_analysis.json'), JSON.stringify(analyses, null, 2), 'utf-8');

  const summary: string[] = ['# Commercial proposal samples — structural analysis', ''];
  summary.push(`Sample size: **${docxs.length}** .docx files across 2022–2025/26 folders.`);
  summary.push('');
  summary.push('## Section presence');
  summary.push('');
  summary.push('| Section | Count | % |');
  summary.push('|---|---|---|');
  const allSections = ['cover', 'about', 'system_design', 'bom', 'savings', 'pricing', 'payment', 'warranty', 'scope_exclusion', 'signature', 'contact'];
  for (const sec of allSections) {
    const n = analyses.filter((a) => a.detected_sections.includes(sec)).length;
    const pct = analyses.length > 0 ? Math.round((n / analyses.length) * 100) : 0;
    summary.push(`| ${sec} | ${n}/${analyses.length} | ${pct}% |`);
  }
  summary.push('');
  summary.push('## Document size distribution');
  const chars = analyses.map((a) => a.text_chars).filter((c) => c > 0).sort((a, b) => a - b);
  const tables = analyses.map((a) => a.table_count).sort((a, b) => a - b);
  summary.push(`Text chars  → min ${chars[0]} · median ${chars[Math.floor(chars.length / 2)]} · max ${chars[chars.length - 1]}`);
  summary.push(`Table count → min ${tables[0]} · median ${tables[Math.floor(tables.length / 2)]} · max ${tables[tables.length - 1]}`);
  summary.push('');
  summary.push('## Per-document detail');
  summary.push('');

  for (const a of analyses.sort((x, y) => (x.year > y.year ? -1 : 1))) {
    summary.push(`### ${a.name} — ${a.year}`);
    summary.push(`Text: ${a.text_chars} chars · Tables: ${a.table_count} · Images: ${a.image_count} · Paragraphs: ${a.paragraph_count}`);
    summary.push(`Sections: ${a.detected_sections.join(', ') || '(none)'}`);
    if (a.amount_mentions.length > 0) summary.push(`Money: ${a.amount_mentions.slice(0, 6).join(' · ')}`);
    if (a.heading_lines.length > 0) {
      summary.push('');
      summary.push('Heading-like lines:');
      for (const h of a.heading_lines) summary.push(`- ${h}`);
    }
    summary.push('');
    summary.push('First 1000 chars:');
    summary.push('```');
    summary.push(a.first_1000_chars);
    summary.push('```');
    summary.push('');
  }

  writeFileSync(path.join(baseDir, '_summary.md'), summary.join('\n'), 'utf-8');
  console.log(`\nWrote ${baseDir}/_analysis.json and _summary.md`);
}

main().catch((e) => { console.error(e); process.exit(1); });
