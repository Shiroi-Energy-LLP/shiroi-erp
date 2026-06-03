/**
 * Create Shravan Tomar's account (Design Head).
 * Mirrors apps/erp/src/lib/employee-actions.ts → createEmployeeAccount.
 *
 * Usage: npx tsx scripts/create-shravan-account.ts
 *
 * Requires .env.local with NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SECRET_KEY.
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

const EMAIL = 'shravan@shiroienergy.com';
const FULL_NAME = 'Shravan Tomar';
const PHONE = '+919704514879';
const ROLE = 'designer' as const;
const DEPARTMENT = 'projects';
const DESIGNATION = 'Design Head';
const EMPLOYEE_CODE = 'D0001';
const DOJ = new Date().toISOString().split('T')[0];

function generateTempPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let p = '';
  for (let i = 0; i < 12; i++) p += chars.charAt(Math.floor(Math.random() * chars.length));
  return p;
}

async function main() {
  console.log('--- Creating Shravan Tomar (Design Head) on', supabaseUrl, '---');

  const tempPassword = generateTempPassword();

  // 1. Auth user
  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email: EMAIL,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { full_name: FULL_NAME },
  });

  if (authError || !authData.user) {
    console.error('Auth user creation failed:', authError?.message);
    process.exit(1);
  }

  const userId = authData.user.id;
  console.log('Auth user created:', userId);

  // 2. Profile update (the on_auth_user_created trigger inserts the row)
  const { error: profileError } = await admin
    .from('profiles')
    .update({
      role: ROLE,
      full_name: FULL_NAME,
      phone: PHONE,
      email: EMAIL,
    })
    .eq('id', userId);

  if (profileError) {
    console.error('Profile update failed:', profileError);
    process.exit(1);
  }
  console.log('Profile updated: role =', ROLE);

  // 3. Employee insert
  const { data: emp, error: empError } = await admin
    .from('employees')
    .insert({
      profile_id: userId,
      employee_code: EMPLOYEE_CODE,
      full_name: FULL_NAME,
      personal_phone: PHONE,
      personal_email: EMAIL,
      whatsapp_number: PHONE,
      department: DEPARTMENT,
      designation: DESIGNATION,
      date_of_joining: DOJ,
      is_active: true,
    })
    .select('id, full_name, employee_code, department, designation, date_of_joining')
    .single();

  if (empError || !emp) {
    console.error('Employee insert failed:', empError);
    process.exit(1);
  }
  console.log('Employee record created:', emp);

  console.log('\n--- Done ---');
  console.log('Email:    ', EMAIL);
  console.log('Password: ', tempPassword);
  console.log('Role:     ', ROLE);
  console.log('Login at:  https://erp.shiroienergy.com');
}

main().catch((e) => {
  console.error('Unhandled error:', e);
  process.exit(1);
});
