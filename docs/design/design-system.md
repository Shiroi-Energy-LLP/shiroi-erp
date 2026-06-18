# Shiroi Energy — ERP Design System V3.0 · Solar Gold

## Version 3.0 · June 2026 · Development Handoff Reference

> **How to use this file**: This is the single source of truth for all ERP UI decisions. It supersedes V2.0 (eco-green). All token names map directly to the Tailwind theme in `packages/ui/tailwind.config.ts` and the shadcn CSS variables in `apps/erp/src/app/globals.css`. The reference bundle lives in `docs/design/solar-gold/`.

---

## V2 → V3 — The Solar Gold rebrand (June 2026)

The brand hue moves from **eco-green (`#00B050`)** to **Solar Gold (`#E08A00`)**, drawn from the sun in the logo. The decision rule that governs the whole system:

- **Brand / action = SOLAR GOLD.** Links, primary buttons, focus rings, active nav, active filters/tabs, brand icons, progress bars, selected/hover accents, drag-drop highlights, KPI accents, the eyebrow bar.
  - On coloured fills (buttons, active pills, badges): gold `#E08A00` with **dark ink text `#1F1709`** — never white (white-on-gold fails WCAG, ~2.4:1).
  - As text / links / icons on a white or light surface: use the darker **`#B45309`** (AA-compliant), not `#E08A00`.
- **Green is now a STATUS-ONLY signal.** Any green that means *success / won / converted / accepted / completed / delivered / paid / healthy / active / live / approved* stays green and migrates to the status tokens (`--success-*`, status green `#16A34A` / `#065F46`).
- **Fonts:** Archivo (headings/KPI/labels/table headers) · IBM Plex Sans (body, table cells, inputs, **and figures via tabular-nums** — its plain round zero replaces the old dotted-zero JetBrains Mono) · Rajdhani (brand lockup only).
- **Surfaces warm up:** page is warm cream `#FBF8F2`, borders/zebra are warm sand, the two dark surfaces (sidebar `#16130D`, table header `#221C12`) become a warm near-black. Layout, spacing, component structure and behaviour are unchanged — this was a token + font swap.

When you hit a legacy `#00B050`, ask: *brand action, or status?* Brand → gold. Status → green.

---

## V1 → V2 history — What Changed and Why (superseded, kept for context)

### Problem 1: Body text contrast failure

V1 used `#92AF95` text on dark green gradient backgrounds (`linear-gradient(150deg,#001F0D,#004D22,#007A38)`). This failed WCAG AA with a contrast ratio of only 3.2:1.

**V2 fix**: Dark green backgrounds are restricted to the sidebar only. All content-area text uses `#3F424D` (--n700) on white — contrast ratio 9.8:1. Body text is never placed on dark green gradients inside the ERP app.

### Problem 2: Amber labels on dark green

V1 used `#FACB01` amber for eyebrow labels and section markers on dark green sections. High saturation on high saturation created a "construction sign" feel.

**V2 fix**: Eyebrow labels used `#00B050` brand green on white backgrounds. Solar gold was `#F0B429` (warmer, less neon) and restricted to CTA buttons and specific warning emphasis only — never as label text on dark surfaces. *(V3 Solar Gold now makes gold the brand and reserves green for status — see the top of this file.)*

### Problem 3: Green-tinted neutrals

V1 neutrals were olive-green: `#92AF95`, `#668B6A`, `#456848`, `#2E4A32`. After 8 hours of use, the entire interface looked grey-green and caused visual fatigue.

**V2 fix**: Content-area neutrals are desaturated warm-grays. Green is applied intentionally as brand colour only, not baked into neutral surfaces.

### Problem 4: Aggressive heading typography

V1 used Oswald (condensed display face) in UPPERCASE for every heading. This is designed for billboards and marketing heroes, not for an everyday work tool.

**V2 fix**: DM Sans replaced Oswald for all ERP headings. No forced uppercase on headings — only labels and eyebrows use uppercase. *(V3 Solar Gold replaces DM Sans with Archivo and Inter with IBM Plex Sans — see the type scale below.)* Rajdhani remains for the brand name only.

### Problem 5: Dark green everywhere

