import { describe, it, expect } from 'vitest';
import {
  getRoleLabel,
  navSectionsForRole,
  navItemsForRole,
  ROLE_LABELS,
  type AppRole,
} from './roles';

describe('ROLE_LABELS', () => {
  it('contains all 11 roles', () => {
    // 11 = 10 original + marketing_manager (migration 051)
    expect(Object.keys(ROLE_LABELS)).toHaveLength(11);
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
    // Marketing revamp added Contacts/Admin; commit 7d7eb75 swapped the
    // vouchers section for Expenses; commit a4fae6f added an Account section
    // (Settings) on every non-customer role; the BOI purchase flow added the
    // Purchase section — 13 sections total.
    expect(sectionLabels).toEqual([
      'Overview', 'Sales', 'Design', 'Projects', 'Expenses', 'Purchase',
      'Procurement', 'O&M', 'Finance', 'Contacts', 'HR', 'Admin', 'Account',
    ]);
  });

  it('founder sees Command Center + Dashboard + My Tasks in Overview', () => {
    const sections = navSectionsForRole('founder' as AppRole);
    const overview = sections.find((s) => s.label === 'Overview');
    expect(overview).toBeDefined();
    expect(overview!.items).toHaveLength(3);
    expect(overview!.items.map((i) => i.label)).toEqual(['Command Center', 'Dashboard', 'My Tasks']);
  });

  it('designer returns Overview + Design + Expenses + Reference + Sales (R/O) + Projects (R/O) + Account', () => {
    const sections = navSectionsForRole('designer' as AppRole);
    const labels = sections.map((s) => s.label);
    // Marketing revamp (migration 052 RLS) gave designers read-only windows
    // onto Sales + Projects for context. Expenses + Account added later.
    expect(labels).toEqual([
      'Overview', 'Design', 'Expenses', 'Reference', 'Sales (R/O)', 'Projects (R/O)', 'Account',
    ]);
  });

  it('designer Design section contains Design Queue', () => {
    const sections = navSectionsForRole('designer' as AppRole);
    const design = sections.find((s) => s.label === 'Design');
    expect(design!.items.at(0)?.label).toBe('Design Queue');
  });

  it('purchase_officer returns Overview + Purchase + Procurement + Expenses + Vendor Management + Contacts + Admin + Account', () => {
    // Purchase (BOI flow) leads their nav — it is their main workflow.
    const sections = navSectionsForRole('purchase_officer' as AppRole);
    const labels = sections.map((s) => s.label);
    expect(labels).toEqual([
      'Overview', 'Purchase', 'Procurement', 'Expenses', 'Vendor Management', 'Contacts', 'Admin', 'Account',
    ]);
  });

  it('purchase_officer Procurement section contains Purchase Orders, Material Requests, Deliveries, Inventory', () => {
    // Material Requests added by C1 purchase work (mig 123) to let purchase_officer
    // review/convert requisitions to POs.
    const sections = navSectionsForRole('purchase_officer' as AppRole);
    const proc = sections.find((s) => s.label === 'Procurement');
    expect(proc!.items.map((i) => i.label)).toEqual([
      'Purchase Orders', 'Material Requests', 'Deliveries', 'Inventory',
    ]);
  });

  it('customer returns empty array', () => {
    const sections = navSectionsForRole('customer' as AppRole);
    expect(sections).toEqual([]);
  });

  it('om_technician returns Overview + O&M + Expenses + Account', () => {
    const sections = navSectionsForRole('om_technician' as AppRole);
    const labels = sections.map((s) => s.label);
    expect(labels).toEqual(['Overview', 'O&M', 'Expenses', 'Account']);
  });

  it('project_manager returns 10 sections', () => {
    const sections = navSectionsForRole('project_manager' as AppRole);
    // 10 = previous 5 + Expenses (commit 7d7eb75, formerly Approvals/vouchers)
    // + Reference (priceBook, Task 15) + Contacts + Account + Purchase (BOI flow).
    expect(sections).toHaveLength(10);
    expect(sections.map((s) => s.label)).toEqual([
      'Overview', 'Projects', 'Expenses', 'Purchase', 'Execution', 'Procurement',
      'Reference', 'O&M', 'Contacts', 'Account',
    ]);
  });

  it('site_supervisor returns Overview + My Work + Projects + Procurement + Account', () => {
    // Procurement section added by C1 purchase work (mig 123) so site_supervisors
    // can submit material requisitions from the field.
    const sections = navSectionsForRole('site_supervisor' as AppRole);
    expect(sections.map((s) => s.label)).toEqual(['Overview', 'My Work', 'Projects', 'Procurement', 'Account']);
  });

  it('sales_engineer returns Overview + Sales + Expenses + Contacts + Account', () => {
    const sections = navSectionsForRole('sales_engineer' as AppRole);
    // Marketing revamp moved Marketing + Liaison out of sales_engineer into
    // the new marketing_manager role. Expenses + Account added later.
    expect(sections.map((s) => s.label)).toEqual([
      'Overview', 'Sales', 'Expenses', 'Contacts', 'Account',
    ]);
  });

  it('finance returns 10 sections', () => {
    const sections = navSectionsForRole('finance' as AppRole);
    // 10 = previous 5 + Expenses (commit 7d7eb75, formerly Approvals/vouchers)
    // + Contacts + Admin + Account + Purchase (BOI flow, read-only money view).
    expect(sections.map((s) => s.label)).toEqual([
      'Overview', 'Cash', 'Billing', 'Vendor', 'Expenses', 'Purchase',
      'Analysis', 'Contacts', 'Admin', 'Account',
    ]);
  });

  it('marketing_manager returns 10 sections', () => {
    // Role added by migration 051. Sales + Design + Liaison + Payments +
    // Projects (R/O) + Expenses + Reference + Contacts + Account.
    const sections = navSectionsForRole('marketing_manager' as AppRole);
    expect(sections.map((s) => s.label)).toEqual([
      'Overview', 'Sales', 'Design', 'Liaison', 'Payments',
      'Projects (R/O)', 'Expenses', 'Reference', 'Contacts', 'Account',
    ]);
  });

  it('hr_manager returns 7 sections', () => {
    const sections = navSectionsForRole('hr_manager' as AppRole);
    expect(sections.map((s) => s.label)).toEqual([
      'Overview', 'People', 'Expenses', 'Leave & Attendance', 'Payroll',
      'Development', 'Account',
    ]);
  });
});

