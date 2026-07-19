# Color

Warm and optimistic, built around a single confident solar gold. Use the Tailwind token classes (`bg-`/`text-`/`border-`) — never raw hex.

## Brand (solar gold)
| Token | Hex | Use |
|---|---|---|
| `shiroi-gold` | `#E08A00` | Primary fills — buttons, active nav, icons, accents |
| `shiroi-gold-hover` | `#C77606` | Button hover (darker gold) |
| `shiroi-gold-dark` | `#B45309` | Link text, eyebrows, emphasis on light (AA on white) |
| `shiroi-ink` | `#1F1709` | Dark ink text ON gold fills |
| `shiroi-solar` | `#F0B429` | Solar CTA / highlights / solar glyphs |
| `shiroi-solar-bg` | `#FCF3E2` | Warm solar background tint |

## Neutrals (warm sand → warm near-black)
`n-050` `#FBF8F2` (page bg) · `n-100` `#F4F0E7` (zebra/sunken) · `n-150` `#EDE8DD` (subtle border) · `n-200` `#E5DFD3` (default border) · `n-300` `#C2BBAE` (hover border) · `n-500` `#7C818E` (muted text) · `n-600` `#5A5E6B` (secondary) · `n-700` `#3F424D` (body text) · `n-900` `#221C12` (table header) · `n-950` `#16130D` (sidebar). Cards are `white`.

## Status (soft tint bg + dark text — green = live/healthy)
Each has `-bg` / `-text` / `-border`: `status-success-*` (green — Active/Commissioned/Paid), `status-warning-*` (amber — Awaiting/Draft), `status-progress-*` (orange — In progress/Delayed), `status-error-*` (red — Fault/Overdue), `status-info-*` (blue — Net metered/Syncing), `status-neutral-*` (grey — Archived).

**Status language is fixed:** the same state always uses the same word *and* the same colour everywhere.

> ⚠️ The shadcn `--primary` / `--accent` / `--ring` tokens are still the pre-rebrand green. For the brand hue, use `shiroi-gold` / `shiroi-ink`, not `bg-primary`.
