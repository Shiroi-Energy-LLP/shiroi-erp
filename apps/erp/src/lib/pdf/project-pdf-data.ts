// apps/erp/src/lib/pdf/project-pdf-data.ts
import { createClient } from '@repo/supabase/server';

export type ProjectPdfSection = 'survey' | 'boq' | 'commissioning' | 'dc' | 'qc';

export interface ProjectPdfData {
  project: {
    id: string;
    project_number: string;
    customer_name: string;
    site_address: string;
    system_size_kwp: number;
    system_type: string;
    status: string;
  };
  survey?: any;
  boqItems?: any[];
  boqTotal?: number;
  commissioningReport?: any;
  outgoingChallans?: any[];
  qcInspections?: any[];
  generatedAt: string;
}

export async function assembleProjectPdfData(
  projectId: string,
  sections: ProjectPdfSection[]
): Promise<ProjectPdfData> {
  const op = '[assembleProjectPdfData]';
  console.log(`${op} Starting for: ${projectId}, sections: ${sections.join(', ')}`);

  const supabase = await createClient();

  // Always fetch project basics
  const { data: project, error: projErr } = await supabase
    .from('projects')
    .select('id, project_number, customer_name, system_size_kwp, system_type, status, site_address_line1, site_city, site_state, site_pincode')
    .eq('id', projectId)
    .single();

  if (projErr || !project) {
    throw new Error(`Failed to fetch project: ${projErr?.message ?? 'not found'}`);
  }

  const result: ProjectPdfData = {
    project: {
      id: project.id,
      project_number: project.project_number,
      customer_name: project.customer_name,
      site_address: [project.site_address_line1, project.site_city, project.site_state, project.site_pincode].filter(Boolean).join(', '),
      system_size_kwp: project.system_size_kwp,
      system_type: project.system_type,
      status: project.status,
    },
    generatedAt: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
  };

  // Fetch requested sections in parallel
  const promises: Promise<void>[] = [];

  if (sections.includes('survey')) {
    promises.push(
      (async () => {
        const { data: proj } = await supabase.from('projects').select('lead_id').eq('id', projectId).single();
        if (proj?.lead_id) {
          const { data: survey } = await supabase
            .from('lead_site_surveys')
            .select('*')
            .eq('lead_id', proj.lead_id)
            .order('survey_date', { ascending: false })
            .limit(1)
            .maybeSingle();
          result.survey = survey;
        }
      })()
    );
  }

  if (sections.includes('boq')) {
    promises.push(
      (async () => {
        const { data: items } = await supabase
          .from('project_boq_items' as any)
          .select('*')
          .eq('project_id', projectId)
          .order('line_number', { ascending: true });
        result.boqItems = items ?? [];
        result.boqTotal = (items ?? []).reduce((sum: number, i: any) => sum + Number(i.total_price || 0), 0);
      })()
    );
  }

  if (sections.includes('commissioning')) {
    promises.push(
      (async () => {
        const { data: report } = await supabase
          .from('commissioning_reports')
          .select('*')
          .eq('project_id', projectId)
          .maybeSingle();
        result.commissioningReport = report;
      })()
    );
  }

  if (sections.includes('dc')) {
    promises.push(
      (async () => {
        const { data: challans } = await supabase
          .from('delivery_challans' as any)
          .select('*, delivery_challan_items(*)')
          .eq('project_id', projectId)
          .order('dc_date', { ascending: false });
        result.outgoingChallans = challans ?? [];
      })()
    );
  }

  if (sections.includes('qc')) {
    promises.push(
      (async () => {
        const { data: inspections } = await supabase
          .from('qc_gate_inspections')
          .select('*')
          .eq('project_id', projectId)
          .order('gate_number', { ascending: true });
        result.qcInspections = inspections ?? [];
      })()
    );
  }

  await Promise.all(promises);
  return result;
}
