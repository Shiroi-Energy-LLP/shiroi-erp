# Shiroi ERP — Phase 1 Complete Build Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build all of Phase 1 — from design system through data migration — so Vivek can open the ERP at 8am and see cash-negative projects, pending proposals, overdue reports, and this month's payroll.

**Architecture:** Next.js 14 App Router on Vercel, Supabase PostgreSQL with RLS, `@repo/supabase` client factory, `@repo/ui` design system, `@repo/types` for all DB types. Each Step produces independently deployable, working software before the next step begins.

**Tech Stack:** Next.js 14, TypeScript, Tailwind CSS, shadcn/ui, Supabase (auth + db + storage), `@repo/supabase` clients, `@repo/types/database`, `decimal.js`, Vitest, React Testing Library, pnpm, Turborepo.

---

## Testing Strategy (applies to every Step)

Every step passes **all four gates** before being considered done:

| Gate | Command | Must pass |
|------|---------|-----------|
| TypeScript | `pnpm run check-types` (from root) | Zero errors |
| Lint | `pnpm run lint` (from root) | Zero warnings |
| Unit tests | `pnpm run test` (from root) | All pass |
| Visual/functional | Open localhost:3000, test the screen manually | All interactions work against Supabase dev |

**Review process (every Step):** Vivek reads every file Claude writes → approves → `git add` specific files → `git commit` → `git push`. No autonomous commits.

**Sensitive fields never appear in:** console.log, error messages, test fixtures, or mock data. These are: `bank_account_number`, `aadhar_number`, `pan_number`, `gross_monthly`, `basic_salary`, `ctc_monthly`, `ctc_annual`, `net_take_home`, `commission_amount`, `pf_employee`.

---

## Step 7 — Design System (`packages/ui`)

**What this produces:** A fully configured `@repo/ui` package with Shiroi brand tokens baked into Tailwind, shadcn/ui components installed and themed, and 8 core shared components ready to import in `apps/erp`.

**Why first:** Every subsequent screen imports from `@repo/ui`. Nothing visual can be built until this exists.

### Files created/modified

