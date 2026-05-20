/**
 * Walk every PDF in scripts/data/proposal-samples and extract text via
 * pdf-parse so we can analyse the common section structure across years.
 *
 * Output: scripts/data/proposal-samples/_analysis.json
 *         scripts/data/proposal-samples/_summary.md
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { PDFParse } from 'pdf-parse';

interface FileAnalysis {
  path: string;
  year: string;
  name: string;
  pages: number;
  text_chars: number;
  detected_sections: string[];
  has_bom_table: boolean;
  has_payment_terms: boolean;
  has_savings: boolean;
  has_warranty: boolean;
  has_signature: boolean;
  likely_design_drawing: boolean;
  first_500_chars: string;
  section_headings: string[];
  amount_mentions: string[];
}

const SECTION_KEYWORDS: Record<string, RegExp> = {
  cover: /\b(proposal|quotation|estimate|offer)\b/i,
  about: /\b(about (us|shiroi)|company profile|introduction|who we are)\b/i,
  system_design: /\b(system design|technical specification|scope of work|project details)\b/i,
  bom: /\b(bill of materials?|BOM|materials? list|components|specifications)\b/i,
  savings: /\b(savings|generation|payback|ROI|return on investment|annual generation)\b/i,
  pricing: /\b(price summary|investment|cost summary|total|grand total)\b/i,
  payment: /\b(payment (terms|schedule|milestone)|installments?|booking advance)\b/i,
  warranty: /\b(warranty|guarantee|after sales|service|maintenance)\b/i,
  scope_exclusion: /\b(scope of work|inclusions?|exclusions?|out of scope)\b/i,
  signature: /\b(authorised signatory|accepted|signature|stamp|for (and on behalf|shiroi))\b/i,
  contact: /\b(contact us|reach us|address|email|phone|whatsapp)\b/i,
};

const DESIGN_DRAWING_HINTS = /\b(layout|panel layout|terrace|cad|drawing|section detail|elevation)\b/i;

function classify(text: string, name: string): FileAnalysis['detected_sections'] {
  const sections: string[] = [];
  for (const [k, re] of Object.entries(SECTION_KEYWORDS)) {
    if (re.test(text)) sections.push(k);
  }
  return sections;
}

function extractSectionHeadings(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const headings: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    // Heuristic: short ALL-CAPS lines or lines that look like section titles
    if (trimmed.length === 0 || trimmed.length > 80) continue;
    const isMostlyCaps = /^[A-Z][A-Z\s&,\-\.()0-9]{4,}$/.test(trimmed);
    const isTitleCase =
      /^([A-Z][a-z]+(\s+(?:[A-Z][a-z]+|of|and|to|the|&|for|in|with))*)$/.test(trimmed) && trimmed.length > 8;
    if (isMostlyCaps || isTitleCase) {
      headings.push(trimmed);
    }
  }
  // Dedup while preserving order
  const seen = new Set<string>();
  return headings.filter((h) => {
    if (seen.has(h)) return false;
    seen.add(h);
    return true;
  });
}

function extractAmountMentions(text: string): string[] {
  const matches = text.match(/(?:Rs\.?|₹|INR)\s*[\d,]+(?:\.\d{1,2})?(?:\s*(?:lakhs?|crores?|cr|L|lakh))?/gi);
  return (matches ?? []).slice(0, 10);
}

function findPdfs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = path.join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) {
      out.push(...findPdfs(p));
    } else if (p.toLowerCase().endsWith('.pdf')) {
      out.push(p);
    }
  }
  return out;
}

async function analyzePdf(p: string): Promise<FileAnalysis> {
  const buf = readFileSync(p);
  let pages = 0;
  let text = '';
  const parser = new PDFParse({ data: buf });
  try {
    const result: any = await parser.getText();
    pages = result.total ?? result.numpages ?? 0;
    text = result.text ?? '';
  } catch (e: any) {
    return {
      path: p,
      year: path.basename(path.dirname(p)),
      name: path.basename(p),
      pages: 0,
      text_chars: 0,
      detected_sections: [],
      has_bom_table: false,
      has_payment_terms: false,
      has_savings: false,
      has_warranty: false,
      has_signature: false,
      likely_design_drawing: false,
      first_500_chars: `ERROR: ${e?.message ?? 'parse failed'}`,
      section_headings: [],
      amount_mentions: [],
    };
  }

  const sections = classify(text, path.basename(p));
  return {
    path: p,
    year: path.basename(path.dirname(p)),
    name: path.basename(p),
    pages,
    text_chars: text.length,
    detected_sections: sections,
    has_bom_table: sections.includes('bom'),
    has_payment_terms: sections.includes('payment'),
    has_savings: sections.includes('savings'),
    has_warranty: sections.includes('warranty'),
    has_signature: sections.includes('signature'),
    likely_design_drawing:
      DESIGN_DRAWING_HINTS.test(path.basename(p)) || (text.length < 1500 && pages <= 3 && sections.length <= 1),
    first_500_chars: text.replace(/\s+/g, ' ').slice(0, 500),
    section_headings: extractSectionHeadings(text).slice(0, 25),
    amount_mentions: extractAmountMentions(text),
  };
}

async function main() {
  const baseDir = path.join('scripts', 'data', 'proposal-samples');
  const pdfs = findPdfs(baseDir);
  console.log(`Analyzing ${pdfs.length} PDFs...`);

  const analyses: FileAnalysis[] = [];
  for (const p of pdfs) {
    const a = await analyzePdf(p);
    analyses.push(a);
    const tag = a.likely_design_drawing ? '[DRAWING]' : '[PROPOSAL?]';
    console.log(`  ${tag} ${a.pages}pp ${a.text_chars}ch ${a.detected_sections.join(',')} — ${a.name}`);
  }

  writeFileSync(path.join(baseDir, '_analysis.json'), JSON.stringify(analyses, null, 2), 'utf-8');

  // Generate a markdown summary
  const summary: string[] = ['# Proposal samples — structural analysis', ''];
  summary.push(`Sample size: **${pdfs.length}** PDFs across 2022–2025/26 folders.`);
  summary.push('');

  const proposalDocs = analyses.filter((a) => !a.likely_design_drawing);
  const drawings = analyses.filter((a) => a.likely_design_drawing);
  summary.push(`Of these, **${proposalDocs.length}** look like proposals, **${drawings.length}** look like design drawings/layouts.`);
  summary.push('');

  summary.push('## Section presence across proposals');
  summary.push('');
  summary.push('| Section | Count | % |');
  summary.push('|---|---|---|');
  const allSections = ['cover', 'about', 'system_design', 'bom', 'savings', 'pricing', 'payment', 'warranty', 'scope_exclusion', 'signature', 'contact'];
  for (const sec of allSections) {
    const n = proposalDocs.filter((a) => a.detected_sections.includes(sec)).length;
    const pct = proposalDocs.length > 0 ? Math.round((n / proposalDocs.length) * 100) : 0;
    summary.push(`| ${sec} | ${n}/${proposalDocs.length} | ${pct}% |`);
  }
  summary.push('');

  summary.push('## Page count distribution');
  const pageCounts = proposalDocs.map((a) => a.pages);
  pageCounts.sort((a, b) => a - b);
  const min = pageCounts[0] ?? 0;
  const max = pageCounts[pageCounts.length - 1] ?? 0;
  const median = pageCounts[Math.floor(pageCounts.length / 2)] ?? 0;
  summary.push(`Min: ${min} · Median: ${median} · Max: ${max}`);
  summary.push('');

  summary.push('## Each proposal — section headings extracted');
  summary.push('');
  for (const a of proposalDocs.sort((x, y) => (x.year > y.year ? -1 : 1))) {
    summary.push(`### ${a.name} (${a.year}, ${a.pages}pp)`);
    summary.push(`Sections detected: ${a.detected_sections.join(', ')}`);
    if (a.section_headings.length > 0) {
      summary.push('');
      summary.push('Headings:');
      for (const h of a.section_headings) summary.push(`- ${h}`);
    }
    if (a.amount_mentions.length > 0) {
      summary.push('');
      summary.push(`Money mentions: ${a.amount_mentions.slice(0, 5).join(' · ')}`);
    }
    summary.push('');
    summary.push('First 500 chars:');
    summary.push('```');
    summary.push(a.first_500_chars);
    summary.push('```');
    summary.push('');
  }

  writeFileSync(path.join(baseDir, '_summary.md'), summary.join('\n'), 'utf-8');
  console.log(`\nWrote ${baseDir}/_analysis.json and _summary.md`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