V1 applied the dark green gradient to heroes, section backgrounds, sidebar, footer, and table headers — making the entire app feel like one heavy dark mass. Professional ERPs (Salesforce, Linear, Monday.com) are predominantly light.

**V2 principle (carried into V3)**: The ERP workspace is 95% white/off-white. Dark surfaces exist only in two places: the sidebar and data table headers — warmed in V3 to `#16130D` / `#221C12`. The brand colour appears as thin lines, icons, badges, and buttons — never as a large background fill inside the app.

---

## Design Tokens (CSS Variables)

```css
:root {
  /* ── BRAND (Solar Gold) ── */
  --brand:        #E08A00;   /* Primary fills — buttons, active nav, icons, accents */
  --brand-hover:  #C77606;   /* Button hover (darker gold) */
  --brand-dark:   #B45309;   /* Link text, eyebrows, emphasis on light — AA on white */
  --brand-deep:   #7A3D06;   /* Reserved — deep emphasis */
  --brand-night:  #1F1709;   /* Ink text on gold fills; warm near-black */

  /* Brand gold tints (translucent — active states / rings) */
  --brand-12:     rgba(224,138,0,.16);   /* Active nav background */
  --brand-08:     rgba(224,138,0,.08);   /* Selected table row */
  --brand-ring:   rgba(224,138,0,.22);   /* Input focus ring */

  /* ── SOLAR ACCENT (brighter marigold) ── */
  --solar:        #F0B429;   /* Solar CTA buttons, solar-themed glyphs */
  --solar-light:  #F7D070;   /* Solar hover-light */
  --solar-hover:  #E5A825;   /* Solar CTA hover */
  --solar-bg:     #FCF3E2;   /* Solar background tint (warm, very light) */

  /* ── NEUTRALS (warm sand/stone light end; warm near-black darks) ── */
  --n950: #16130D;   /* Sidebar background — warm near-black */
  --n900: #221C12;   /* Table header background — warm */
  --n800: #2D3039;   /* Heavy text (rarely used) */
  --n700: #3F424D;   /* Primary body text on white — high contrast */
  --n600: #5A5E6B;   /* Secondary text, descriptions */
  --n500: #7C818E;   /* Muted text, labels, captions, placeholders */
  --n400: #9CA0AB;   /* Disabled text, timestamps */
  --n300: #C2BBAE;   /* Border emphasis (hover), warm */
  --n200: #E5DFD3;   /* Default borders, dividers, input borders — warm */
  --n150: #EDE8DD;   /* Subtle borders, zebra stripe borders — warm */
  --n100: #F4F0E7;   /* Zebra stripes, input backgrounds, sunken — warm */
  --n050: #FBF8F2;   /* Content area background (lightest, warm cream) */
  --white: #FFFFFF;  /* Card backgrounds, header, modals, inputs */

  /* ── STATUS ── */
  --success-bg:     #ECFDF5;   --success-text:   #065F46;   --success-border: #A7F3D0;
  --warning-bg:     #FFFBEB;   --warning-text:   #92400E;   --warning-border: #FDE68A;
  --error-bg:       #FEF2F2;   --error-text:     #991B1B;   --error-border:   #FECACA;
  --info-bg:        #EFF6FF;   --info-text:      #1E40AF;   --info-border:    #BFDBFE;
  --progress-bg:    #FFF7ED;   --progress-text:  #9A3412;   --progress-border: #FED7AA;
  --neutral-bg:     #F3F4F6;   --neutral-text:   #4B5563;   --neutral-border: #D1D5DB;

  /* ── LAYOUT ── */
  --sidebar-expanded:  240px;
  --sidebar-collapsed:  60px;
  --header-height:      56px;
  --row-compact:        36px;
  --row-standard:       44px;    /* DEFAULT for all ERP tables */
  --row-comfortable:    56px;

  /* ── SPACING (8pt base) ── */
  --sp-1: 4px;   --sp-2: 8px;   --sp-3: 12px;  --sp-4: 16px;
  --sp-5: 20px;  --sp-6: 24px;  --sp-8: 32px;  --sp-10: 40px;
  --sp-12: 48px; --sp-16: 64px; --sp-20: 80px;

  /* ── RADIUS ── */
  --r-xs: 4px;   --r-sm: 6px;   --r-md: 8px;
  --r-lg: 12px;  --r-xl: 16px;

  /* ── SHADOW ── */
  --shadow-xs: 0 1px 2px rgba(0,0,0,.05);
  --shadow-sm: 0 1px 3px rgba(0,0,0,.08), 0 1px 2px rgba(0,0,0,.04);
  --shadow-md: 0 4px 6px -1px rgba(0,0,0,.07), 0 2px 4px -1px rgba(0,0,0,.04);
  --shadow-lg: 0 10px 15px -3px rgba(0,0,0,.07), 0 4px 6px -2px rgba(0,0,0,.03);

  /* ── MOTION ── */
  --transition-fast:   150ms cubic-bezier(.4,0,.2,1);
  --transition-std:    200ms cubic-bezier(.4,0,.2,1);
  --transition-slow:   250ms cubic-bezier(.4,0,.2,1);
}
```