| File | What it does |
|------|-------------|
| `packages/ui/tailwind.config.ts` | Shiroi colour palette, spacing, typography scale |
| `packages/ui/src/globals.css` | CSS custom properties (HSL vars for shadcn tokens) |
| `packages/ui/package.json` | Add `tailwindcss`, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react` |
| `packages/ui/src/lib/utils.ts` | `cn()` helper (`clsx` + `tailwind-merge`) |
| `packages/ui/src/components/button.tsx` | shadcn Button, Shiroi variants |
| `packages/ui/src/components/card.tsx` | shadcn Card |
| `packages/ui/src/components/badge.tsx` | shadcn Badge — status colours per domain |
| `packages/ui/src/components/input.tsx` | shadcn Input |
| `packages/ui/src/components/label.tsx` | shadcn Label |
| `packages/ui/src/components/select.tsx` | shadcn Select |
| `packages/ui/src/components/table.tsx` | shadcn Table |
| `packages/ui/src/components/dialog.tsx` | shadcn Dialog |
| `packages/ui/src/components/toast.tsx` | shadcn Toast + Toaster |
| `packages/ui/src/formatters.ts` | `formatINR()`, `shortINR()`, `toIST()`, `formatDate()` |
| `packages/ui/src/index.ts` | Barrel export for all above |
| `packages/ui/package.json` exports | Add `"./formatters"` and `"./globals.css"` exports |
| `apps/erp/tailwind.config.ts` | Extend from `@repo/ui/tailwind.config` |
| `apps/erp/src/app/globals.css` | Import `@repo/ui/globals.css` |
| `packages/ui/src/formatters.test.ts` | Vitest tests for all formatter functions |

### Tasks

- [ ] **7.1 — Install shadcn/ui and dependencies into `packages/ui`**
  ```bash
  cd packages/ui
  pnpm add tailwindcss class-variance-authority clsx tailwind-merge lucide-react
  pnpm add -D @types/node
  ```

- [ ] **7.2 — Write formatter tests (TDD — write before implementing)**

  Create `packages/ui/src/formatters.test.ts`:
  ```typescript
  import { describe, it, expect } from 'vitest';
  import { formatINR, shortINR, toIST } from './formatters';

  describe('formatINR', () => {
    it('formats whole rupees with Indian grouping', () => {
      expect(formatINR(123456)).toBe('₹1,23,456');
    });
    it('formats crores correctly', () => {
      expect(formatINR(10000000)).toBe('₹1,00,00,000');
    });
  });

  describe('shortINR', () => {
    it('formats crores', () => expect(shortINR(15000000)).toBe('₹1.5Cr'));
    it('formats lakhs', () => expect(shortINR(250000)).toBe('₹2.5L'));
    it('formats thousands', () => expect(shortINR(5000)).toBe('₹5K'));
    it('formats small amounts', () => expect(shortINR(500)).toBe('₹500'));
  });

  describe('toIST', () => {
    it('converts UTC timestamp to IST string', () => {
      // 2025-03-20T08:30:00Z = 14:00 IST
      const result = toIST('2025-03-20T08:30:00Z');
      expect(result).toContain('20 Mar 2025');
      expect(result).toContain('02:00 PM');
    });
  });
  ```

  Run: `cd packages/ui && pnpm run test`
  Expected: FAIL — `formatters` module not found

- [ ] **7.3 — Implement `packages/ui/src/formatters.ts`**
  ```typescript
  export function formatINR(amount: number): string {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency', currency: 'INR',
      minimumFractionDigits: 0, maximumFractionDigits: 2,
    }).format(amount);
  }

  export function shortINR(amount: number): string {
    if (amount >= 10_000_000) return `₹${(amount / 10_000_000).toFixed(1)}Cr`;
    if (amount >= 100_000)    return `₹${(amount / 100_000).toFixed(1)}L`;
    if (amount >= 1_000)      return `₹${(amount / 1_000).toFixed(0)}K`;
    return `₹${amount}`;
  }

  export function toIST(utcTimestamp: string): string {
    return new Date(utcTimestamp).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }

  export function formatDate(dateString: string): string {
    // dateString: 'YYYY-MM-DD'
    return new Date(dateString + 'T00:00:00+05:30').toLocaleDateString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
    });
  }
  ```

  Run: `cd packages/ui && pnpm run test`
  Expected: PASS — all formatter tests green

- [ ] **7.4 — Write Tailwind config with Shiroi brand tokens**

  Create `packages/ui/tailwind.config.ts`:
  ```typescript
  import type { Config } from 'tailwindcss';

  const config: Config = {
    darkMode: ['class'],
    content: ['./src/**/*.{ts,tsx}'],
    theme: {
      extend: {
        colors: {
          // Shiroi brand — from Brand Guide V6
          shiroi: {
            blue:         '#1B4F8A',
            orange:       '#F4821F',
            green:        '#27AE60',
            yellow:       '#F2C94C',
            red:          '#EB5757',
            gray:         '#4A4A4A',
            'light-gray': '#F5F5F5',
          },
          // shadcn CSS-var tokens
          border:      'hsl(var(--border))',
          input:       'hsl(var(--input))',
          ring:        'hsl(var(--ring))',
          background:  'hsl(var(--background))',
          foreground:  'hsl(var(--foreground))',
          primary: {
            DEFAULT:    'hsl(var(--primary))',
            foreground: 'hsl(var(--primary-foreground))',
          },
          secondary: {
            DEFAULT:    'hsl(var(--secondary))',
            foreground: 'hsl(var(--secondary-foreground))',
          },
          destructive: {
            DEFAULT:    'hsl(var(--destructive))',
            foreground: 'hsl(var(--destructive-foreground))',
          },
          muted: {
            DEFAULT:    'hsl(var(--muted))',
            foreground: 'hsl(var(--muted-foreground))',
          },
          accent: {
            DEFAULT:    'hsl(var(--accent))',
            foreground: 'hsl(var(--accent-foreground))',
          },
        },
        borderRadius: {
          lg: 'var(--radius)',
          md: 'calc(var(--radius) - 2px)',
          sm: 'calc(var(--radius) - 4px)',
        },
        fontFamily: {
          sans: ['Inter', 'system-ui', 'sans-serif'],
          mono: ['JetBrains Mono', 'monospace'],
        },
      },
    },
    plugins: [require('tailwindcss-animate')],
  };

  export default config;
  ```

- [ ] **7.5 — Create `packages/ui/src/globals.css` with CSS tokens**
  ```css
  @tailwind base;
  @tailwind components;
  @tailwind utilities;

  @layer base {
    :root {
      --background: 0 0% 100%;
      --foreground: 0 0% 29%;
      --primary: 213 67% 32%;
      --primary-foreground: 0 0% 100%;
      --secondary: 27 90% 54%;
      --secondary-foreground: 0 0% 100%;
      --muted: 0 0% 96%;
      --muted-foreground: 0 0% 45%;
      --accent: 27 90% 54%;
      --accent-foreground: 0 0% 100%;
      --destructive: 0 72% 63%;
      --destructive-foreground: 0 0% 100%;
      --border: 0 0% 89%;
      --input: 0 0% 89%;
      --ring: 213 67% 32%;
      --radius: 0.5rem;
    }
  }

  @layer base {
    * { @apply border-border; }
    body { @apply bg-background text-foreground; }
  }
  ```

- [ ] **7.6 — Install shadcn components one by one**
  ```bash
  cd apps/erp
  npx shadcn@latest init
  npx shadcn@latest add button card badge input label select table dialog toast
  ```
  Move generated components from `apps/erp/src/components/ui/` to `packages/ui/src/components/`.

- [ ] **7.7 — Create `packages/ui/src/lib/utils.ts`**
  ```typescript
  import { type ClassValue, clsx } from 'clsx';
  import { twMerge } from 'tailwind-merge';

  export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
  }
  ```

- [ ] **7.8 — Create `packages/ui/src/index.ts` barrel export**
  ```typescript
  export * from './components/button';
  export * from './components/card';
  export * from './components/badge';
  export * from './components/input';
  export * from './components/label';
  export * from './components/select';
  export * from './components/table';
  export * from './components/dialog';
  export * from './components/toast';
  export * from './lib/utils';
  export * from './formatters';
  ```

- [ ] **7.9 — Update `packages/ui/package.json` exports**
  ```json
  {
    "./*": "./src/*.tsx",
    "./index": "./src/index.ts",
    "./formatters": "./src/formatters.ts",
    "./globals.css": "./src/globals.css",
    "./lib/utils": "./src/lib/utils.ts"
  }
  ```

- [ ] **7.10 — Run all four gates**
  ```bash
  pnpm run check-types   # expected: 0 errors
  pnpm run lint          # expected: 0 warnings
  pnpm run test          # expected: all formatter tests pass
  ```

- [ ] **7.11 — Vivek reviews all files, then commit**
  ```bash
  git add packages/ui/
  git commit -m "step 7: design system — Shiroi brand tokens, shadcn/ui, formatters"
  git push
  ```

### Step 7 Review Checklist
- [ ] `formatINR(123456)` → `₹1,23,456` (Indian grouping, not Western)
- [ ] Brand blue `#1B4F8A` in Tailwind config matches Brand Guide V6
- [ ] All 8 shadcn components present in `packages/ui/src/components/`
- [ ] `pnpm run check-types` passes from monorepo root
- [ ] No `any` types in `packages/ui`

---

## Step 8 — Auth + App Shell

**What this produces:** Working login page, role-based middleware, persistent sidebar layout. Any authenticated employee can log in and sees a shell with role-filtered navigation.

### Files created/modified

| File | What it does |
|------|-------------|
| `apps/erp/src/app/(auth)/login/page.tsx` | Login form — email + password |
| `apps/erp/src/app/(auth)/layout.tsx` | Unauthenticated layout (centred, no sidebar) |
| `apps/erp/src/middleware.ts` | Session refresh on every request |
| `apps/erp/src/app/(erp)/layout.tsx` | Authenticated layout — sidebar + topbar |
| `apps/erp/src/components/sidebar.tsx` | Role-filtered nav links |
| `apps/erp/src/components/topbar.tsx` | User name, role badge, sign-out |
| `apps/erp/src/lib/auth.ts` | `getUser()`, `requireRole()`, `getUserProfile()` server helpers |
| `apps/erp/src/lib/roles.ts` | Nav config per role, role display names |
| `apps/erp/src/lib/roles.test.ts` | Tests for nav filtering per role |
| `apps/erp/src/app/(erp)/dashboard/page.tsx` | Placeholder — "Dashboard coming in Step 9" |

### Tasks

