/**
 * Fix Vinodh's account: update role to founder, reset password, ensure employee record exists.
 *
 * Usage: npx tsx scripts/fix-vinodh-account.ts
 *
 * Requires .env.local with NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SECRET_KEY!;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY in .env.local');
  process.exit(1);
}

const admin = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const EMAIL = 'vinodh@shiroienergy.com';
const NEW_PASSWORD = 'Shiroi2026!tmp';

async function main() {
  console.log('--- Fixing Vinodh account ---');

  // 1. Find the auth user
  const { data: { users }, error: listErr } = await admin.auth.admin.listUsers();
  if (listErr) { console.error('List users failed:', listErr); process.exit(1); }

  const user = users.find(u => u.email === EMAIL);
  if (!user) { console.error(`No auth user found for ${EMAIL}`); process.exit(1); }

  console.log(`Found auth user: ${user.id} (${user.email})`);

  // 2. Reset password
  const { error: pwErr } = await admin.auth.admin.updateUserById(user.id, {
    password: NEW_PASSWORD,
  });
  if (pwErr) { console.error('Password reset failed:', pwErr); }
  else { console.log(`Password reset to: ${NEW_PASSWORD}`); }

  // 3. Update profile role to founder
  const { error: profileErr } = await admin
    .from('profiles')
    .update({ role: 'founder', full_name: 'Vinodh', email: EMAIL })
    .eq('id', user.id);

  if (profileErr) { console.error('Profile update failed:', profileErr); }
  else { console.log('Profile updated: role = founder'); }

  // 4. Check if employee record exists
  const { data: existingEmp } = await admin
    .from('employees')
    .select('id')
    .eq('profile_id', user.id)
    .single();

  if (existingEmp) {
    console.log('Employee record already exists:', existingEmp.id);
  } else {
    console.log('No employee record found — creating one...');
    const { error: empErr } = await admin.from('employees').insert({
      profile_id: user.id,
      employee_code: 'SE0001',
      full_name: 'Vinodh Kadavasal Sridhar',
      personal_email: EMAIL,
      personal_phone: '9444065787',
      department: 'management',
      designation: 'Partner',
      date_of_joining: '2012-01-01',
      is_active: true,
    });
    if (empErr) { console.error('Employee insert failed:', empErr); }
    else { console.log('Employee record created'); }
  }

  console.log('\n--- Done ---');
  console.log(`Email: ${EMAIL}`);
  console.log(`Temp Password: ${NEW_PASSWORD}`);
  console.log('Login at: https://erp.shiroienergy.com');
}

main();