---

## Typography

### Font Stack

| Font | Role | Google Fonts Load | Notes |
|---|---|---|---|
| **Archivo** | ERP headings (H1–H4), KPI values, card titles, labels/eyebrows, table headers | `Archivo:wght@400;500;600;700;800` | Replaces Archivo for all ERP headings. Grotesque sans, confident and legible. |
| **IBM Plex Sans** | Body text, captions, form inputs, table cells, descriptions **and all figures** (IDs, currency, capacity) via `tabular-nums` | `IBM+Plex+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400` | Primary body font. Its plain round zero replaces the old IBM Plex Sans dotted zero. Repointed as the `mono` family too. |
| **Rajdhani** | Brand name "SHIROI ENERGY" only | `Rajdhani:wght@500;600;700` | Never used for headings or UI text. Brand lockup only. |

**Tabular figures:** `body { font-variant-numeric: tabular-nums; }` is set globally so currency / capacity / ID columns align without a separate monospace family.

### Type Scale

| Style | Font | Size | Weight | Transform | Letter-spacing | Use |
|---|---|---|---|---|---|---|
| Brand name | Rajdhani | 14–32px | 700 | Uppercase | .08em | Sidebar lockup, footer |
| H1 Display | Archivo | 42px | 700 | None | -.02em | Page titles, hero text |
| H2 Section | Archivo | 28px | 700 | None | -.01em | Section headers |
| H3 Card | Archivo | 18px | 700 | None | 0 | Card titles, dialog titles |
| H4 Subtitle | Archivo | 14px | 600 | None | 0 | Sub-section headers |
| Body Regular | IBM Plex Sans | 14px | 400 | None | 0 | All body text, descriptions |
| Body Small | IBM Plex Sans | 13px | 400 | None | 0 | Table cells, form inputs |
| Caption | IBM Plex Sans | 11px | 400 | None | 0 | Timestamps, meta text, hints |
| Label / Eyebrow | Archivo | 10px | 700 | Uppercase | .14em | Section eyebrows, card labels |
| KPI Value | Archivo | 28px | 700 | None | -.02em | Dashboard KPI numbers |
| Figures | IBM Plex Sans | 12–28px | 500 | None | tabular-nums | IDs, currency (₹), capacity (kW) |

### Eyebrow Pattern

All section eyebrows follow this pattern: a 14px x 2px gold bar, 8px gap, then uppercase Archivo 10px/700 text in `--brand-dark` gold (`#B45309`).

```
──  OPERATIONS
```

---

## Component 01 — Navigation & Sidebar

| Property | Value |
|---|---|
| Background | `#16130D` (--n950, near-black, barely tinted) |
| Expanded width | `240px` |
| Collapsed width | `60px` |
| Header height | `56px` (--header-height) |
| Item height | `38px` — comfortable tap target |
| Active indicator | 3px left bar · `#E08A00` · rounded 0 2px 2px 0 |
| Active background | `rgba(224,138,0,.12)` |
| Active text | `#FFFFFF` (full white) |
| Default text | `rgba(255,255,255,.55)` |
| Hover text | `rgba(255,255,255,.85)` |
| Hover background | `rgba(255,255,255,.05)` |
| Section label | Archivo 9px/700 · uppercase · .16em · `rgba(255,255,255,.25)` |
| Icon size | 20px · Lucide outline · 40px touch target |
| Icon color (default) | `rgba(255,255,255,.55)` (matches text) |
| Icon color (active) | Full white (1.0 opacity) |
| Badge | min-width 18px · `rgba(224,138,0,.2)` bg · `#E08A00` text |
| Collapse transition | 200ms cubic-bezier(.4,0,.2,1) on `width` |
| Mobile behaviour | Hidden → slide-over drawer at <=900px |
| Z-index | `100` (below modals at 300) |
| Border right | `1px solid rgba(255,255,255,.06)` |

