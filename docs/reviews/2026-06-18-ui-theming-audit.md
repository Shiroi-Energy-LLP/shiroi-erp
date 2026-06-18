# UI Theming Audit — How Centralized Are Colours & Fonts?

> Date: 2026-06-18 · Asked by Vivek alongside the redundancy sweep: *"How easy is it to change the UI? Are the colours etc from a central file or hardcoded in each page? Is it done properly?"*
> Method: read the theme sources + grep the whole app for colour literals and status/label maps.

## Bottom line

**The theming *system* is built correctly — but it's only about half-adopted.** There is a real central layer with **one canonical brand hue**, yet ~**1,000 hardcoded colour literals across ~163 files** sit on top of it, and status colour/label maps are copy-pasted instead of imported. So: changing the **gold brand hue** is ~3 edits and mostly propagates; changing a **neutral or any status colour** is a multi-file hunt. **Token layer: 5/5. Actual adherence: ~2.5/5.** The fix is mechanical, not architectural.

## 1. The central system (this part is good)

| Layer | File | Defines |
|---|---|---|
| shadcn CSS vars | `apps/erp/src/app/globals.css` | `--primary`/`--accent`/`--ring` (= gold `37 100% 44%`), `--background`/`--foreground`/`--border`/`--input`/`--destructive`, status vars (`--success/warning/error/…`), shadows |
| Tailwind tokens | `packages/ui/tailwind.config.ts` | `shiroi.gold*`/`ink`/`green*` brand scale, `n-*` warm-neutral scale (050–950), `status.*` palette, shadcn colours wired to `hsl(var(--…))`, font families |
| Fonts | `apps/erp/src/app/layout.tsx` | `next/font` → CSS vars consumed by Tailwind `fontFamily` |
| PDF brand | `apps/erp/src/lib/pdf/pdf-styles.ts` | `BRAND` token object — legitimately separate (`@react-pdf` can't read CSS vars) |

**One source of truth for the brand hue: yes.** Gold is defined once as `--primary`/`--accent`/`--ring` and once as `shiroi.gold` (plus the PDF copy). Semantic token classes (`bg-primary`, `text-shiroi-gold*`, `border-border`) are genuinely used — **141× across 73 files**. The Solar Gold rebrand proved the central layer works.

## 2. But ~1,000 hardcoded colours remain (the gap)

**Total: ~1,007 colour literals outside the theme files** — 971 hex in `.tsx` (163 files), 18 in `pdf-styles.ts` (legit), 22 `rgb/rgba/hsl` (mostly shadows, minor).

**(a) Neutrals/gold hardcoded that already have a token — the bulk (~600):**

| Hardcoded hex | Token it duplicates | Occurrences / files |
|---|---|---:|
| `#7C818E` | `text-n-500` | 264 / 60 |
| `#1A1D24` | `text-n-950` (and it's an *off-palette* cool-grey from before the warm rebrand) | 180 / 86 |
| `#B45309` | `text-shiroi-gold-dark` | 88 / 52 |
| `#3F424D` | `text-n-700` | 78 / 34 |
| `#F8F9FA`/`#DFE2E8`/… | `bg-n-050/100`, `border-n-200` | 78 / 34 |

Worst single file: `app/(erp)/procurement/[poId]/page.tsx` (~25 inline hexes).

**(b) Status colours — centralized in tokens that nobody imports.** The success/warning/error palette exists in `globals.css`, Tailwind `status.*`, and PDF `BRAND` — yet components re-type the hexes inline (status-green `#16A34A`/`#15803D`/… alone appear **36× across 22 files**).

**(c) Legitimately one-off (~110, fine):** the SVG logo (`packages/ui/src/components/logo.tsx`), PDF `pdf-styles.ts`, chart slice fills, `rgba()` shadows.

## 3. Status colour/label maps are duplicated

Five separate inline colour maps, several covering the same entity with **different** hexes:
- `STATUS_COLORS` in `data-table.tsx:40` (leads+proposals+projects) vs `STATUS_PALETTE` in `lead-status-badge.tsx:12` — the same `won` status renders **two different greens** depending on screen.
- `STATUS_COLORS` in `step-boq.tsx:33`, `TNEB/CEIG_STAGE_STYLES` in `liaison-status-badge.tsx`, and a hand-copied mirror in `projects-summary-header.tsx:4` (comment literally says "mirror the list's status badges").

Label maps duplicated across files: `MILESTONE_LABELS` ×4, `LEAVE_TYPE_LABELS` ×3, `PROFILE_LABELS` ×3, `SYSTEM_TYPE_LABELS` ×2.

**The model to copy (already done right):** `project-status-badge.tsx` (status→semantic `Badge` variant, zero hex) and `leads-helpers.ts` `STAGE_LABELS` (single source, imported by 5+ components). *(This sweep just made `project-status-badge` import its labels from `project-status-helpers` — one duplicate removed.)*

## 4. "Can I change a colour in one place?"

- **Gold brand hue — almost.** Edit `--primary`/`--accent`/`--ring` (globals.css) + `shiroi.gold` (tailwind) + `BRAND.gold` (pdf) = 3 edits flips most of the UI. *But* the ~88 hardcoded `#B45309` gold-dark links would stay old.
- **Neutrals / any status colour — no.** You'd edit the token *and* find-replace across 30–86 files and reconcile the 5 disagreeing status palettes. Effectively a multi-hour sweep.

## 5. Recommended fix (mechanical — offered, not yet done)

1. **Codemod the recurring hexes to their existing tokens:** `#7C818E→n-500`, `#1A1D24→n-950`, `#B45309→shiroi-gold-dark`, `#3F424D→n-700`, the `#F*` greys→`n-0xx`. (~600 occurrences; high-confidence find/replace, verify per-file.)
2. **Lift the 5 status colour maps + the duplicated label maps into `*-constants.ts`** and import them (the `leads-helpers.STAGE_LABELS` model). Reconcile the two disagreeing `won` greens to the token.
3. **Add an ESLint guard** (`no-restricted-syntax` on `className` containing `text-[#`/`bg-[#`/`border-[#`) so it can't regress.

This is a sizeable but low-risk codemod (colours only, no logic). It would take the brand from "3-edit gold change" to a true "change-it-in-one-place" system. Say the word and I'll do it as its own reviewed batch.
