# Handoff: Shiroi ERP — Solar Gold redesign

## Overview
Re-skin the Shiroi ERP from the old **eco-green V2** system to the new **Solar Gold** brand system. The brand colour moves from emerald green to **solar gold**, the heading/body fonts change, dark surfaces warm up, and **green is demoted from the brand hue to a status-only signal**. The logo is unchanged. Layout, spacing, component structure, and behaviour do NOT change — this is purely a visual token + font swap.

## About the design files
The HTML files in this bundle (`design-references/`) are **design references** — prototypes showing the intended look in the Solar Gold system. They are NOT production code to copy. Your task is to apply the token/font changes below to the **existing `shiroi-erp` Next.js + Tailwind + shadcn codebase**, using its established patterns. Most of the work is editing two theme files; the rest is a careful find-and-replace of inline hardcoded greens.

## Fidelity
**High-fidelity.** Exact hex/HSL values are specified below. Match them precisely.

---

## The decision rule that matters most

The old system used **one green (`#00B050`) for everything** — brand actions AND status. The new system splits them:

- **Brand / action green → SOLAR GOLD.** Links, primary buttons, focus rings, active nav, active filters, brand icons, progress bars, selected/hover accents, drag-drop highlights.
  - On coloured fills (buttons, chips, active pills): gold `#E08A00` with **dark ink text `#1F1709`** (never white — white on gold fails WCAG, ~2.4:1).
  - As text/links/icons on a white or light background: use the darker **`#B45309`** (AA-compliant), not `#E08A00`.
- **Status green STAYS green.** Any green that means *success / won / converted / accepted / completed / delivered / paid / healthy / active*, plus its tint backgrounds (`#F0FDF4`, `#f0faf4`, `#ECFDF5`, borders `#86EFAC`/`#BBF7D0`). These keep green — that is the new, intentional role for green. Migrate them to the `status.success-*` / `--success-*` tokens where practical.

When you hit a `#00B050`, ask: *is this a brand action, or a status?* Brand → gold. Status → leave green.

---

## 1. Theme tokens — `apps/erp/src/app/globals.css`

shadcn tokens are HSL tuples. Change the `:root` block:

| Token | Old | New | Note |
|---|---|---|---|
| `--primary` | `145 100% 35%` | `37 100% 44%` | gold `#E08A00` |
| `--primary-foreground` | `0 0% 100%` | `38 55% 8%` | dark ink `#1F1709` (was white) |
| `--accent` | `145 100% 35%` | `37 100% 44%` | gold |
| `--accent-foreground` | `0 0% 100%` | `38 55% 8%` | dark ink |
| `--ring` | `145 100% 35%` | `37 100% 44%` | gold |
| `--secondary` | `40 87% 55%` | `40 87% 55%` | unchanged (already solar marigold `#F0B429`) |
| `--background` | `220 20% 98%` | `40 33% 97%` | warm cream `#FBF8F2` |
| `--border` | `220 14% 89%` | `40 22% 86%` | warm `#E5DFD3` |
| `--input` | `220 14% 89%` | `40 22% 86%` | warm `#E5DFD3` |
| `--muted` | `216 19% 96%` | `40 35% 93%` | warm `#F4F0E7` |
| `--foreground`, `--card`, `--muted-foreground`, status & shadow vars | — | unchanged | keep |

Apply the same `--primary`/`--accent`/`--ring`/`--primary-foreground` changes to the `.dark` block for consistency (dark mode is deferred, but keep it coherent).

---

## 2. Color scales & fonts — `packages/ui/tailwind.config.ts`

### `colors.shiroi` — rename the brand to gold (or add gold keys and alias):
```
shiroi: {
  gold:        '#E08A00',   // was green   '#00B050'
  'gold-hover':'#C77606',   // was green-hover '#009945'
  'gold-dark': '#B45309',   // was green-dark  '#007A38'  (links/text on light)
  'gold-deep': '#7A3D06',   // was green-deep  '#004D22'
  ink:         '#1F1709',   // NEW — text on gold fills
  solar:       '#F0B429',   // unchanged
  'solar-light':'#F7D070',  // unchanged
  'solar-bg':  '#FCF3E2',   // was '#FEF8E7'
},
```
Keep the old `green*` keys as deprecated aliases pointing at `#16A34A` (a true status green) ONLY if some status code reads `shiroi-green`; otherwise remove them once the sweep (§4) is done.

### `colors.n` — warm the light end + dark surfaces:
```
'950': '#16130D',  // was #111318  (sidebar)
'900': '#221C12',  // was #1A1D24  (table header)
'800': '#2D3039',  // unchanged
'700': '#3F424D',  // unchanged
'600': '#5A5E6B',  // unchanged
'500': '#7C818E',  // unchanged
'400': '#9CA0AB',  // unchanged
'300': '#C2BBAE',  // was #BFC3CC
'200': '#E5DFD3',  // was #DFE2E8
'150': '#EDE8DD',  // was #EBEDF2
'100': '#F4F0E7',  // was #F2F4F7
'050': '#FBF8F2',  // was #F8F9FB
```
`colors.status.*` — unchanged.

### `fontFamily`:
```
sans:    ['var(--font-ibm-plex-sans)', 'IBM Plex Sans', 'system-ui', 'sans-serif'],  // was --font-inter / Inter
heading: ['var(--font-archivo)', 'Archivo', 'system-ui', 'sans-serif'],              // was --font-dm-sans / DM Sans
brand:   ['var(--font-rajdhani)', 'Rajdhani', 'system-ui', 'sans-serif'],            // unchanged
mono:    ['var(--font-ibm-plex-sans)', 'IBM Plex Sans', 'system-ui', 'sans-serif'],  // was JetBrains Mono — see note
```
**Numerals:** the old mono (JetBrains Mono) had a dotted zero the client disliked. The new system uses **IBM Plex Sans with tabular figures** for IDs/currency/capacity. Either repoint `mono` to IBM Plex Sans (above) so existing `font-mono` usages just work, OR keep a real monospace only for genuine code blocks. To align numeric columns, add tabular figures globally in `globals.css`:
```css
body { font-variant-numeric: tabular-nums; }
```

