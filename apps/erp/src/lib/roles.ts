import type { Database } from '@repo/types/database';

type DbAppRole = Database['public']['Enums']['app_role'];

// Extended role type — designer and purchase_officer are pending DB migration.
// Once the migration runs and types are regenerated, remove this union and use DbAppRole directly.
export type AppRole = DbAppRole | 'designer' | 'purchase_officer';

export const ROLE_LABELS: Record<AppRole, string> = {
  founder: 'Founder',
  hr_manager: 'HR Manager',
  sales_engineer: 'Sales Engineer',
  project_manager: 'Project Manager',
  site_supervisor: 'Site Supervisor',
  om_technician: 'O&M Technician',
  finance: 'Finance',
  customer: 'Customer',
  designer: 'Designer',
  purchase_officer: 'Purchase Officer',
};

export function getRoleLabel(role: AppRole): string {
  return ROLE_LABELS[role] ?? role;
}

export interface NavItem {
  label: string;
  href: string;
  icon: string;
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

// ---------------------------------------------------------------------------
// All possible nav items (icon names are Lucide component names)
// ---------------------------------------------------------------------------
const ITEMS = {
  dashboard:      { label: 'Dashboard',        href: '/dashboard',        icon: 'LayoutDashboard' },
  leads:          { label: 'Leads',             href: '/leads',            icon: 'Users' },
  proposals:      { label: 'Proposals',         href: '/proposals',        icon: 'FileText' },
  marketing:      { label: 'Marketing',         href: '/marketing',        icon: 'Megaphone' },
  liaison:        { label: 'Liaison',           href: '/liaison',          icon: 'Globe' },
  designQueue:    { label: 'Design Queue',      href: '/design',           icon: 'Palette' },
  projects:       { label: 'Projects',          href: '/projects',         icon: 'HardHat' },
  tasks:          { label: 'Tasks',             href: '/tasks',            icon: 'ClipboardList' },
  dailyReports:   { label: 'Daily Reports',     href: '/daily-reports',    icon: 'FileCheck' },
  qcGates:        { label: 'QC Gates',          href: '/qc-gates',        icon: 'FileCheck' },
  purchaseOrders: { label: 'Purchase Orders',   href: '/procurement',      icon: 'ShoppingCart' },
  vendors:        { label: 'Vendors',           href: '/vendors',          icon: 'Building2' },
  priceBook:      { label: 'Price Book',        href: '/price-book',       icon: 'BookOpen' },
  deliveries:     { label: 'Deliveries',        href: '/deliveries',       icon: 'Truck' },
  omVisits:       { label: 'O&M Visits',        href: '/om/visits',        icon: 'Wrench' },
  serviceTickets: { label: 'Service Tickets',   href: '/om/tickets',       icon: 'Wrench' },
  amcSchedule:    { label: 'AMC Schedule',      href: '/om/amc',           icon: 'CalendarCheck' },
  cashFlow:       { label: 'Cash Flow',         href: '/cash',             icon: 'TrendingUp' },
  invoices:       { label: 'Invoices',          href: '/invoices',         icon: 'DollarSign' },
  payments:       { label: 'Payments',          href: '/payments',         icon: 'DollarSign' },
  profitability:  { label: 'Profitability',     href: '/profitability',    icon: 'BarChart3' },
  vendorPayments: { label: 'Vendor Payments',   href: '/vendor-payments',  icon: 'DollarSign' },
  msmeCompliance: { label: 'MSME Compliance',   href: '/msme-compliance',  icon: 'Shield' },
  employees:      { label: 'Employees',         href: '/hr/employees',     icon: 'UserCog' },
  leave:          { label: 'Leave Requests',    href: '/hr/leave',         icon: 'CalendarCheck' },
  payroll:        { label: 'Payroll Export',    href: '/hr/payroll',       icon: 'UserCog' },
  training:       { label: 'Training',          href: '/hr/training',      icon: 'GraduationCap' },
  certifications: { label: 'Certifications',   href: '/hr/certifications', icon: 'Award' },
  myReports:      { label: 'My Reports',        href: '/my-reports',       icon: 'FileCheck' },
  myTasks:        { label: 'My Tasks',          href: '/my-tasks',         icon: 'ClipboardList' },
  campaigns:      { label: 'Campaigns',         href: '/marketing/campaigns', icon: 'Megaphone' },
  netMetering:    { label: 'Net Metering',      href: '/liaison/net-metering', icon: 'Globe' },
  contacts:       { label: 'Contacts',          href: '/contacts',           icon: 'Users' },
  companies:      { label: 'Companies',         href: '/companies',          icon: 'Building2' },
  inventory:      { label: 'Inventory',          href: '/inventory',          icon: 'Package' },
} as const satisfies Record<string, NavItem>;

// ---------------------------------------------------------------------------
// Section definitions per role
// ---------------------------------------------------------------------------
const SECTIONS_BY_ROLE: Record<AppRole, NavSection[]> = {
  founder: [
    { label: 'Overview',     items: [ITEMS.dashboard] },
    { label: 'Sales',        items: [ITEMS.leads, ITEMS.proposals, ITEMS.marketing, ITEMS.liaison] },
    { label: 'Design',       items: [ITEMS.designQueue] },
    { label: 'Projects',     items: [ITEMS.projects, ITEMS.tasks] },
    { label: 'Procurement',  items: [ITEMS.purchaseOrders, ITEMS.vendors, ITEMS.priceBook, ITEMS.inventory] },
    { label: 'O&M',          items: [ITEMS.omVisits, ITEMS.serviceTickets] },
    { label: 'Finance',      items: [ITEMS.cashFlow, ITEMS.invoices, ITEMS.payments, ITEMS.profitability] },
    { label: 'Contacts',    items: [ITEMS.contacts, ITEMS.companies] },
    { label: 'HR',           items: [ITEMS.employees, ITEMS.leave, ITEMS.payroll, ITEMS.training, ITEMS.certifications] },
  ],
  project_manager: [
    { label: 'Overview',     items: [ITEMS.dashboard] },
    { label: 'Projects',     items: [ITEMS.projects, ITEMS.tasks] },
    { label: 'Execution',    items: [ITEMS.dailyReports, ITEMS.qcGates] },
    { label: 'Procurement',  items: [ITEMS.purchaseOrders, ITEMS.inventory] },
    { label: 'O&M',          items: [ITEMS.serviceTickets, ITEMS.amcSchedule] },
    { label: 'Contacts',    items: [ITEMS.contacts, ITEMS.companies] },
  ],
  om_technician: [
    { label: 'Overview',     items: [ITEMS.dashboard] },
    { label: 'O&M',          items: [ITEMS.omVisits, ITEMS.serviceTickets] },
  ],
  site_supervisor: [
    { label: 'Overview',     items: [ITEMS.dashboard] },
    { label: 'My Work',      items: [ITEMS.myReports, ITEMS.myTasks] },
    { label: 'Projects',     items: [ITEMS.projects] },
  ],
  sales_engineer: [
    { label: 'Overview',     items: [ITEMS.dashboard] },
    { label: 'Sales',        items: [ITEMS.leads, ITEMS.proposals] },
    { label: 'Marketing',    items: [ITEMS.campaigns] },
    { label: 'Liaison',      items: [ITEMS.netMetering] },
    { label: 'Contacts',    items: [ITEMS.contacts, ITEMS.companies] },
  ],
  designer: [
    { label: 'Overview',     items: [ITEMS.dashboard] },
    { label: 'Design',       items: [ITEMS.designQueue] },
    { label: 'Reference',    items: [ITEMS.priceBook] },
  ],
  purchase_officer: [
    { label: 'Overview',         items: [ITEMS.dashboard] },
    { label: 'Procurement',      items: [ITEMS.purchaseOrders, ITEMS.deliveries, ITEMS.inventory] },
    { label: 'Vendor Management', items: [ITEMS.vendors, ITEMS.priceBook] },
    { label: 'Contacts',         items: [ITEMS.contacts, ITEMS.companies] },
  ],
  finance: [
    { label: 'Overview',     items: [ITEMS.dashboard] },
    { label: 'Cash',          items: [ITEMS.cashFlow] },
    { label: 'Billing',      items: [ITEMS.invoices, ITEMS.payments] },
    { label: 'Vendor',       items: [ITEMS.vendorPayments, ITEMS.msmeCompliance] },
    { label: 'Analysis',     items: [ITEMS.profitability] },
    { label: 'Contacts',    items: [ITEMS.contacts, ITEMS.companies] },
  ],
  hr_manager: [
    { label: 'Overview',            items: [ITEMS.dashboard] },
    { label: 'People',              items: [ITEMS.employees] },
    { label: 'Leave & Attendance',  items: [ITEMS.leave] },
    { label: 'Payroll',             items: [ITEMS.payroll] },
    { label: 'Development',         items: [ITEMS.training, ITEMS.certifications] },
  ],
  customer: [],
};

/**
 * Returns grouped navigation sections for a given role.
 */
export function navSectionsForRole(role: AppRole): NavSection[] {
  return SECTIONS_BY_ROLE[role] ?? [];
}

/**
 * Backward-compatible flat list of nav items for a given role.
 * Flattens all sections into a single array.
 */
export function navItemsForRole(role: AppRole): NavItem[] {
  const sections = navSectionsForRole(role);
  return sections.flatMap((section) => section.items);
}

// Re-export legacy NAV_ITEMS for any external consumers.
// Each item gets a `roles` property listing every role that can see it.
export interface LegacyNavItem extends NavItem {
  roles: AppRole[];
}

export const NAV_ITEMS: LegacyNavItem[] = (() => {
  const itemRoleMap = new Map<string, { item: NavItem; roles: Set<AppRole> }>();

  for (const [role, sections] of Object.entries(SECTIONS_BY_ROLE)) {
    for (const section of sections) {
      for (const item of section.items) {
        const existing = itemRoleMap.get(item.href);
        if (existing) {
          existing.roles.add(role as AppRole);
        } else {
          itemRoleMap.set(item.href, { item, roles: new Set([role as AppRole]) });
        }
      }
    }
  }

  return Array.from(itemRoleMap.values()).map(({ item, roles }) => ({
    ...item,
    roles: Array.from(roles),
  }));
})();
