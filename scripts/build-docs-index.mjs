#!/usr/bin/env node
// Build docs/INDEX.md — a token-cheap router over the heavy on-demand docs
// (plans, specs, reviews). One grep-able line per file so an agent can find the
// right doc WITHOUT opening 100 KB files to discover what's inside.
//
// Deterministic + idempotent: re-run after adding/renaming docs.
//   node scripts/build-docs-index.mjs
//
// Extraction is best-effort from each file's own header (first H1 + the
// **Date:** / **Module:** / **Status:** / **Goal:** lines the repo already uses).

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const OUT = join(ROOT, 'docs', 'INDEX.md');

const SECTIONS = [
  { dir: 'docs/superpowers/specs', title: 'Specs — design docs (the *what* & *why*)' },
  { dir: 'docs/superpowers/plans', title: 'Plans — implementation logs (the *how*, task-by-task)' },
  { dir: 'docs/reviews', title: 'Reviews — audits & multi-area sweeps' },
];

const firstMatch = (body, re) => {
  const m = body.match(re);
  return m ? m[1].trim() : '';
};

// Collapse to a single short line — INDEX must stay cheap to load.
const clip = (s, n) => {
  s = s.replace(/\s+/g, ' ').replace(/[`*]/g, '').trim();
  return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;
};

function summarize(path) {
  const body = readFileSync(join(ROOT, path), 'utf8');
  const title = clip(firstMatch(body, /^#\s+(.+)$/m) || path.split('/').pop(), 80);
  const date =
    firstMatch(body, /\*\*Date:\*\*\s*(.+)/) ||
    (path.match(/(\d{4}-\d{2}-\d{2})/)?.[1] ?? '');
  const module = clip(firstMatch(body, /\*\*Module:\*\*\s*(.+)/), 28);
  const status = clip(firstMatch(body, /\*\*Status:\*\*\s*(.+)/), 44);
  const goal = clip(firstMatch(body, /\*\*Goal:\*\*\s*(.+)/), 120);
  return { date, title, module, status, goal };
}

function renderRow(path, s) {
  const base = path.split('/').pop();
  const tags = [s.module && `_${s.module}_`, s.status && `**${s.status}**`]
    .filter(Boolean)
    .join(' · ');
  const lead = `- \`${s.date || '—'}\` **${s.title}**`;
  const tail = [tags, s.goal, `\`${base}\``].filter(Boolean).join(' · ');
  return `${lead} — ${tail}`;
}

let out = `# Docs INDEX — router for the heavy on-demand docs

> **Generated** by \`scripts/build-docs-index.mjs\` — do not hand-edit; re-run after adding docs.
> Purpose: find the right spec / plan / review from ONE line without opening 50–145 KB files.
> Paths are relative to \`docs/superpowers/specs\`, \`docs/superpowers/plans\`, \`docs/reviews\`.
> For "when did we ship X" use \`docs/CHANGELOG.md\`; for module overviews use \`docs/modules/<module>.md\`.

`;

for (const { dir, title } of SECTIONS) {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) continue;
  const files = readdirSync(abs)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .reverse(); // newest first (filenames are date-prefixed)
  out += `\n## ${title}\n\n_${files.length} files in \`${dir}/\`_\n\n`;
  for (const f of files) {
    const rel = `${dir}/${f}`;
    try {
      out += renderRow(rel, summarize(rel)) + '\n';
    } catch (e) {
      out += `- \`—\` **${f}** — (unreadable: ${e.message})\n`;
    }
  }
}

writeFileSync(OUT, out);
const lines = out.split('\n').length;
console.log(`Wrote ${OUT} — ${lines} lines, ${out.length} bytes`);
