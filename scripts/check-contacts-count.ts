import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  const { count: cc } = await admin.from('companies').select('id', { count: 'exact', head: true });
  const { count: ct } = await admin.from('contacts').select('id', { count: 'exact', head: true });
  const { count: ec } = await admin.from('entity_contacts').select('id', { count: 'exact', head: true });
  const { count: ccr } = await admin.from('contact_company_roles').select('id', { count: 'exact', head: true });
  const { count: leads } = await admin.from('leads').select('id', { count: 'exact', head: true }).is('deleted_at', null);
  const { count: projects } = await admin.from('projects').select('id', { count: 'exact', head: true });

  console.log(`Companies:     ${cc}`);
  console.log(`Contacts:      ${ct}`);
  console.log(`Entity links:  ${ec}`);
  console.log(`Company roles: ${ccr}`);
  console.log(`Total leads:   ${leads}`);
  console.log(`Total projects: ${projects}`);
}
main();
