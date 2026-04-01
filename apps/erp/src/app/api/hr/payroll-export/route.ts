import { NextRequest, NextResponse } from 'next/server';
import { getUserProfile } from '@/lib/auth';
import { getPayrollData } from '@/lib/hr-queries';
import { generatePayrollCSV } from '@/lib/payroll-export';
import { generatePayrollFilename } from '@/lib/hr-helpers';

/**
 * POST /api/hr/payroll-export
 *
 * Generates a Zoho-compatible payroll CSV for download.
 * Role-gated: only founder or hr_manager.
 *
 * SECURITY: No salary amounts in logs or error responses.
 */
export async function POST(request: NextRequest) {
  const op = '[POST /api/hr/payroll-export]';

  try {
    // Role check
    const profile = await getUserProfile();
    if (!profile) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const allowedRoles: string[] = ['founder', 'hr_manager'];
    if (!allowedRoles.includes(profile.role)) {
      console.warn(`${op} Access denied: role=${profile.role}`);
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const year = Number(body.year);
    const month = Number(body.month);

    if (!year || !month || month < 1 || month > 12) {
      return NextResponse.json({ error: 'Invalid year or month' }, { status: 400 });
    }

    console.log(`${op} Generating payroll CSV for ${year}-${String(month).padStart(2, '0')}`);

    const employees = await getPayrollData(year, month);
    if (!employees) {
      return NextResponse.json({ error: 'Failed to fetch payroll data' }, { status: 500 });
    }

    if (employees.length === 0) {
      return NextResponse.json(
        { error: 'No active employees with compensation records found' },
        { status: 404 },
      );
    }

    const csv = generatePayrollCSV(employees);
    const filename = generatePayrollFilename(year, month);

    console.log(`${op} CSV generated for ${employees.length} employees`);

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    // SECURITY: Do not include any data details in error response
    console.error(`${op} Failed:`, {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      timestamp: new Date().toISOString(),
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