- [ ] **8.1 — Write role/nav tests**

  Create `apps/erp/src/lib/roles.test.ts`:
  ```typescript
  import { describe, it, expect } from 'vitest';
  import { getRoleLabel, navItemsForRole } from './roles';

  describe('getRoleLabel', () => {
    it('returns human label for founder', () => {
      expect(getRoleLabel('founder')).toBe('Founder');
    });
    it('returns human label for sales_engineer', () => {
      expect(getRoleLabel('sales_engineer')).toBe('Sales Engineer');
    });
  });

  describe('navItemsForRole', () => {
    it('founder sees all nav items', () => {
      const items = navItemsForRole('founder');
      expect(items.map(i => i.href)).toContain('/dashboard');
      expect(items.map(i => i.href)).toContain('/leads');
      expect(items.map(i => i.href)).toContain('/hr');
    });
    it('site_supervisor does not see HR nav', () => {
      const items = navItemsForRole('site_supervisor');
      expect(items.map(i => i.href)).not.toContain('/hr');
    });
    it('customer role has no nav items', () => {
      expect(navItemsForRole('customer')).toHaveLength(0);
    });
  });
  ```

  Run: `pnpm run test` — Expected: FAIL (roles.ts not found)

- [ ] **8.2 — Implement `apps/erp/src/lib/roles.ts`**
  ```typescript
  import type { Database } from '@repo/types/database';

  type AppRole = Database['public']['Enums']['app_role'];

  export const ROLE_LABELS: Record<AppRole, string> = {
    founder:         'Founder',
    hr_manager:      'HR Manager',
    sales_engineer:  'Sales Engineer',
    project_manager: 'Project Manager',
    site_supervisor: 'Site Supervisor',
    om_technician:   'O&M Technician',
    finance:         'Finance',
    customer:        'Customer',
  };

  export function getRoleLabel(role: AppRole): string {
    return ROLE_LABELS[role] ?? role;
  }

  export interface NavItem {
    label: string;
    href: string;
    icon: string;
    roles: AppRole[];
  }

  export const NAV_ITEMS: NavItem[] = [
    { label: 'Dashboard',   href: '/dashboard',   icon: 'LayoutDashboard', roles: ['founder', 'hr_manager', 'finance', 'sales_engineer', 'project_manager'] },
    { label: 'Leads',       href: '/leads',       icon: 'Users',           roles: ['founder', 'sales_engineer'] },
    { label: 'Proposals',   href: '/proposals',   icon: 'FileText',        roles: ['founder', 'sales_engineer'] },
    { label: 'Projects',    href: '/projects',    icon: 'HardHat',         roles: ['founder', 'project_manager', 'site_supervisor', 'finance'] },
    { label: 'Procurement', href: '/procurement', icon: 'ShoppingCart',    roles: ['founder', 'project_manager', 'finance'] },
    { label: 'Cash Flow',   href: '/cash',        icon: 'TrendingUp',      roles: ['founder', 'finance'] },
    { label: 'O&M',         href: '/om',          icon: 'Wrench',          roles: ['founder', 'om_technician', 'project_manager'] },
    { label: 'HR',          href: '/hr',          icon: 'UserCog',         roles: ['founder', 'hr_manager'] },
    { label: 'Inventory',   href: '/inventory',   icon: 'Package',         roles: ['founder', 'project_manager', 'finance'] },
  ];

  export function navItemsForRole(role: AppRole): NavItem[] {
    if (role === 'customer') return [];
    return NAV_ITEMS.filter(item => item.roles.includes(role));
  }
  ```

  Run: `pnpm run test` — Expected: PASS

- [ ] **8.3 — Create `apps/erp/src/middleware.ts`**
  ```typescript
  import { type NextRequest } from 'next/server';
  import { updateSession } from '@repo/supabase/middleware';

  export async function middleware(request: NextRequest) {
    return await updateSession(request);
  }

  export const config = {
    matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
  };
  ```

- [ ] **8.4 — Create `apps/erp/src/lib/auth.ts`**
  ```typescript
  import { createClient } from '@repo/supabase/server';
  import { redirect } from 'next/navigation';
  import type { Database } from '@repo/types/database';

  type AppRole = Database['public']['Enums']['app_role'];

  export async function getUser() {
    const op = '[getUser]';
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error) {
      console.error(`${op} Auth error:`, { message: error.message });
      return null;
    }
    return user;
  }

  export async function getUserProfile() {
    const op = '[getUserProfile]';
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data: profile, error } = await supabase
      .from('profiles')
      .select('id, role, full_name')
      .eq('id', user.id)
      .single();

    if (error) {
      console.error(`${op} Profile query failed:`, { code: error.code, message: error.message });
      return null;
    }
    return profile;
  }

  export async function requireAuth() {
    const user = await getUser();
    if (!user) redirect('/login');
    return user;
  }

  export async function requireRole(allowed: AppRole[]) {
    const profile = await getUserProfile();
    if (!profile) redirect('/login');
    if (!allowed.includes(profile.role as AppRole)) redirect('/dashboard');
    return profile;
  }
  ```

- [ ] **8.5 — Create login page `apps/erp/src/app/(auth)/login/page.tsx`**

  Server component renders a `LoginForm` client component. Form behaviour:
  - Email input (type="email", required), Password input (type="password", required)
  - Submit → `supabase.auth.signInWithPassword()` → success: `router.push('/dashboard')` → error: show inline error message below form
  - Uses `@repo/ui` Button, Input, Label, Card
  - "Shiroi Energy ERP" heading in `text-shiroi-blue` at top of card

- [ ] **8.6 — Create authenticated layout `apps/erp/src/app/(erp)/layout.tsx`**
  ```typescript
  import { requireAuth, getUserProfile } from '@/lib/auth';
  import { Sidebar } from '@/components/sidebar';
  import { Topbar } from '@/components/topbar';

  export default async function ERPLayout({ children }: { children: React.ReactNode }) {
    await requireAuth();
    const profile = await getUserProfile();
    return (
      <div className="flex h-screen bg-shiroi-light-gray">
        <Sidebar role={profile!.role} />
        <div className="flex flex-col flex-1 overflow-hidden">
          <Topbar profile={profile!} />
          <main className="flex-1 overflow-y-auto p-6">{children}</main>
        </div>
      </div>
    );
  }
  ```

- [ ] **8.7 — Create `apps/erp/src/components/sidebar.tsx`**

  Client component. Props: `{ role: AppRole }`. Renders:
  - "Shiroi Energy" name at top in `text-shiroi-blue font-bold`
  - `navItemsForRole(role)` as vertical links using `next/link`
  - Active link: `bg-shiroi-blue/10 border-l-2 border-shiroi-blue text-shiroi-blue`
  - Inactive: `text-shiroi-gray hover:bg-gray-100`
  - Fixed: `w-56 h-full bg-white shadow-sm`

