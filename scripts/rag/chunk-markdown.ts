/**
 * chunk-markdown.ts — Heading-aware markdown chunker for Shiroi RAG.
 *
 * Strategy (per the RAG design spec):
 *   1. Split at H2 (##) boundaries first
 *   2. If an H2 section is >maxTokens, recursively split at H3 (###)
 *   3. If a leaf section is still >maxTokens, hard-split with overlap
 *   4. Each chunk records its heading_path for retrieval context
 *
 * Usage:
 *   import { chunkMarkdown } from './chunk-markdown';
 *   const chunks = chunkMarkdown(fileContent, { maxTokens: 800, overlap: 100 });
 */

import { encodingForModel } from 'js-tiktoken';

export interface MarkdownChunk {
  content: string;
  heading_path: string[];
  chunk_index: number;
}

export interface ChunkOptions {
  /** Max tokens per chunk before hard-splitting. Default: 800 */
  maxTokens?: number;
  /** Token overlap between hard-split chunks. Default: 100 */
  overlap?: number;
}

// Shared encoder — cl100k_base covers gpt-4 / claude token counts closely enough
const getEncoder = (() => {
  let enc: ReturnType<typeof encodingForModel> | null = null;
  return () => {
    if (!enc) enc = encodingForModel('gpt-4');
    return enc;
  };
})();

function countTokens(text: string): number {
  return getEncoder().encode(text).length;
}

interface Section {
  level: 1 | 2 | 3;
  heading: string;
  content: string;
  heading_path: string[];
}

/** Split raw markdown text into H2-level sections. */
function splitByH2(markdown: string): Section[] {
  const lines = markdown.split('\n');
  const sections: Section[] = [];
  let current: Section | null = null;
  let h1Heading = '';

  for (const line of lines) {
    const h1Match = /^# (.+)/.exec(line);
    const h2Match = /^## (.+)/.exec(line);

    if (h1Match) {
      h1Heading = h1Match[1].trim();
      continue;
    }

    if (h2Match) {
      if (current) sections.push(current);
      current = {
        level: 2,
        heading: h2Match[1].trim(),
        content: '',
        heading_path: h1Heading ? [h1Heading, h2Match[1].trim()] : [h2Match[1].trim()],
      };
    } else {
      if (current) {
        current.content += line + '\n';
      } else {
        // Content before first H2 — treat as a preamble section
        if (sections.length === 0 && !current) {
          const preamble: Section = {
            level: 2,
            heading: h1Heading || 'Introduction',
            content: '',
            heading_path: h1Heading ? [h1Heading] : ['Introduction'],
          };
          current = preamble;
        }
        if (current) current.content += line + '\n';
      }
    }
  }
  if (current && (current.content.trim() || current.heading)) {
    sections.push(current);
  }
  return sections;
}

/** Split an H2 section further at H3 boundaries. */
function splitByH3(section: Section): Section[] {
  const lines = section.content.split('\n');
  const subsections: Section[] = [];
  let current: Section | null = null;

  for (const line of lines) {
    const h3Match = /^### (.+)/.exec(line);
    if (h3Match) {
      if (current) subsections.push(current);
      current = {
        level: 3,
        heading: h3Match[1].trim(),
        content: '',
        heading_path: [...section.heading_path, h3Match[1].trim()],
      };
    } else {
      if (current) {
        current.content += line + '\n';
      } else {
        // Content before first H3 in this section
        subsections.push({
          level: 3,
          heading: section.heading,
          content: line + '\n',
          heading_path: section.heading_path,
        });
      }
    }
  }
  if (current) subsections.push(current);
  return subsections.filter((s) => s.content.trim().length > 0);
}

/** Hard-split a text block into overlapping token-bounded chunks. */
function hardSplit(
  text: string,
  heading_path: string[],
  maxTokens: number,
  overlap: number,
): { content: string; heading_path: string[] }[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const chunks: { content: string; heading_path: string[] }[] = [];
  let start = 0;

  while (start < words.length) {
    let end = start;
    let tokens = 0;
    while (end < words.length && tokens < maxTokens) {
      tokens += countTokens(words[end] + ' ');
      end++;
    }
    const chunk = words.slice(start, end).join(' ');
    if (chunk.trim()) {
      chunks.push({ content: chunk, heading_path });
    }
    // Move forward by (maxTokens - overlap) tokens worth of words
    let skipTokens = 0;
    let skip = start;
    while (skip < end && skipTokens < maxTokens - overlap) {
      skipTokens += countTokens(words[skip] + ' ');
      skip++;
    }
    start = Math.max(skip, start + 1); // always advance at least 1 word
  }

  return chunks;
}

/**
 * chunkMarkdown — split a markdown document into semantically coherent chunks.
 *
 * @param content  - Full markdown file content
 * @param opts     - maxTokens (default 800), overlap (default 100)
 * @returns        Array of chunks with content, heading_path, and chunk_index
 */
export function chunkMarkdown(
  content: string,
  opts: ChunkOptions = {},
): MarkdownChunk[] {
  const maxTokens = opts.maxTokens ?? 800;
  const overlap = opts.overlap ?? 100;

  const h2Sections = splitByH2(content);
  const rawChunks: { content: string; heading_path: string[] }[] = [];

  for (const section of h2Sections) {
    const sectionText = `${section.heading}\n${section.content}`.trim();
    const tokenCount = countTokens(sectionText);

    if (tokenCount <= maxTokens) {
      // Fits in one chunk
      rawChunks.push({ content: sectionText, heading_path: section.heading_path });
    } else {
      // Try splitting at H3 level
      const h3Sections = splitByH3(section);
      if (h3Sections.length > 1) {
        for (const sub of h3Sections) {
          const subText = `${sub.heading}\n${sub.content}`.trim();
          const subTokens = countTokens(subText);
          if (subTokens <= maxTokens) {
            rawChunks.push({ content: subText, heading_path: sub.heading_path });
          } else {
            // H3 section still too large — hard split
            const splits = hardSplit(subText, sub.heading_path, maxTokens, overlap);
            rawChunks.push(...splits);
          }
        }
      } else {
        // No H3 boundaries — hard split
        const splits = hardSplit(sectionText, section.heading_path, maxTokens, overlap);
        rawChunks.push(...splits);
      }
    }
  }

  // Filter empty chunks and assign sequential index
  return rawChunks
    .filter((c) => c.content.trim().length > 10)
    .map((c, i) => ({ content: c.content, heading_path: c.heading_path, chunk_index: i }));
}
