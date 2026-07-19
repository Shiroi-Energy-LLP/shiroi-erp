/**
 * Regenerate packages/types/database.ts from the dev project via the Supabase
 * Management API (CLAUDE.md preferred method — uses the SUPABASE_ACCESS_TOKEN PAT).
 * Then run `node scripts/strip-view-fk-entries.mjs && pnpm check-types`.
 *
 * Usage: node scripts/regen-types.mjs [projectRef]   (default = dev ref)
 */
import * as dotenv from 'dotenv';
import { writeFileSync } from 'fs';

dotenv.config({ path: '.env.local' });

const ref = process.argv[2] || 'actqtzoxjilqnldnacqz';
const token = (process.env.SUPABASE_ACCESS_TOKEN || '').trim();
if (!token) {
  console.error('SUPABASE_ACCESS_TOKEN missing from .env.local');
  process.exit(1);
}

const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/types/typescript`, {
  headers: { Authorization: `Bearer ${token}` },
});
const obj = await res.json();
if (!obj.types) {
  console.error('No types returned:', JSON.stringify(obj).slice(0, 300));
  process.exit(1);
}
writeFileSync('packages/types/database.ts', obj.types);
console.log(`Wrote packages/types/database.ts (${obj.types.length} chars) from ${ref}`);