- [ ] **8.8 — Create `apps/erp/src/components/topbar.tsx`**

  Client component. Props: `{ profile: { full_name: string; role: AppRole } }`.
  - Left: current page name from `usePathname()`
  - Right: `{profile.full_name}` + `Badge` with `getRoleLabel(profile.role)` + Sign Out button
  - Sign-out: `supabase.auth.signOut()` then `router.push('/login')`

- [ ] **8.9 — Create placeholder `apps/erp/src/app/(erp)/dashboard/page.tsx`**
  ```typescript
  export default function DashboardPage() {
    return (
      <div className="text-2xl font-semibold text-shiroi-blue">
        Dashboard — coming in Step 9
      </div>
    );
  }
  ```

- [ ] **8.10 — Run all four gates + manual test**
  ```bash
  pnpm run check-types && pnpm run lint && pnpm run test
  pnpm run dev
  ```
  Manual: `localhost:3000` → redirects to `/login` → log in with dev employee → sidebar shows role-correct nav → sign out → back to `/login`.

- [ ] **8.11 — Vivek reviews all files, commit**
  ```bash
  git add apps/erp/src/
  git commit -m "step 8: auth shell — login, middleware, sidebar, role-filtered nav"
  git push
  ```

### Step 8 Review Checklist
- [ ] No hardcoded credentials anywhere
- [ ] `requireAuth()` tested manually — unauthenticated request to `/dashboard` redirects to `/login`
- [ ] Sidebar correct for founder, sales_engineer, site_supervisor (spot check three roles)
- [ ] `customer` role gets empty sidebar — ERP login page should show "Access denied" for customers
- [ ] All roles typed against `Database['public']['Enums']['app_role']` — no string literals

---

## Step 9 — Founder Morning Dashboard

**What this produces:** First real data screen. Vivek opens at 8am and sees: cash-negative projects, pipeline value, proposals pending approval, projects with no daily report today, payroll countdown.

**Design:** Three-column layout. Dense tables, not cards. All data from live Supabase dev.

### Files created/modified

| File | What it does |
|------|-------------|
| `apps/erp/src/app/(erp)/dashboard/page.tsx` | Server component — parallel data fetch |
| `apps/erp/src/app/(erp)/dashboard/cash-alert-table.tsx` | `is_invested = true` projects |
| `apps/erp/src/app/(erp)/dashboard/pipeline-summary.tsx` | Lead + proposal pipeline value |
| `apps/erp/src/app/(erp)/dashboard/overdue-reports.tsx` | Projects with no report today |
| `apps/erp/src/app/(erp)/dashboard/pending-approvals.tsx` | Proposals awaiting founder approval |
| `apps/erp/src/lib/dashboard-queries.ts` | All Supabase queries for dashboard |
| `apps/erp/src/lib/dashboard-queries.test.ts` | Tests for helper functions |

### Tasks

- [ ] **9.1 — Write dashboard helper tests**

  Create `apps/erp/src/lib/dashboard-queries.test.ts`:
  ```typescript
  import { describe, it, expect } from 'vitest';
  import { daysUntilPayroll, classifyInvestment } from './dashboard-queries';

  describe('daysUntilPayroll', () => {
    it('returns days until 25th from March 10', () => {
      expect(daysUntilPayroll(new Date('2026-03-10'))).toBe(15);
    });
    it('returns negative days after 25th', () => {
      expect(daysUntilPayroll(new Date('2026-03-28'))).toBe(-3);
    });
  });

  describe('classifyInvestment', () => {
    it('marks negative position as invested', () => {
      expect(classifyInvestment(-50000)).toBe(true);
    });
    it('marks positive as not invested', () => {
      expect(classifyInvestment(10000)).toBe(false);
    });
  });
  ```

  Run: `pnpm run test` — Expected: FAIL

- [ ] **9.2 — Implement `apps/erp/src/lib/dashboard-queries.ts`**
  ```typescript
  import { createClient } from '@repo/supabase/server';
  import Decimal from 'decimal.js';

  export function daysUntilPayroll(today: Date = new Date()): number {
    const target = new Date(today.getFullYear(), today.getMonth(), 25);
    return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  }

  export function classifyInvestment(netCashPosition: number): boolean {
    return new Decimal(netCashPosition).lessThan(0);
  }

  export async function getCashNegativeProjects() {
    const op = '[getCashNegativeProjects]';
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('project_cash_positions')
      .select('project_id, net_cash_position, projects!inner(project_number, name, status)')
      .eq('is_invested', true)
      .order('net_cash_position', { ascending: true })
      .limit(10);
    if (error) {
      console.error(`${op} Query failed:`, { code: error.code, message: error.message });
      throw new Error(`Failed to load cash positions: ${error.message}`);
    }
    return data ?? [];
  }

  export async function getPipelineSummary() {
    const op = '[getPipelineSummary]';
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('proposals')
      .select('total_amount, status')
      .in('status', ['draft', 'sent', 'negotiating']);
    if (error) {
      console.error(`${op} Query failed:`, { code: error.code, message: error.message });
      throw new Error(`Failed to load pipeline: ${error.message}`);
    }
    const total = (data ?? []).reduce(
      (sum, p) => sum.add(new Decimal(p.total_amount ?? '0')),
      new Decimal(0)
    );
    return { count: data?.length ?? 0, totalValue: total.toNumber() };
  }

  export async function getProposalsPendingApproval() {
    const op = '[getProposalsPendingApproval]';
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('proposals')
      .select('id, proposal_number, total_amount, created_at, leads(full_name)')
      .eq('status', 'pending_approval')
      .order('created_at', { ascending: true });
    if (error) {
      console.error(`${op} Query failed:`, { code: error.code, message: error.message });
      throw new Error(`Failed to load pending approvals: ${error.message}`);
    }
    return data ?? [];
  }

  export async function getProjectsWithNoReportToday() {
    const op = '[getProjectsWithNoReportToday]';
    const supabase = await createClient();
    const today = new Date().toISOString().split('T')[0];
    const { data, error } = await supabase
      .from('projects')
      .select('id, project_number, name, daily_site_reports!left(report_date)')
      .eq('status', 'active')
      .not('daily_site_reports.report_date', 'eq', today);
    if (error) {
      console.error(`${op} Query failed:`, { code: error.code, message: error.message });
      throw new Error(`Failed to load overdue reports: ${error.message}`);
    }
    return data ?? [];
  }
  ```

  Run: `pnpm run test` — Expected: PASS