**Logo lockup**: 28px square with `--brand` background, rounded `--r-sm`, white Rajdhani initial "S". Brand name in Rajdhani 14px/700 uppercase, `rgba(255,255,255,.95)`.

**Section grouping**: Operations · Finance · Admin. Max 6 items per section. Never nest deeper than 2 levels.

**User footer**: 32px avatar square (brand green bg, white initials), name in IBM Plex Sans 12px/600, role in IBM Plex Sans 10px at `rgba(255,255,255,.35)`.

---

## Component 02 — Header Bar

| Property | Value |
|---|---|
| Height | `56px` |
| Background | `#FFFFFF` (--white) |
| Border bottom | `1px solid #E5DFD3` (--n200) |
| Shadow | `--shadow-xs` (0 1px 2px) |
| Page title | Archivo 16px/700 · `--n900` |
| Subtitle | IBM Plex Sans 12px · `--n500` |

**Search bar**: Pill-shaped (--r-md), background `--n100`, border `--n200`, placeholder in `--n500`. Keyboard shortcut badge Ctrl+K in a small pill.

**Header icons**: 36px square, `--r-md` radius, `--n600` icon colour, hover background `--n100`.

---

## Component 03 — Content Area & Page Layout

| Property | Value |
|---|---|
| Background | `#FBF8F2` (--n050) |
| Content padding | `24px` desktop · `16px` mobile |
| Card gap | `16px` |
| Section gap | `24px` between page sections |

**App shell**: `[sidebar 240px] [header 56px + content area]`

**Key principle**: Content area is always light. Cards are white (`#FFFFFF`) with `1px solid #E5DFD3` border and `--shadow-xs`. No dark green backgrounds in the content area, ever.

---

## Component 04 — KPI Cards (Dashboard)

```
+-----------------------------------+
| LABEL  (11px/600 uppercase --n500)    |
| VALUE  (28px Archivo 700 --n950)      |
|         optional UNIT (13px --n500)   |
| ^ TREND (11px/600 success/error)      |
| Sub-note (11px --n400)                |
+-----------------------------------+
```