describe('navItemsForRole (backward compat)', () => {
  it('returns flat array of items for founder', () => {
    const items = navItemsForRole('founder' as AppRole);
    expect(items.length).toBeGreaterThan(0);
    expect(items.at(0)?.label).toBe('Command Center');
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
      'marketing_manager' as AppRole,
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

  it('founder sees sales and hr routes', () => {
    const items = navItemsForRole('founder' as AppRole);
    const hrefs = items.map((i) => i.href);
    expect(hrefs).toContain('/dashboard');
    // /leads was renamed to /sales by the marketing revamp middleware redirect.
    expect(hrefs).toContain('/sales');
    expect(hrefs).toContain('/hr/employees');
  });

  it('site_supervisor sees the BOI intake link', () => {
    const hrefs = navItemsForRole('site_supervisor' as AppRole).map((i) => i.href);
    expect(hrefs).toContain('/purchase/intake');
  });

  it('purchase_officer sees the BOI purchase routes', () => {
    const hrefs = navItemsForRole('purchase_officer' as AppRole).map((i) => i.href);
    expect(hrefs).toContain('/purchase');
    expect(hrefs).toContain('/purchase/orders');
    expect(hrefs).toContain('/purchase/projects');
  });

  it('site_supervisor does not see HR nav', () => {
    const items = navItemsForRole('site_supervisor' as AppRole);
    const hrefs = items.map((i) => i.href);
    expect(hrefs.some((h) => h.startsWith('/hr'))).toBe(false);
  });
});