- [ ] **9.3 — Build `apps/erp/src/app/(erp)/dashboard/page.tsx`**
  ```typescript
  import { Promise } from 'global';
  import { getCashNegativeProjects, getPipelineSummary,
           getProposalsPendingApproval, getProjectsWithNoReportToday,
           daysUntilPayroll } from '@/lib/dashboard-queries';
  import { CashAlertTable } from './cash-alert-table';
  import { PipelineSummary } from './pipeline-summary';
  import { PendingApprovals } from './pending-approvals';
  import { OverdueReports } from './overdue-reports';

  export default async function DashboardPage() {
    const [cashProjects, pipeline, pendingApprovals, overdueReports] = await Promise.all([
      getCashNegativeProjects(),
      getPipelineSummary(),
      getProposalsPendingApproval(),
      getProjectsWithNoReportToday(),
    ]);
    const payrollDays = daysUntilPayroll();

    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-shiroi-blue">Good morning, Vivek</h1>
        {payrollDays >= 0 && payrollDays <= 5 && (
          <div className="rounded-md bg-shiroi-yellow/20 border border-shiroi-yellow px-4 py-2 text-sm font-medium">
            ⚠️ Payroll export due in {payrollDays} day{payrollDays !== 1 ? 's' : ''}
          </div>
        )}
        <div className="grid grid-cols-3 gap-6">
          <div className="col-span-2 space-y-6">
            <CashAlertTable projects={cashProjects} />
            <OverdueReports projects={overdueReports} />
          </div>
          <div className="space-y-6">
            <PipelineSummary pipeline={pipeline} />
            <PendingApprovals proposals={pendingApprovals} />
          </div>
        </div>
      </div>
    );
  }
  ```

- [ ] **9.4 — Build each sub-component**

  Each is a typed client component using `@repo/ui` Table, Card, Badge, and `shortINR`/`formatINR` from `@repo/ui/formatters`. No `any` types. Each has an empty state message. `CashAlertTable` rows show net position in red text; project name links to `/projects/[id]`.

- [ ] **9.5 — Run all four gates + manual test**
  ```bash
  pnpm run check-types && pnpm run lint && pnpm run test
  pnpm run dev
  ```
  Seed a cash-negative project and a pending approval in Supabase dev → verify they appear.

- [ ] **9.6 — Vivek reviews all files, commit**
  ```bash
  git add apps/erp/src/app/\(erp\)/dashboard/ apps/erp/src/lib/dashboard-queries.ts apps/erp/src/lib/dashboard-queries.test.ts
  git commit -m "step 9: founder morning dashboard — cash alerts, pipeline, overdue reports"
  git push
  ```

### Step 9 Review Checklist
- [ ] `Promise.all()` — all four queries run in parallel
- [ ] `decimal.js` for pipeline total sum
- [ ] Empty states shown when no data (no blank sections)
- [ ] Payroll alert only when 0–5 days away
- [ ] No financial amounts in console.log

---

## Step 10 — Lead Pipeline

**What this produces:** Full CRM. Lead list with filters, lead detail with activity history, creation form, status management. Sales engineers see all leads.

### Files

| File | What it does |
|------|-------------|
| `apps/erp/src/app/(erp)/leads/page.tsx` | Lead list — filters, search, table |
| `apps/erp/src/app/(erp)/leads/[id]/page.tsx` | Lead detail — activities, survey, docs |
| `apps/erp/src/app/(erp)/leads/new/page.tsx` | Lead creation form |
| `apps/erp/src/lib/leads-queries.ts` | Lead CRUD, activity, status queries |
| `apps/erp/src/lib/leads-queries.test.ts` | Tests for status transition validation |
| `apps/erp/src/components/leads/lead-status-badge.tsx` | Colour-coded status badge |
| `apps/erp/src/components/leads/lead-form.tsx` | Create/edit form (client component) |
| `apps/erp/src/components/leads/activity-feed.tsx` | Timeline of lead activities |

### Tasks (summary — detailed sub-plan generated at execution time)

- [ ] **10.1** — Write tests: valid status transitions (`new→qualified→proposal_sent→won/lost/disqualified`), phone normalisation
- [ ] **10.2** — Implement `leads-queries.ts`: `getLeads(filters)`, `getLead(id)`, `createLead()`, `updateLeadStatus()`, `addActivity()`
- [ ] **10.3** — Lead list page: searchable table (name, phone, source, status), filter bar, "New Lead" button
- [ ] **10.4** — Lead detail: header (name, phone, status badge, assigned to), activity feed, site survey section, documents list
- [ ] **10.5** — Lead creation form: all required fields, clear phone uniqueness error handling, source dropdown
- [ ] **10.6** — Status transition UI: dropdown showing only valid next states from current status
- [ ] **10.7** — Run all four gates + manual test
- [ ] **10.8** — Vivek reviews, commit: `"step 10: lead pipeline — list, detail, creation, status transitions"`

### Step 10 Review Checklist
- [ ] Phone uniqueness error shown clearly — maps the DB constraint error code to a human message
- [ ] `blacklisted_phones` checked at form submission level — rejected before DB insert
- [ ] Sales engineer sees all leads — RLS enforces this on the server
- [ ] `deleted_at IS NULL` filter applied — soft-deleted leads never appear
- [ ] `record_audit_log` entry verified in Supabase dashboard after each status change
- [ ] No `any` types; lead types from `@repo/types/database`

---

## Step 11 — Proposal Engine

**What this produces:** Full proposal creation — BOM line entry, PVWatts simulation with PVLib fallback, correction factor display (raw vs corrected), scope split, payment schedule with sum-to-100% validation, GST calc, founder approval gate.

**This is the most complex screen in Phase 1. It gets its own detailed sub-plan at execution time.**

### Files

| File | What it does |
|------|-------------|
| `apps/erp/src/app/(erp)/proposals/page.tsx` | Proposal list |
| `apps/erp/src/app/(erp)/proposals/new/page.tsx` | Multi-step creation wizard |
| `apps/erp/src/app/(erp)/proposals/[id]/page.tsx` | Proposal detail + approval |
| `apps/erp/src/lib/proposals-queries.ts` | Proposal CRUD, BOM, revision queries |
| `apps/erp/src/lib/proposal-calc.ts` | GST, margin, total calculations |
| `apps/erp/src/lib/proposal-calc.test.ts` | Tests for all financial calculations |
| `apps/erp/src/lib/pvwatts.ts` | PVWatts API + PVLib fallback |
| `apps/erp/src/lib/pvwatts.test.ts` | Tests for simulation result parsing |
| `apps/erp/src/components/proposals/bom-table.tsx` | Editable BOM line items |
| `apps/erp/src/components/proposals/correction-factor-view.tsx` | Raw vs corrected side-by-side |
| `apps/erp/src/components/proposals/payment-schedule.tsx` | Milestone % editor with live sum |
| `apps/erp/src/components/proposals/scope-split.tsx` | Shiroi/client/builder/excluded tagging |

