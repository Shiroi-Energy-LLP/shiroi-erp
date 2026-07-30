/**
 * Create DEV login accounts for three field site supervisors (migrated from
 * Manivel's sheet): Anbarasan, S Manikandan, A Manikandan.
 *
 * Provisioning chain (mirrors scripts/create-shravan-account.ts +
 * apps/erp/src/lib/employee-actions.ts → createEmployeeAccount):
 *   1. auth.users  — Auth Admin API createUser (email + password, email_confirm)
 *   2. profiles    — auto-inserted by the on_auth_user_created trigger
 *                    (handle_new_user, migration 001); we then update
 *                    role/full_name/email/phone.
 *   3. employees   — inserted here, linked via profile_id (field staff need an
 *                    employees row so *_by / site_supervisor_id FKs resolve).
 *
 * DEV ONLY — targets whatever NEXT_PUBLIC_SUPABASE_URL points at in .env.local
 * (must be the dev project actqtzoxjilqnldnacqz). Never run against prod.
 *
 * Idempotent: re-running detects an existing auth user (via profiles.email —
 * the admin listUsers endpoint 500s on this instance) and updates password +
 * role instead of hard-failing. Employees are matched by profile_id.
 *
 * Usage: npx tsx scripts/create-site-supervisors-2026-07-21.ts
 * Requires .env.local with NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SECRET_KEY
 * (+ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY for the sign-in smoke test).
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SECRET_KEY!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY in .env.local');
  process.exit(1);
}

// Guardrail: refuse to run against anything that is not the known dev project.
const DEV_REF = 'actqtzoxjilqnldnacqz';
if (!supabaseUrl.includes(DEV_REF)) {
  console.error(`Refusing to run: NEXT_PUBLIC_SUPABASE_URL (${supabaseUrl}) is not the dev project ${DEV_REF}.`);
  process.exit(1);
}

const admin = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const PASSWORD = 'Solar@123';
const ROLE = 'site_supervisor' as const;
const DEPARTMENT = 'projects';
const DESIGNATION = 'Site Supervisor';
const DOJ = new Date().toISOString().split('T')[0];

interface Supervisor {
  fullName: string;
  loginEmail: string;
  personalEmail: string; // for record only — not used as a login credential
  employeeCode: string;
}

const SUPERVISORS: Supervisor[] = [
  { fullName: 'Anbarasan',     loginEmail: 'anbarasan@shiroienergy.com',   personalEmail: 'anbu1141@gmail.com',    employeeCode: 'SS0001' },
  { fullName: 'S Manikandan',  loginEmail: 'smanikandan@shiroienergy.com', personalEmail: 'manisv516@gmail.com',   employeeCode: 'SS0002' },
  { fullName: 'A Manikandan',  loginEmail: 'amanikandan@shiroienergy.com', personalEmail: 'manianbu2022@gmail.com', employeeCode: 'SS0003' },
];

async function findAuthIdByEmail(email: string): Promise<string | null> {
  // listUsers 500s on this dev instance, so resolve the auth uid via the
  // profiles row the trigger creates (profiles.email mirrors auth email).
  const { data } = await admin.from('profiles').select('id').eq('email', email).maybeSingle();
  return data?.id ?? null;
}

interface Result {
  fullName: string;
  loginEmail: string;
  authUid: string | null;
  employeeId: string | null;
  status: string;
}

async function provision(s: Supervisor): Promise<Result> {
  console.log(`\n=== ${s.fullName} <${s.loginEmail}> ===`);
  let created = false;
  let authUid: string | null = null;

  // 1. Auth user
  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email: s.loginEmail,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: s.fullName, role: ROLE },
  });

  if (authError) {
    const msg = (authError.message || '').toLowerCase();
    const alreadyExists = msg.includes('already') || msg.includes('registered') || (authError as { code?: string }).code === 'email_exists';
    if (!alreadyExists) {
      console.error('  createUser failed:', authError.message);
      return { fullName: s.fullName, loginEmail: s.loginEmail, authUid: null, employeeId: null, status: 'FAILED: ' + authError.message };
    }
    // Already exists — resolve uid and reset password + confirm email.
    authUid = await findAuthIdByEmail(s.loginEmail);
    console.log('  auth user already exists, uid =', authUid);
    if (authUid) {
      const { error: updErr } = await admin.auth.admin.updateUserById(authUid, {
        password: PASSWORD,
        email_confirm: true,
      });
      if (updErr) console.error('  password/confirm update failed:', updErr.message);
      else console.log('  password reset + email confirmed');
    }
    created = false;
  } else {
    authUid = authData.user!.id;
    created = true;
    console.log('  auth user created, uid =', authUid);
  }

  if (!authUid) {
    return { fullName: s.fullName, loginEmail: s.loginEmail, authUid: null, employeeId: null, status: 'FAILED: could not resolve auth uid' };
  }

  // 2. Profile (row already inserted by the on_auth_user_created trigger)
  const { error: profileError } = await admin
    .from('profiles')
    .update({ role: ROLE, full_name: s.fullName, email: s.loginEmail })
    .eq('id', authUid);
  if (profileError) console.error('  profile update failed:', profileError.message);
  else console.log('  profile updated: role =', ROLE);

  // 3. Employee (link by profile_id; do not duplicate)
  let employeeId: string | null = null;
  const { data: existingEmp } = await admin
    .from('employees')
    .select('id')
    .eq('profile_id', authUid)
    .maybeSingle();

  if (existingEmp) {
    employeeId = existingEmp.id;
    await admin.from('employees').update({ is_active: true, full_name: s.fullName }).eq('id', employeeId);
    console.log('  employee already linked:', employeeId);
  } else {
    const { data: emp, error: empError } = await admin
      .from('employees')
      .insert({
        profile_id: authUid,
        employee_code: s.employeeCode,
        full_name: s.fullName,
        personal_email: s.personalEmail,
        // No phone on record from the sheet; personal_phone is NOT NULL.
        // Placeholder so the login works; founder can fill the real number later.
        personal_phone: '',
        department: DEPARTMENT,
        designation: DESIGNATION,
        date_of_joining: DOJ,
        is_active: true,
      })
      .select('id')
      .single();
    if (empError) {
      console.error('  employee insert failed:', empError.message);
    } else {
      employeeId = emp!.id;
      console.log('  employee created:', employeeId, '(code', s.employeeCode + ')');
    }
  }

  return {
    fullName: s.fullName,
    loginEmail: s.loginEmail,
    authUid,
    employeeId,
    status: created ? 'created' : 'already existed / updated',
  };
}

async function signInTest(email: string): Promise<string> {
  if (!anonKey) return 'skipped (no NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)';
  const pub = createClient(supabaseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await pub.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) return 'FAILED: ' + error.message;
  const ok = !!data.session?.access_token;
  await pub.auth.signOut();
  return ok ? 'OK (session token issued)' : 'FAILED: no session token';
}

async function main() {
  console.log('--- Provisioning site_supervisor logins on', supabaseUrl, '---');
  const results: Result[] = [];
  for (const s of SUPERVISORS) {
    results.push(await provision(s));
  }

  console.log('\n=== SIGN-IN SMOKE TEST (anbarasan@shiroienergy.com) ===');
  const signIn = await signInTest('anbarasan@shiroienergy.com');
  console.log('  ', signIn);

  console.log('\n=== SUMMARY ===');
  for (const r of results) {
    console.log(`${r.fullName} | ${r.loginEmail} | ${ROLE} | uid=${r.authUid} | emp=${r.employeeId} | ${r.status}`);
  }
}

main().catch((e) => {
  console.error('Unhandled error:', e);
  process.exit(1);
});
