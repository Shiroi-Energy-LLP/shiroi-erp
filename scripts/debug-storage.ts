import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: 'C:/Users/vivek/Projects/shiroi-erp/.env.local' });

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!);

async function main() {
  console.log('Listing root...');
  const { data: folders, error } = await sb.storage.from('proposal-files').list('', { limit: 3 });
  console.log('Root:', folders?.length, 'error:', error?.message);

  if (folders && folders.length > 0) {
    console.log('First folder:', folders[0].name, 'id:', folders[0].id);
    const { data: files, error: e2 } = await sb.storage.from('proposal-files').list(folders[0].name, { limit: 5 });
    console.log('Sub files:', files?.length, 'error:', e2?.message);
    files?.forEach(f => console.log('  ', f.name, typeof f.metadata === 'object' ? JSON.stringify(f.metadata).substring(0,80) : 'no-meta'));
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