### Tasks (summary)

- [ ] **11.1** — Write tests: GST equipment (5%), GST works contract (18%), margin %, sum-to-100% validation, correction factor 80% override threshold alert
- [ ] **11.2** — Implement `proposal-calc.ts` — `decimal.js` throughout, no native float arithmetic on amounts
- [ ] **11.3** — Implement `pvwatts.ts`: GET PVWatts with 8s timeout → on failure POST to `PVLIB_MICROSERVICE_URL` from env → return `{ monthly_kwh, annual_kwh }`
- [ ] **11.4** — BOM table: add/remove lines, live total recalc, correction factor column (raw | corrected | override)
- [ ] **11.5** — Payment schedule: milestone % inputs, live sum counter, "Must equal 100%" error when ≠ 100%
- [ ] **11.6** — Proposal detail: approve (founder only, above ₹10L), send to customer, view revision history
- [ ] **11.7** — Run all four gates + manual test
- [ ] **11.8** — Vivek reviews, commit: `"step 11: proposal engine — BOM, correction factors, GST, payment schedule"`

### Step 11 Review Checklist
- [ ] Zero native JS arithmetic on monetary amounts — all `decimal.js`
- [ ] PVWatts timeout at exactly 8000ms → PVLib fallback called
- [ ] `PVLIB_MICROSERVICE_URL` from env, never hardcoded
- [ ] DB trigger `trigger_validate_payment_schedule` fires and blocks non-100% schedules — verify in Supabase logs
- [ ] Proposals above ₹10L show `pending_approval` status to non-founders
- [ ] `record_audit_log` written on every proposal status change
- [ ] Correction factor override: reason field required, blank reason blocked at UI

---

## Step 12 — Project Lifecycle

**What this produces:** Project list and detail with milestones, QC gates, completion % tracking (from objective inputs), change orders, and delay log.

### Files

| File | What it does |
|------|-------------|
| `apps/erp/src/app/(erp)/projects/page.tsx` | Project list with status filters |
| `apps/erp/src/app/(erp)/projects/[id]/page.tsx` | Project detail with tab nav |
| `apps/erp/src/app/(erp)/projects/[id]/milestones/page.tsx` | Milestone tracker |
| `apps/erp/src/app/(erp)/projects/[id]/qc/page.tsx` | QC gate inspections |
| `apps/erp/src/lib/projects-queries.ts` | Project CRUD and sub-queries |
| `apps/erp/src/lib/completion-calc.ts` | Weighted completion % from milestone weights |
| `apps/erp/src/lib/completion-calc.test.ts` | Tests for completion % calculation |
| `apps/erp/src/components/projects/milestone-progress.tsx` | Visual milestone tracker |
| `apps/erp/src/components/projects/qc-gate-form.tsx` | QC checklist form |
| `apps/erp/src/components/projects/change-order-form.tsx` | Scope change form |

### Tasks (summary)

- [ ] **12.1** — Write tests: weighted completion % (delivery 15%, panels 25%, etc.), milestone sum-to-100% validation
- [ ] **12.2** — Implement `completion-calc.ts`
- [ ] **12.3** — Project list: active/on-hold/completed filters, search by project number/name
- [ ] **12.4** — Project detail: header (number, name, customer, PM, status), tab nav (Milestones | QC | Procurement | Cash | Documents)
- [ ] **12.5** — Milestones tab: visual tracker, each milestone shows calculated % and source inputs
- [ ] **12.6** — QC gate form: checklist items (JSONB Phase 1 — array of `{item, passed, notes}`), PM sign-off action
- [ ] **12.7** — Change order form: scope description, amount delta, new OTP flow trigger
- [ ] **12.8** — Run all four gates + manual test
- [ ] **12.9** — Vivek reviews, commit: `"step 12: project lifecycle — milestones, QC gates, completion tracking"`

### Step 12 Review Checklist
- [ ] CEIG block: advancing net metering without CEIG approval → DB trigger error → surface as clear user-facing error message
- [ ] IR test < 0.5 MΩ on commissioning report → critical service ticket auto-created → verify in Supabase dashboard
- [ ] Completion % is never an input — always computed from sub-components
- [ ] Tier 1 records: edit button shown. Tier 2 (>48h): "Request Correction" only. Tier 3: read-only with no edit affordance
- [ ] Delay responsibility (shiroi/client/vendor/discom/weather/ceig) always required before saving a delay entry

---

## Step 13 — Procurement

**What this produces:** PO creation and management, vendor DCs, GRN entry, three-way match, MSME payment compliance tracker.

### Files

| File | What it does |
|------|-------------|
| `apps/erp/src/app/(erp)/procurement/page.tsx` | PO list + MSME alert banner |
| `apps/erp/src/app/(erp)/procurement/po/new/page.tsx` | PO creation form |
| `apps/erp/src/app/(erp)/procurement/po/[id]/page.tsx` | PO detail — DC, GRN, payments |
| `apps/erp/src/lib/procurement-queries.ts` | PO/DC/GRN/three-way-match queries |
| `apps/erp/src/lib/msme-calc.ts` | Days-since-delivery, alert logic |
| `apps/erp/src/lib/msme-calc.test.ts` | Tests for MSME thresholds |
| `apps/erp/src/components/procurement/three-way-match.tsx` | PO vs DC vs GRN visual |
| `apps/erp/src/components/procurement/msme-alert-banner.tsx` | Red/amber MSME alert |

### Tasks (summary)

- [ ] **13.1** — Write tests: MSME day-count from delivery date, amber at Day 40, red at Day 44
- [ ] **13.2** — Implement `msme-calc.ts` and `procurement-queries.ts`
- [ ] **13.3** — PO list: MSME alert banner, filters by project/vendor/status
- [ ] **13.4** — PO creation: vendor select, project link, line items, soft-block if advance not received (PM override with confirmation modal)
- [ ] **13.5** — DC entry + GRN entry + three-way match display (qty comparison visual)
- [ ] **13.6** — Vendor payment form: individual entries to `vendor_payments` (date, method, reference per payment)
- [ ] **13.7** — Run all four gates + manual test
- [ ] **13.8** — Vivek reviews, commit: `"step 13: procurement — POs, three-way match, vendor payments, MSME tracking"`

