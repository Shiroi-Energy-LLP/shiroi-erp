// scripts/whatsapp-import/db.ts
import { createClient } from '@supabase/supabase-js';

const url = process.env['SUPABASE_URL'];
const key = process.env['SUPABASE_SECRET_KEY'];

if (!url || !key) {
  throw new Error('[db] SUPABASE_URL and SUPABASE_SECRET_KEY must be set in environment');
}

export const supabase = createClient(url, key, {
  auth: { persistSession: false },
});

export interface ProjectRecord {
  id: string;
  customer_name: string;
  project_number: string;
  site_city: string | null;
  status: string;
}

export interface LeadRecord {
  id: string;
  name: string;
  phone: string | null;
  city: string | null;
  status: string;
}

export interface EmployeeRecord {
  id: string;
  name: string;
}

let _projects: ProjectRecord[] | null = null;
let _leads: LeadRecord[] | null = null;
let _employees: EmployeeRecord[] | null = null;

export async function getAllProjects(): Promise<ProjectRecord[]> {
  if (_projects) return _projects;
  const { data, error } = await supabase
    .from('projects')
    .select('id, customer_name, project_number, site_city, status')
    .is('deleted_at', null);
  if (error) throw new Error(`[getAllProjects] ${error.message}`);
  _projects = data ?? [];
  return _projects;
}

export async function getAllLeads(): Promise<LeadRecord[]> {
  if (_leads) return _leads;
  const { data, error } = await supabase
    .from('leads')
    .select('id, name, phone, city, status')
    .not('status', 'eq', 'lost');
  if (error) throw new Error(`[getAllLeads] ${error.message}`);
  _leads = data ?? [];
  return _leads;
}

export async function getAllEmployees(): Promise<EmployeeRecord[]> {
  if (_employees) return _employees;
  const { data, error } = await supabase
    .from('employees')
    .select('id, name')
    .eq('is_active', true);
  if (error) throw new Error(`[getAllEmployees] ${error.message}`);
  _employees = data ?? [];
  return _employees;
}
