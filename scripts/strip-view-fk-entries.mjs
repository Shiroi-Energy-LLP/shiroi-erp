// Remove FK-metadata entries whose referencedRelation is a view.
// Supabase's type generator inlines every view that exposes a
// FK-candidate column as a `referencedRelation`, causing the resulting
// `Database` type to explode in size and trip TS2589
// ("Type instantiation excessively deep"). Views aren't actual FK
// targets, so stripping them is safe and semantic-preserving.
//
// Usage: `node scripts/strip-view-fk-entries.mjs`. Run after each
// `generate_typescript_types` regen. If the Supabase team fixes this
// upstream we can delete this script.

import fs from 'node:fs';

const FILE = 'packages/types/database.ts';
const src = fs.readFileSync(FILE, 'utf8');

// Match a full FK entry object whose referencedRelation starts with 'v_'.
// FK entries are 5 lines each and sit in a tabular array. We strip from the
// opening `{` through the matching `},`.
const pattern =
  /\{\s*foreignKeyName:[^}]*?referencedRelation:\s*"v_[^"]+"[^}]*?\},?\s*/g;

const stripped = src.replace(pattern, '');

// Cleanup: some arrays may now end with a stray comma right before `]`.
const tidied = stripped.replace(/,(\s*)\]/g, '$1]');

fs.writeFileSync(FILE, tidied);

const before = src.length;
const after = tidied.length;
console.log(
  `Stripped view-FK entries: ${before.toLocaleString()} → ${after.toLocaleString()} chars (${((1 - after / before) * 100).toFixed(1)}% reduction)`,
);
