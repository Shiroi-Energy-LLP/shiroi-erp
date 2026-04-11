// apps/erp/src/app/api/projects/[id]/commissioning/route.ts
// Commissioning Report PDF generation endpoint
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@repo/supabase/server';
import { renderToBuffer } from '@react-pdf/renderer';
import {
  CommissioningReportPDF,
  type CommissioningPdfData,
  type StringTestRow,
} from '@/lib/pdf/commissioning-report-pdf';
import React from 'react';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const op = '[GET /api/projects/[id]/commissioning]';
  const { id: projectId } = await params;
  console.log(`${op} Generating commissioning PDF for project: ${projectId}`);

  try {
    const supabase = await createClient();

    // Auth check
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    // Fetch commissioning report
    const { data: report, error: repErr } = await supabase
      .from('commissioning_reports')
      .select(
        'id, commissioning_date, system_size_kwp, panel_count_installed, inverter_serial_number, initial_reading_kwh, dc_voltage_v, dc_current_a, ac_voltage_v, ac_frequency_hz, earth_resistance_ohm, insulation_resistance_mohm, generation_confirmed, customer_explained, app_download_assisted, notes, status, prepared_by, string_test_data, monitoring_portal_link, monitoring_login, monitoring_password, performance_ratio_pct',
      )
      .eq('project_id', projectId)
      .maybeSingle();

    if (repErr || !report) {
      console.error(`${op} Report not found:`, { repErr, projectId });
      return NextResponse.json({ error: 'Commissioning report not found' }, { status: 404 });
    }

    // Fetch project info
    const { data: project, error: projErr } = await supabase
      .from('projects')
      .select(
        'project_number, customer_name, system_type, site_address_line1, site_address_line2, site_city, site_state, site_pincode',
      )
      .eq('id', projectId)
      .single();

    if (projErr || !project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // Get prepared-by name
    let preparedByName = '—';
    if ((report as any).prepared_by) {
      const { data: emp } = await supabase
        .from('employees')
        .select('full_name')
        .eq('id', (report as any).prepared_by)
        .single();
      preparedByName = (emp as any)?.full_name ?? '—';
    }

    const siteAddress = [
      (project as any).site_address_line1,
      (project as any).site_address_line2,
      (project as any).site_city,
      (project as any).site_state,
      (project as any).site_pincode,
    ]
      .filter(Boolean)
      .join(', ');

    const formatDate = (d: string) =>
      new Date(d).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });

    const r = report as any;
    const irValue = Number(r.insulation_resistance_mohm ?? 0);

    const pdfData: CommissioningPdfData = {
      projectNumber: (project as any).project_number ?? '',
      customerName: (project as any).customer_name ?? '',
      siteAddress,
      commissioningDate: r.commissioning_date ? formatDate(r.commissioning_date) : '—',
      systemSize: String(r.system_size_kwp ?? ''),
      systemType: ((project as any).system_type ?? 'on_grid').replace(/_/g, ' '),
      panelCount: r.panel_count_installed ?? 0,
      inverterSerial: r.inverter_serial_number ?? '',
      initialReading: String(r.initial_reading_kwh ?? 0),
      dcVoltage: r.dc_voltage_v != null ? String(r.dc_voltage_v) : '',
      dcCurrent: r.dc_current_a != null ? String(r.dc_current_a) : '',
      acVoltage: r.ac_voltage_v != null ? String(r.ac_voltage_v) : '',
      acFrequency: r.ac_frequency_hz != null ? String(r.ac_frequency_hz) : '',
      earthResistance: r.earth_resistance_ohm != null ? String(r.earth_resistance_ohm) : '',
      insulationResistance: r.insulation_resistance_mohm != null ? String(r.insulation_resistance_mohm) : '',
      irLow: irValue > 0 && irValue < 0.5,
      stringTests: (r.string_test_data as StringTestRow[]) ?? [],
      monitoringLink: r.monitoring_portal_link ?? '',
      monitoringLogin: r.monitoring_login ?? '',
      monitoringPassword: r.monitoring_password ?? '',
      performanceRatio: r.performance_ratio_pct != null ? String(r.performance_ratio_pct) : '',
      generationConfirmed: !!r.generation_confirmed,
      customerExplained: !!r.customer_explained,
      appAssisted: !!r.app_download_assisted,
      notes: r.notes ?? '',
      preparedByName,
      status: r.status ?? 'draft',
    };

    // Render PDF
    const pdfBuffer = await renderToBuffer(
      React.createElement(CommissioningReportPDF, { data: pdfData }) as any,
    );

    const fileName = `Commissioning-Report-${(project as any).project_number ?? projectId.slice(0, 8)}.pdf`;

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${fileName}"`,
      },
    });
  } catch (err) {
    console.error(`${op} Error:`, {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    return NextResponse.json({ error: 'Failed to generate commissioning PDF' }, { status: 500 });
  }
}