### Step 13 Review Checklist
- [ ] Three-way match shows visual mismatch when PO qty ≠ DC qty ≠ GRN qty
- [ ] MSME Day 40 alert in PO list AND procurement page banner
- [ ] Each vendor payment is an individual `vendor_payments` row (not a PO total update)
- [ ] `trigger_update_po_amount_paid` verified: `purchase_orders.amount_paid` updates after payment entry
- [ ] Price book accuracy trigger: >5% divergence on 3+ purchases → `update_recommended = true`

---

## Step 14 — Project Cash Position Dashboard

**What this produces:** Company-level cashflow snapshot + per-project cash breakdown. The most important financial screen.

### Files

| File | What it does |
|------|-------------|
| `apps/erp/src/app/(erp)/cash/page.tsx` | Company cashflow snapshot |
| `apps/erp/src/app/(erp)/cash/[projectId]/page.tsx` | Per-project cash breakdown |
| `apps/erp/src/lib/cash-queries.ts` | Cash position and snapshot queries |
| `apps/erp/src/lib/cash-queries.test.ts` | Tests for cash calculations |
| `apps/erp/src/components/cash/cash-position-card.tsx` | Per-project invested/receivable |
| `apps/erp/src/components/cash/cashflow-chart.tsx` | Company cashflow chart (Recharts) |

### Tasks (summary)

- [ ] **14.1** — Write tests: `is_invested` classification, overdue invoice escalation day (Day 1/5/10/30)
- [ ] **14.2** — Implement `cash-queries.ts`
- [ ] **14.3** — Company cashflow page: total invested capital, total receivables, active outstanding POs, 6-month bar chart
- [ ] **14.4** — Per-project cash page: invoices issued vs paid, vendor payments made vs outstanding, net position, days since last payment
- [ ] **14.5** — Overdue invoice escalation view: Day 1/5/10/30 levels with action buttons
- [ ] **14.6** — Run all four gates + manual test
- [ ] **14.7** — Vivek reviews, commit: `"step 14: cash position dashboard — project and company level"`

### Step 14 Review Checklist
- [ ] `decimal.js` for all cash arithmetic
- [ ] `is_invested = true` matches `net_cash_position < 0` — verify against DB trigger output
- [ ] Overdue invoices: Day 1 = sales alert, Day 5 = manager, Day 10 = founder, Day 30 = legal flag
- [ ] Finance role sees all; PM sees only assigned projects (RLS enforced on server)

---

## Step 15 — HR Master

**What this produces:** Employee list, employee detail with role-gated compensation, leave management, attendance, Zoho payroll CSV export.

**Critical:** Salary data is the most sensitive data in the system. It must never appear in logs, must be hidden from unauthorised roles at the server component level (not just client).

### Files

| File | What it does |
|------|-------------|
| `apps/erp/src/app/(erp)/hr/page.tsx` | Employee list |
| `apps/erp/src/app/(erp)/hr/[id]/page.tsx` | Employee detail |
| `apps/erp/src/app/(erp)/hr/payroll/page.tsx` | Payroll export page |
| `apps/erp/src/lib/hr-queries.ts` | Employee, leave, compensation queries |
| `apps/erp/src/lib/payroll-export.ts` | Zoho CSV generation |
| `apps/erp/src/lib/payroll-export.test.ts` | Tests for CSV column order and format |
| `apps/erp/src/components/hr/leave-request-form.tsx` | Leave request with balance |
| `apps/erp/src/components/hr/compensation-view.tsx` | Salary — role-gated server component |
| `apps/erp/src/components/hr/certification-tracker.tsx` | Expiry warnings |

### Tasks (summary)

- [ ] **15.1** — Write tests: Zoho CSV column order (exact match to spec in Master Reference Section 12.5), payroll 25th countdown, certification 30-day warning threshold
- [ ] **15.2** — Implement `payroll-export.ts`: generates CSV with exact Zoho columns, filename `shiroi-payroll-YYYY-MM.csv`
- [ ] **15.3** — Implement `hr-queries.ts` with role check inside compensation query
- [ ] **15.4** — Employee list: name, role, joining date, certification status, leave balance summary
- [ ] **15.5** — Employee detail: personal info, certifications (red/amber/green by expiry), leave history, compensation section (server-gated by role)
- [ ] **15.6** — Leave management: request form, approval workflow, leave ledger view (immutable — no edit)
- [ ] **15.7** — Payroll export: input monthly variables, generate CSV, download, log to `payroll_export_files`
- [ ] **15.8** — Run all four gates
- [ ] **15.9** — Vivek reviews **compensation visibility logic first**, then all files, commit: `"step 15: HR master — employees, leave, payroll export"`

### Step 15 Review Checklist
- [ ] Compensation section gated at server component level using `requireRole(['founder', 'hr_manager'])` — not a client-side role check
- [ ] Salary amounts NEVER in console.log, error messages, or exception catches
- [ ] CSV column order matches Zoho spec exactly (test by importing a test CSV into Zoho dev account)
- [ ] Certification with `blocks_deployment = true` and expiry < 30 days: red warning on employee card
- [ ] Leave ledger: no edit/delete button — only view; corrections via reversal entry form
- [ ] Employee exit: `last_working_day` set → admin client disables Supabase Auth user that day

---

## Step 16 — Daily Site Reports (Online-First)

**What this produces:** Online-first daily report entry for site supervisors. Pre-populated fields, photo upload, 48h lock enforcement, Tier 2 correction workflow.

**Note:** Offline-first (WatermelonDB) is Phase 2. This is the online version only.

### Files

| File | What it does |
|------|-------------|
| `apps/erp/src/app/(erp)/projects/[id]/reports/page.tsx` | Report list for a project |
| `apps/erp/src/app/(erp)/projects/[id]/reports/new/page.tsx` | New report form |
| `apps/erp/src/app/(erp)/projects/[id]/reports/[reportId]/correction/page.tsx` | Tier 2 correction form |
| `apps/erp/src/lib/site-report-queries.ts` | Report CRUD, lock check, correction queries |
| `apps/erp/src/lib/report-lock.ts` | `isLocked(report)` — >48h from `report_date` |
| `apps/erp/src/lib/report-lock.test.ts` | Tests for 48h lock boundary |
| `apps/erp/src/components/reports/report-form.tsx` | Pre-populated form |
| `apps/erp/src/components/reports/photo-upload.tsx` | Supabase Storage upload |

### Tasks (summary)

