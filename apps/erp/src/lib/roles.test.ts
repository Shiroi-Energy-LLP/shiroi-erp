import { describe, it, expect } from 'vitest';
import {
  getRoleLabel,
  navSectionsForRole,
  navItemsForRole,
  ROLE_LABELS,
  type AppRole,
} from './roles';

describe('ROLE_LABELS', () => {
  it('contains all 10 roles', () => {
    expect(Object.keys(ROLE_LABELS)).toHaveLength(10);
  });

  it('has correct label for designer', () => {
    expect(ROLE_LABELS['designer' as AppRole]).toBe('Designer');
  });

  it('has correct label for purchase_officer', () => {
    expect(ROLE_LABELS['purchase_officer' as AppRole]).toBe('Purchase Officer');
  });
});

describe('getRoleLabel', () => {
  it('returns correct label for each known role', () => {
    expect(getRoleLabel('founder' as AppRole)).toBe('Founder');
    expect(getRoleLabel('hr_manager' as AppRole)).toBe('HR Manager');
    expect(getRoleLabel('designer' as AppRole)).toBe('Designer');
    expect(getRoleLabel('purchase_officer' as AppRole)).toBe('Purchase Officer');
  });

  it('returns raw role string for unknown roles', () => {
    expect(getRoleLabel('unknown_role' as AppRole)).toBe('unknown_role');
  });
});

describe('navSectionsForRole', () => {
  it('founder returns all sections', () => {
    const sections = navSectionsForRole('founder' as AppRole);
    const sectionLabels = sections.map((s) => s.label);
    expect(sectionLabels).toEqual([
      'Overview', 'Sales', 'Design', 'Projects',
      'Procurement', 'O&M', 'Finance', 'HR',
    ]);
  });

  it('founder sees Dashboard in Overview', () => {
    const sections = navSectionsForRole('founder' as AppRole);
    const overview = sections.find((s) => s.label === 'Overview');
    expect(overview).toBeDefined();
    expect(overview!.items).toHaveLength(1);
    expect(overview!.items.at(0)?.label).toBe('Dashboard');
  });

  it('designer returns Overview + Design + Reference', () => {
    const sections = navSectionsForRole('designer' as AppRole);
    const labels = sections.map((s) => s.label);
    expect(labels).toEqual(['Overview', 'Design', 'Reference']);
  });

  it('designer Design section contains Design Queue', () => {
    const sections = navSectionsForRole('designer' as AppRole);
    const design = sections.find((s) => s.label === 'Design');
    expect(design!.items.at(0)?.label).toBe('Design Queue');
  });

  it('purchase_officer returns Overview + Procurement + Vendor Management', () => {
    const sections = navSectionsForRole('purchase_officer' as AppRole);
    const labels = sections.map((s) => s.label);
    expect(labels).toEqual(['Overview', 'Procurement', 'Vendor Management']);
  });

  it('purchase_officer Procurement section contains Purchase Orders and Deliveries', () => {
    const sections = navSectionsForRole('purchase_officer' as AppRole);
    const proc = sections.find((s) => s.label === 'Procurement');
    expect(proc!.items.map((i) => i.label)).toEqual(['Purchase Orders', 'Deliveries']);
  });

  it('customer returns empty array', () => {
    const sections = navSectionsForRole('customer' as AppRole);
    expect(sections).toEqual([]);
  });

  it('om_technician returns Overview + O&M', () => {
    const sections = navSectionsForRole('om_technician' as AppRole);
    const labels = sections.map((s) => s.label);
    expect(labels).toEqual(['Overview', 'O&M']);
  });

  it('project_manager returns 5 sections', () => {
    const sections = navSectionsForRole('project_manager' as AppRole);
    expect(sections).toHaveLength(5);
    expect(sections.map((s) => s.label)).toEqual([
      'Overview', 'Projects', 'Execution', 'Procurement', 'O&M',
    ]);
  });

  it('site_supervisor returns Overview + My Work + Projects', () => {
    const sections = navSectionsForRole('site_supervisor' as AppRole);
    expect(sections.map((s) => s.label)).toEqual(['Overview', 'My Work', 'Projects']);
  });

  it('sales_engineer returns Overview + Sales + Marketing + Liaison', () => {
    const sections = navSectionsForRole('sales_engineer' as AppRole);
    expect(sections.map((s) => s.label)).toEqual(['Overview', 'Sales', 'Marketing', 'Liaison']);
  });

  it('finance returns 5 sections', () => {
    const sections = navSectionsForRole('finance' as AppRole);
    expect(sections.map((s) => s.label)).toEqual([
      'Overview', 'Cash', 'Billing', 'Vendor', 'Analysis',
    ]);
  });

  it('hr_manager returns 5 sections', () => {
    const sections = navSectionsForRole('hr_manager' as AppRole);
    expect(sections.map((s) => s.label)).toEqual([
      'Overview', 'People', 'Leave & Attendance', 'Payroll', 'Development',
    ]);
  });
});

describe('navItemsForRole (backward compat)', () => {
  it('returns flat array of items for founder', () => {
    const items = navItemsForRole('founder' as AppRole);
    expect(items.length).toBeGreaterThan(0);
    expect(items.at(0)?.label).toBe('Dashboard');
    // Should be a flat array with href and icon on every item
    expect(items.every((i) => 'href' in i && 'icon' in i)).toBe(true);
  });

  it('returns empty for customer', () => {
    expect(navItemsForRole('customer' as AppRole)).toEqual([]);
  });

  it('founder item count >= every other role item count', () => {
    const founderCount = navItemsForRole('founder' as AppRole).length;
    const roles: AppRole[] = [
      'hr_manager' as AppRole,
      'sales_engineer' as AppRole,
      'project_manager' as AppRole,
      'site_supervisor' as AppRole,
      'om_technician' as AppRole,
      'finance' as AppRole,
      'customer' as AppRole,
      'designer' as AppRole,
      'purchase_officer' as AppRole,
    ];
    for (const role of roles) {
      const roleCount = navItemsForRole(role).length;
      expect(founderCount).toBeGreaterThanOrEqual(roleCount);
    }
  });

  it('founder sees leads and hr routes', () => {
    const items = navItemsForRole('founder' as AppRole);
    const hrefs = items.map((i) => i.href);
    expect(hrefs).toContain('/dashboard');
    expect(hrefs).toContain('/leads');
    expect(hrefs).toContain('/hr/employees');
  });

  it('site_supervisor does not see HR nav', () => {
    const items = navItemsForRole('site_supervisor' as AppRole);
    const hrefs = items.map((i) => i.href);
    expect(hrefs.some((h) => h.startsWith('/hr'))).toBe(false);
  });
});