---

## 3. Fonts — `apps/erp/src/app/layout.tsx`

Replace the `next/font/google` imports:
```ts
// remove: Inter, DM_Sans, JetBrains_Mono
import { Archivo, IBM_Plex_Sans, Rajdhani } from 'next/font/google';

const archivo = Archivo({ subsets: ['latin'], weight: ['400','500','600','700','800'], variable: '--font-archivo' });
const ibmPlexSans = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400','500','600','700'], variable: '--font-ibm-plex-sans' });
const rajdhani = Rajdhani({ subsets: ['latin'], weight: ['500','600','700'], variable: '--font-rajdhani' });
```
Update the `<body className>` to use `${archivo.variable} ${ibmPlexSans.variable} ${rajdhani.variable}` and keep `font-sans antialiased`.

---

## 4. Inline hardcoded sweep (~150 `.tsx` files)

The codebase hardcodes the brand colour inline (`bg-[#00B050]`, `text-[#00B050]`, `ring-[#00B050]`, `border-[#00B050]`, `focus:ring-[#00B050]`, `shadow-[0_0_0_3px_rgba(0,176,80,0.1)]`, `hover:bg-[#009040]` / `#009A45` / `#007d38` / `#009945`, etc.). Apply the §0 decision rule:

**Brand-action greens → gold.** Replace per context:
- `bg-[#00B050]` (buttons/active pills) → `bg-[#E08A00]`, and set the text on it to `text-[#1F1709]` (replace any `text-white` on that element).
- `text-[#00B050]` / `hover:text-[#00B050]` (links, icons on light) → `text-[#B45309]` / `hover:text-[#B45309]`.
- `border-[#00B050]`, `ring-[#00B050]`, `border-t-[#00B050]` → `#E08A00`.
- focus rings `focus:ring-[#00B050]` → `focus:ring-[#E08A00]`; `shadow-[0_0_0_3px_rgba(0,176,80,0.1)]` → `shadow-[0_0_0_3px_rgba(224,138,0,0.22)]`; `focus-visible:border-[#00B050]` → `#E08A00`.
- green hover fills `#009040`, `#009A45`, `#009945`, `#007d38` → `#C77606`.
- `bg-[#00B050]/10`, `/5`, `/[0.04]`, `ring-[#00B050]/30` (tints) → same opacities on `#E08A00`.
- progress bars (`bg-[#00B050] rounded-full`), spinners (`border-t-[#00B050]`), `text-[#00B050]` KPI accents → gold.
- old neutral hexes if inline: `border-[#DFE2E8]` → `#E5DFD3`, `text-[#1A1D24]` headings stay (or `#221C12`).

**Status greens → leave green** (or migrate to status tokens). Do NOT goldify:
- `data-table.tsx` status maps `won/converted/accepted/completed` (`text:'#00B050'`, `bg:'#F0FDF4'`, `border:'#86EFAC'/'#BBF7D0'`) — keep green; optionally normalise text to `#16A34A`.
- `projects-summary-header.tsx` `completed` swatch, `step-boq.tsx` `delivered`, `boq-variance-form.tsx` `delivered`, `pm-donut-chart.tsx` `completed`, `step-execution.tsx` 100%-complete `#059669`, `milestones` `in_progress` bar, net-metering `approved` checks, `handover-pack`/`ai-narrative` success checks — these are status/health → keep green.
- `contacts/[id]` `customer: '#00B050'` and `activity-timeline` `meeting` colour are category colours — your call; gold is fine for "customer", keep distinct from status.

Recommended approach for Claude Code: do a repo-wide search for `00B050`, `0,176,80`, `009945`, `009040`, `009A45`, `007d38`, `007A38`, then resolve each hit with the rule above. Don't blind-replace — the status hits must stay green.

---

## 5. Verify
- `apps/erp/src/app/(erp)/dashboard` — greeting in Archivo, gold eyebrow, gold KPI/active-nav, warm `#221C12` table header, warm cream page, IBM Plex Sans cells with aligned figures.
- Primary buttons read as gold with dark text (not white).
- Status badges (paid/completed/won) are still green.
- Focus a form input → gold ring, not green.

## Design tokens (quick reference)
Gold `#E08A00` · gold-hover `#C77606` · gold-dark/links `#B45309` · ink-on-gold `#1F1709` · solar `#F0B429` · solar-bg `#FCF3E2` · status green `#16A34A`/`#065F46`. Sidebar `#16130D` · table header `#221C12` · page `#FBF8F2` · border `#E5DFD3` · zebra `#F4F0E7`. Fonts: Archivo (heading) · IBM Plex Sans (body + tabular figures) · Rajdhani (wordmark).

## Files in this bundle
- `design-references/Dashboard Directions.html` — the chosen Solar Gold direction (frame “A · Solar Gold”) vs. the old system.
- `design-references/Solar Gold — Type Pairings.html` — why Archivo was chosen.
- `design-references/Solar Gold — Table Type.html` — why IBM Plex Sans + clean zero for the table.
- `design-references/tokens/` — the design-system token CSS (colors.css, typography.css, fonts.css, elevation.css) as the source of truth for values.