| Property | Value |
|---|---|
| Background | `--white` |
| Border | `1px solid --n200` |
| Border radius | `--r-lg` (12px) |
| Padding | `18px 20px` |
| Shadow | `--shadow-xs` default → `--shadow-sm` on hover |
| Hover border | `--n300` |
| Grid | 4 columns desktop, 2 columns tablet, 1 column mobile |
| Trend up colour | `--success-text` (#065F46) |
| Trend down colour | `--error-text` (#991B1B) |

---

## Component 05 — Data Tables & Density

| Density Mode | Row Height | When to Use |
|---|---|---|
| Compact | `36px` | Power users, wide tables, read-only dashboards |
| **Standard** | **`44px`** | **Default for all Shiroi ERP tables** |
| Comfortable | `56px` | Client-facing reports, PDFs, presentations |

| Property | Value |
|---|---|
| Cell padding | `0 14px` vertical · height set on row |
| Header background | `#221C12` (--n900) |
| Header text | `#C2BBAE` (--n300) · Archivo 10px/700 · uppercase · .08em |
| Header corner radius | `--r-sm` on first and last `th` |
| Zebra striping | Odd rows: white · Even rows: `--n050` (#FBF8F2) |
| Hover state | `--n050` background |
| Selected row | `rgba(224,138,0,.08)` + 3px green left border |
| Text truncation | Ellipsis at `max-width:200px` · tooltip on hover |
| Inline actions | Hidden until row hover · max 3 (view / edit / more) |
| ID column | IBM Plex Sans 12px · `--brand-dark` · font-weight 600 |
| Client name | IBM Plex Sans 13px · font-weight 600 · `--n900` |
| Currency values | IBM Plex Sans 12px |
| Pagination | Bottom bar with `--n150` top border · showing count + page buttons |
| Table wrapper | White card with 0 padding, `--r-lg` radius, `--n200` border |
| Toolbar | Flex row above table with title + filter/export/create buttons |

---

## Component 06 — Form System

| Rule | Specification |
|---|---|
| Label placement | Always **above** field — never floating, never right-aligned |
| Label font | IBM Plex Sans 12px/600 · `--n700` |
| Required indicator | Red `*` after label text — `#DC2626` |
| Optional fields | No indicator |
| Input height | `36px` single-line · textarea: vertical resize only |
| Input font | IBM Plex Sans 13px · `--n900` |
| Default border | `1.5px solid #E5DFD3` (--n200) |
| Border radius | `--r-md` (8px) |
| Focus state | Border `#E08A00` + `box-shadow: 0 0 0 3px rgba(224,138,0,.22)` |
| Error state | Border `#DC2626` + `box-shadow: 0 0 0 3px rgba(220,38,38,.08)` |
| Disabled state | Background `--n050` · text `--n400` · cursor not-allowed |
| Hint text | IBM Plex Sans 11px · `--n500` |
| Error message | IBM Plex Sans 11px · `#DC2626` · below input |
| Multi-column | Max 2 columns desktop · always 1 column <=600px |
| Save Draft | Always available for complex forms (saves without validation) |
| Stepper max | 5 steps · always show all steps · completed = check |
| Validate on | Blur (per field) + Submit (all fields) |
| Focus on error | On submit with errors → focus first error field |

---

## Component 07 — Buttons

| Variant | Background | Text | Border | Hover |
|---|---|---|---|---|
| **Primary** | `#E08A00` | `#1F1709` (ink) | None | `#C77606` |
| **Secondary** | `#FFFFFF` | `#B45309` | `1.5px solid #E08A00` | `--solar-bg` background |
| **Ghost** | `#FFFFFF` | `--n700` | `1px solid --n200` | `--n050` bg + `--n300` border |
| **Danger** | `--error-bg` | `--error-text` | `1px solid --error-border` | Darker error-bg |
| **Solar CTA** | `#F0B429` | `--n950` | None | `#E5A825` |
| **Disabled** | `--n100` | `--n400` | `1px solid --n200` | cursor: not-allowed |

| Property | Value |
|---|---|
| Padding (default) | `8px 16px` |
| Padding (small) | `5px 10px` |
| Font | IBM Plex Sans 13px/600 (default) · 12px (small) |
| Border radius | `--r-md` (8px) |
| Transition | `--transition-fast` (150ms) |
| Press effect | `transform: scale(.97)` at 100ms |

---

## Component 08 — Status Badges

| Status | Background | Text Colour | Use For |
|---|---|---|---|
| Active / Success | `#ECFDF5` | `#065F46` | Active, Commissioned, Approved, Paid |
| Pending / Draft | `#FFFBEB` | `#92400E` | Pending, Draft, In Review, Awaiting |
| Warning / Progress | `#FFF7ED` | `#9A3412` | In Progress, Delayed, Action Required |
| Error / Fault | `#FEF2F2` | `#991B1B` | Fault, Failed, Rejected, Overdue |
| Info | `#EFF6FF` | `#1E40AF` | Net Metered, DISCOM Pending, Syncing |
| Neutral | `#F3F4F6` | `#4B5563` | Decommissioned, Archived, Inactive |

| Property | Value |
|---|---|
| Padding | `2px 8px` |
| Border radius | `99px` (full pill) |
| Font | IBM Plex Sans 10px/700 |
| Dot indicator | 5px circle, `currentColor` at 60% opacity, before text |

**Rule**: Same status always gets the same colour across every screen. Active is always green, Pending always amber. No exceptions.

---

## Component 09 — Modals & Drawers

| Pattern | Size | Use When |
|---|---|---|
| Modal — Confirm | 400px centred | Destructive actions: delete, close, reject |
| Modal — Form | 560px centred | Short forms (<6 fields) |
| Modal — Complex | 760px centred | Multi-field, preview+action, report generation |
| Modal — Full | 100vw/vh | Rich editors, document viewer, camera on mobile |
| Drawer — Detail | 480px right slide | View record alongside list (most common ERP pattern) |
| Drawer — Edit | 480–640px right | Quick-edit without navigating to full record page |
| Page navigation | — | Full CRUD on complex records → dedicated page |

**Modal animation**: 200ms ease-out · `opacity:0 + scale(.96)` → `opacity:1 + scale(1)`
**Drawer animation**: 250ms cubic-bezier(.4,0,.2,1) · `translateX(100%)` → `translateX(0)`
**Overlay**: `rgba(0,0,0,.5)` + `backdrop-filter:blur(2px)`

---

## Component 10 — Project Stage Indicator

Steps: Survey → Design → Installation → Inspection → Net Metering → Handover

| State | Visual |
|---|---|
| Active step (current) | **gold** `#E08A00` ring `box-shadow: 0 0 0 4px rgba(224,138,0,.15)` · gold fill + ink |
| Completed step | **status green** `#16A34A` fill · white check icon |
| Upcoming step | `--n200` fill · `--n500` text |
| Connector (completed) | **status green** `#16A34A` line |
| Connector (upcoming) | `--n200` line |

---

## Component 11 — Empty & Loading States

### Empty States

| Property | Value |
|---|---|
| Icon | Lucide icon · 48px · `opacity: .5` · `--n400` colour |
| Title | Archivo 18px/700 · `--n900` · describes what's missing |
| Description | IBM Plex Sans 13px · `--n500` · max 320px width · action-driven copy |
| CTA | Primary button if user can create · Ghost button if user can filter |
| Copy formula | `No [entity] yet → [action verb] your first [entity]` |

Never say "No data found" — always be specific to the context.

### Skeleton Loading

| Property | Value |
|---|---|
| Animation | Shimmer gradient sweep left→right · 1400ms · linear · infinite |
| Colours | `--n200` → `--n100` → `--n200` |
| Shape | Must exactly match the real content shape |
| Min display | 300ms (avoid flash on fast connections) |

---

## Component 12 — Toast & Notifications

| Type | Duration | Action |
|---|---|---|
| Success | 4 seconds | Optional: view, undo |
| Error | Persistent (user must dismiss) | Retry / review |
| Warning | 8 seconds | Raise ticket, view |
| Info | 4 seconds | Optional: view details |

| Property | Value |
|---|---|
| Position (desktop) | Top-right |
| Position (mobile) | Bottom-centre |
| Max visible | 3 simultaneously — queue others |
| Min width | 280px |
| Max width | 380px |
| Z-index | `500` |
| Animation | 300ms spring · translateY + opacity |
| Border radius | `--r-lg` (12px) |

---

## Component 13 — Icon System

**Library**: Lucide Icons (lucide.dev)
**Style**: Outline only · stroke-width: 2 · no filled icons
**Size**: 20px default · 16px in compact contexts · 24px for primary actions
**Colour**: Inherits from parent text colour

---

## Component 14 — Cards

| Property | Value |
|---|---|
| Background | `--white` (#FFFFFF) |
| Border | `1px solid --n200` (#E5DFD3) |
| Border radius | `--r-lg` (12px) |
| Padding | `20px` |
| Shadow | `--shadow-xs` |
| Hover shadow | `--shadow-sm` (where card is clickable) |
| Hover border | `--n300` (where card is clickable) |

### Card Label (section header inside card)

| Property | Value |
|---|---|
| Font | Archivo 10px/700 |
| Transform | Uppercase |
| Letter-spacing | .14em |
| Colour | `--n500` |
| Bottom border | `1px solid --n150` |
| Bottom padding | `10px` |
| Bottom margin | `14px` |

---

## Component 15 — Info Boxes

| Type | Background | Border-left | Text colour |
|---|---|---|---|
| Info (success context) | `--success-bg` | `3px solid #16A34A` | `--success-text` |
| Warning | `--warning-bg` | `3px solid #F0B429` | `--warning-text` |
| Error | `--error-bg` | `3px solid #DC2626` | `--error-text` |

All info boxes: `border-radius: 0 --r-sm --r-sm 0` · padding `12px 16px` · IBM Plex Sans 13px · line-height 1.6.

---

## Component 16 — Grid & Layout System

| Breakpoint | Width | Columns | Sidebar |
|---|---|---|---|
| Mobile XS | <480px | 4 | Hidden → Bottom tab bar |
| Mobile SM | 480–767px | 4 | Hidden → Drawer |
| Tablet | 768–1023px | 8 | 60px collapsed |
| Desktop | 1024–1439px | 12 | 240px expanded |
| Wide | >=1440px | 12 | 240px + max-width 1200px |

**App shell**: `[sidebar 240px] [header 56px + content area]`
**Content padding**: 24px desktop · 16px mobile
**Card gap**: 16px
**Section gap**: 24px between page sections

---

## Component 17 — Micro-interactions & Motion

| Interaction | Duration | Easing | Properties |
|---|---|---|---|
| Button hover | 150ms | ease-in-out | background-color |
| Button press | 100ms | ease-in | transform: scale(.97) |
| Input focus | 150ms | cubic-bezier(.4,0,.2,1) | border-color, box-shadow |
| Row hover | 100ms | ease | background-color |
| Sidebar collapse | 200ms | cubic-bezier(.4,0,.2,1) | width |
| Modal open | 200ms | ease-out | opacity + scale(.96→1) |
| Drawer slide | 250ms | cubic-bezier(.4,0,.2,1) | translateX |
| Toast appear | 300ms | spring | translateY + opacity |
| Skeleton shimmer | 1400ms | linear | background-position |
| Card hover | 150ms | ease | box-shadow, border-color |
| KPI card hover | 150ms | ease | box-shadow, border-color |

**Always**: `@media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }`

---

## Component 18 — Search, Filter & Query UI

| Property | Specification |
|---|---|
| Global search | `Ctrl+K` shortcut · cross-entity · top 5 results per category |
| Search bar style | Pill shape, `--n100` bg, `--n200` border, `--n500` placeholder |
| Column filter | Click header → filter panel → active filters as chips above table |
| Date range | Calendar picker · quick options: Today / This week / This month / This quarter |
| Saved filters | Named filter combinations per user · shareable via URL params |
| Result count | Always show "Showing X of Y [entities]" |

---

## Component 19 — File & Media UI

| Property | Value |
|---|---|
| Upload | Drag-and-drop zone · progress bar with cancel |
| Accepted types | PDF · JPG · PNG · XLSX · DWG |
| Max size | 10MB per file · 50MB per project |
| Versioning | Show version number · "v3 (latest)" badge |
| Delete | Confirmation required · soft delete (30 days recoverable) |
| Preview | In-browser for PDF + images · download for others |

---

## Component 20 — Bulk Operations

| Property | Specification |
|---|---|
| Select | Checkbox in each row + header checkbox (select/deselect all) |
| Action bar | Appears at top when >=1 row selected · `--n900` background |
| Actions | Assign Engineer · Change Status · Export · Generate Report · Send Reminder · Archive · Delete |
| Delete confirm | Requires typing `DELETE` to confirm when bulk deleting |

---

## Component 21 — Print & PDF Styles

| Property | Value |
|---|---|
| Page size | A4 · 210x297mm · portrait |
| Margins | Top 20mm · Right 15mm · Bottom 20mm · Left 20mm |
| Body font | IBM Plex Sans Regular 10pt · `--n900` · 1.4x leading |
| Section heading | Archivo Bold 14pt · `#B45309` (gold-dark on white) |
| Table font | IBM Plex Sans 9pt · dark header row · zebra |
| Watermark | Logo · 3% opacity · centred behind content |
| Footer | `--n900` bar · address + page X of Y |
| Page breaks | Never inside tables · never inside card sections |
| PDF generation | Server-side via Puppeteer/Playwright at `deviceScaleFactor:2` |

---

## Component 22 — Offline & Sync States

| State | Visual | User Action |
|---|---|---|
| Online synced | Green dot in nav footer | None |
| Syncing | Amber pulse dot + "Syncing..." | None — automatic |
| Offline queued | Yellow banner at top | Retry / view queued |
| Sync failed | Red banner + toast | Retry / discard |
| Conflict | Red dot + drawer | Choose: local / server / merge |

---

## Component 23 — Permissions & Lock States

| Rule | Detail |
|---|---|
| Hidden not disabled | Restricted elements are **not rendered** for lower roles — not greyed out |
| Locked records | `opacity: .7` + lock badge + `pointer-events: none` |
| Lock conditions | Paid invoice · Commissioned specs · Submitted government forms · Archived records |
| Unlock | Admin only · requires audit note · version history preserved |

---

## Component 24 — Undo & Audit Trail

### Undo Windows

| Action | Undo? | Method |
|---|---|---|
| Save/edit | Yes — 30 seconds | Toast undo button |
| Delete (soft) | Yes — 30 days | Trash bin → restore |
| Send email | No — delivered | Create correction/note |
| Status change | Yes — with note | Change back + note required |
| Financial correction | No | Journal/correction entry |
| Locked record | No (admin unlock) | Unlock → edit → re-lock |

### Audit Trail Fields (every change)

| Field | Format |
|---|---|
| Timestamp | DD MMM YYYY · HH:MM:SS IST |
| User | Name + role |
| Action | created / updated / deleted / status changed / sent |
| Field changed | Field name |
| Values | Old value → New value |

Audit trail is **read-only** · cannot be deleted · exportable as PDF by Admin.

---

## Component 25 — Data & Number Formatting

| Type | Format | Example |
|---|---|---|
| Currency (thousands) | `₹XX,XXX` | ₹85,400 |
| Currency (lakhs) | `₹X,XX,XXX` | ₹12,45,000 |
| Currency (compact) | `₹X.XX L` | ₹12.45 L |
| Currency (crores) | `₹X.XX Cr` | ₹1.24 Cr |
| Power (capacity) | `X kW` / `X.X MW` | 10 kW · 1.5 MW |
| Energy (monthly) | `X,XXX kWh` | 1,420 kWh |
| Energy (annual) | `X.XX MWh` | 17.04 MWh |
| CO2 | `XX.X tonnes CO2` | 16.8 tonnes CO2 |
| Percentage | `XX.X%` | 82.4% |
| Date (standard) | `DD MMM YYYY` | 21 Mar 2025 |
| Date (compact) | `DD/MM/YY` | 21/03/25 |
| Date (relative) | Plain English | 3 days ago · In 2 weeks |
| Time | 12h with AM/PM | 10:32 AM · 6:15 PM |

---

## Component 26 — Tasks & Activity Feed

**Task card fields:** Title · Assignee · Due date · Status badge · Priority
**Activity feed:** Chronological · newest first · system events + user comments
**@mentions:** Trigger notification to mentioned user
**Comment format:** Avatar + name + timestamp + message + edit (own comments, 5 min window)

---

## Dark Mode (Deferred to Phase 2)

When implemented, the dark mode will invert the content area only. The sidebar is already dark. Key mappings:

| Light Mode | Dark Mode |
|---|---|
| `--white` (#FFFFFF) card bg | `#221C12` (--n900) |
| `--n050` (#FBF8F2) page bg | `#16130D` (--n950) |
| `--n200` (#E5DFD3) borders | `#2D3039` (--n800) |
| `--n700` (#3F424D) body text | `#C2BBAE` (--n300) |
| `--n900` (#221C12) table header | `#2D3039` (--n800) |
| Status badge opacity | Reduced to 70% |
| Shadows | Replaced by border strokes |

Toggle: header icon · persisted in `localStorage` · default: respect `prefers-color-scheme: dark`.

---

## Chart Colours

Use brand gradient sequence for multi-series charts:

1. `#E08A00` (Brand gold)
2. `#0EA5C2` (Cyan — from the logo / grid + net metering)
3. `#16A34A` (Green — generation / healthy)
4. `#9333EA` (Purple)
5. `#EF4444` (Red)
6. `#F0B429` (Solar light)

For single-series charts, use `#E08A00` with `--solar-bg` as the area fill.

---

## Contact & Addresses

**Registered Address:**
No. 75/34, Rangeela Apartments, 3rd Floor, 3rd Main Road,
Kasturba Nagar, Adyar, Chennai - 600 020

**Mobile:** +91 94450 18787
**Email:** mail@shiroienergy.com
**Web:** www.shiroienergy.com

---

*Shiroi Energy ERP Design System · V3.0 Solar Gold · June 2026 · Confidential*