- [ ] **16.1** — Write tests: `isLocked()` at exactly 48h boundary (not 47h59m), pre-population defaults
- [ ] **16.2** — Implement `report-lock.ts` and `site-report-queries.ts`
- [ ] **16.3** — New report form: date (today pre-filled), project (pre-selected from assignment), workers (yesterday's count default), milestone inputs per completion model
- [ ] **16.4** — Photo upload: Supabase Storage to `projects/{projectId}/reports/{date}/`, path stored in `site_photos.storage_path`
- [ ] **16.5** — Report list: locked reports show padlock icon, edit only on unlocked
- [ ] **16.6** — Tier 2 correction form: mandatory reason, manager approval, `site_report_corrections` entry, original flagged `has_correction = true`
- [ ] **16.7** — Run all four gates + manual test
- [ ] **16.8** — Vivek reviews, commit: `"step 16: daily site reports — online-first, 48h lock, correction workflow"`

### Step 16 Review Checklist
- [ ] `report_date` stored as `'YYYY-MM-DD'` TEXT (not a timestamp)
- [ ] Photos in Supabase Storage — only path string in `site_photos.storage_path`
- [ ] Lock uses `report_date + 48h`, not `created_at`
- [ ] Correction approved by manager only — supervisor cannot approve their own correction
- [ ] Completion % not an input field — computed from checklist ticks by DB trigger

---

## Step 17 — Deployment Setup

**What this produces:** Vercel connected to GitHub, git branching active, `erp.shiroienergy.com` live, Sentry monitoring.

### Tasks

- [ ] **17.1** — Vercel: connect `shiroi-erp` GitHub repo, root = `apps/erp`, add all prod env vars via Vercel dashboard
- [ ] **17.2** — Git branching:
  ```
  main     → production (auto-deploy)
  staging  → Vercel preview
  feature/* → Vercel preview per branch
  ```
- [ ] **17.3** — Branch protection on `main`: require PR + review before merge
- [ ] **17.4** — Install Sentry:
  ```bash
  pnpm add @sentry/nextjs
  ```
  Configure DSN from env var `SENTRY_DSN` — never hardcoded.
- [ ] **17.5** — Test: push to `main`, Vercel builds, login works against prod Supabase
- [ ] **17.6** — Custom domain: `erp.shiroienergy.com` → Vercel settings

### Step 17 Review Checklist
- [ ] Prod Supabase URL and secret key in Vercel env vars only — zero committed files contain them
- [ ] `main` branch protected — direct push blocked
- [ ] `pnpm run build` succeeds with zero errors before first prod deploy
- [ ] Sentry DSN from `SENTRY_DSN` env var, not `.env.local`

---

## Step 18 — Data Migration

**What this produces:** All historical data imported in mandatory sequence: 100 projects with actuals first (seeds BOM correction factors), then HubSpot leads + proposals, then 500 commissioning-only projects.

**Sequence is mandatory.** Never migrate HubSpot data before actuals — correction factors must come from real project actuals, not from HubSpot estimate data.

### Files

| File | What it does |
|------|-------------|
| `scripts/migrate-projects-actuals.ts` | 100 projects with full actuals → `project_profitability`, `project_cost_variances` |
| `scripts/migrate-hubspot-leads.ts` | HubSpot CSV → `leads` + `proposals` |
| `scripts/migrate-commissioning.ts` | 500 projects → `plants`, `commissioning_reports` |
| `scripts/migration-utils.ts` | `normalizePhone()`, `deduplicateByPhone()`, `--dry-run` flag |
| `scripts/migration-utils.test.ts` | Tests for dedup logic, phone normalisation |

### Tasks (summary)

- [ ] **18.1** — Write tests: phone normalisation (strip +91, spaces, dashes → 10 digits), dedup detection, dry-run mode (no DB writes, only logs counts)
- [ ] **18.2** — Implement `migration-utils.ts`
- [ ] **18.3** — Vivek exports HubSpot CSV → Claude maps columns → implement `migrate-hubspot-leads.ts`
- [ ] **18.4** — Dry-run HubSpot migration → review log → run against dev Supabase → verify counts
- [ ] **18.5** — Implement `migrate-projects-actuals.ts` → run → verify `bom_correction_factors` seeded
- [ ] **18.6** — Implement `migrate-commissioning.ts` → run → verify plants and customer records
- [ ] **18.7** — Run all migrations against prod Supabase after dev verified
- [ ] **18.8** — Vivek reviews output, confirms counts, commit: `"step 18: data migration — HubSpot, 100 actuals, 500 commissioning"`

### Step 18 Review Checklist
- [ ] All scripts have `--dry-run` flag — mandatory before any prod run
- [ ] Duplicate phone: rejected with log entry (not silent skip)
- [ ] `bom_correction_factors` has entries after actuals migration — verify in Supabase dashboard
- [ ] Historical `created_at` dates preserved (not set to migration run time)
- [ ] HubSpot migration idempotent — running twice does not create duplicate records

---

## Master Review — Spec Coverage

| Master Reference Requirement | Step |
|-----------------------------|------|
| `decimal.js` for all money | 9, 11, 14 (explicit); formatter tests in 7 |
| Named `[op]` error handling | Every `lib/*.ts` file in 8–18 |
| RLS via server client | All steps use server client; admin client only in migration scripts |
| Salary fields never logged | Step 15 checklist |
| CEIG trigger block | Step 12 checklist |
| IR auto-ticket (< 0.5 MΩ) | Step 12 checklist |
| Sum-to-100% payment schedule | Step 11 checklist |
| Sum-to-100% milestone weights | Step 12 — `completion-calc.test.ts` |
| MSME 45-day compliance | Step 13 — `msme-calc.ts` |
| Three-way match | Step 13 |
| Tier 1/2/3 immutability | Steps 12, 15, 16 |
| Three surfaces | Phase 1 = ERP only; mobile/customer = Phase 2 |
| PVWatts + PVLib fallback | Step 11 — `pvwatts.ts` |
| Sentry | Step 17 |
| Vercel + git branching | Step 17 |
| Document numbering (RPC) | Steps 11, 12 — invoked via Supabase RPC |
| Supabase Storage for files | Steps 16, 18 |
| `@repo/supabase` factory only | Every step — no direct `@supabase/ssr` imports |
| Types from `@repo/types` | Every step — no `any` |
| Data migration sequence | Step 18 — actuals first, HubSpot second |

---

*Plan version: 1.0*
*Prepared: 2026-03-30*
*Spec: SHIROI_MASTER_REFERENCE_2_6.md*
*Awaiting Vivek approval before merge into Master Reference.*
