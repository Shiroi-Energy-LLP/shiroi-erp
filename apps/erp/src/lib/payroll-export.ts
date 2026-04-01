/**
 * Zoho Payroll CSV generation.
 *
 * Column order per Section 12.5 of Master Reference:
 * employee_id, full_name, uan_number, esic_number, paid_days, lop_days,
 * basic_salary, hra, special_allowance, travel_allowance, other_allowances,
 * variable_pay, one_time_additions, one_time_deductions, pf_employee,
 * esic_employee, professional_tax, remarks
 *
 * SECURITY: No salary amounts are logged anywhere in this module.
 */

import { generatePayrollFilename } from './hr-helpers';

const ZOHO_COLUMNS = [
  'employee_id',
  'full_name',
  'uan_number',
  'esic_number',
  'paid_days',
  'lop_days',
  'basic_salary',
  'hra',
  'special_allowance',
  'travel_allowance',
  'other_allowances',
  'variable_pay',
  'one_time_additions',
  'one_time_deductions',
  'pf_employee',
  'esic_employee',
  'professional_tax',
  'remarks',
] as const;

interface CompensationRow {
  basic_salary: number;
  hra: number;
  special_allowance: number;
  travel_allowance: number;
  other_allowances: number;
  variable_pay: number;
  pf_employee: number;
  esic_employee: number;
  professional_tax: number;
}

interface EmployeePayrollRow {
  id: string;
  employee_code: string;
  full_name: string;
  esic_number: string | null;
  employee_compensation: CompensationRow[];
}

function escapeCSVField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Generates a Zoho-compatible payroll CSV string from employee + compensation data.
 *
 * @param employees - Array of employees with nested compensation data
 * @param paidDays - Default paid days in the month (typically 30 or 31)
 * @returns CSV string ready for download
 */
export function generatePayrollCSV(
  employees: EmployeePayrollRow[],
  paidDays: number = 30,
): string {
  const op = '[generatePayrollCSV]';
  console.log(`${op} Generating CSV for ${employees.length} employees`);

  const rows: string[] = [];

  // Header row
  rows.push(ZOHO_COLUMNS.join(','));

  for (const emp of employees) {
    const comp = emp.employee_compensation[0];
    if (!comp) continue;

    const fields: string[] = [
      escapeCSVField(emp.employee_code),
      escapeCSVField(emp.full_name),
      '', // uan_number — not in employees table, Zoho fills from its records
      escapeCSVField(emp.esic_number ?? ''),
      String(paidDays),
      '0', // lop_days — to be calculated from leave_requests if needed
      String(comp.basic_salary),
      String(comp.hra),
      String(comp.special_allowance),
      String(comp.travel_allowance),
      String(comp.other_allowances),
      String(comp.variable_pay),
      '0', // one_time_additions
      '0', // one_time_deductions
      String(comp.pf_employee),
      String(comp.esic_employee),
      String(comp.professional_tax),
      '', // remarks
    ];

    rows.push(fields.join(','));
  }

  return rows.join('\n');
}

export { generatePayrollFilename };
