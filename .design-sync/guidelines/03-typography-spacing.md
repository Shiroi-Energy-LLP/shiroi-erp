# Typography & spacing

## Type — three families, strict roles
| Class | Family | Role |
|---|---|---|
| `font-heading` | **Archivo** | All headings, KPI values, card titles, eyebrows/labels, table headers. Industrial, engineered, confident. |
| `font-sans` | **IBM Plex Sans** | All body, table cells, inputs, captions, **and figures** (IDs, currency, capacity) — tabular figures so numeric columns align. |
| `font-brand` | **Rajdhani** | The "SHIROI ENERGY" brand lockup *only*, uppercase, tracked. Never UI text. |

Headings are **sentence case**. Uppercase is reserved for **eyebrows/labels and table headers** only (with wide letter-spacing). Never shout in body copy.

## Spacing — 8pt base
Content padding 24px desktop / 16px mobile · card gap 16px · section gap 24px · standard table row height **44px**.

## Radius
`rounded-md` 8px (inputs/buttons) · `rounded-lg` 12px (cards) · `rounded-full` badges · `rounded-sm` 6px · `rounded-xs` 4px.

## Layout
Fixed app shell — `[sidebar 240px (60px collapsed)] [header 56px + scrolling content]`. Wide screens cap content at ~1200px. Sidebar becomes a slide-over drawer below 900px.

## Elevation & focus
Cards: white, `border-n-200`, `rounded-lg`, `shadow-xs`; clickable cards lift to `shadow-sm` + `border-n-300` on hover. Inputs focus to a gold border + `0 0 0 3px rgba(224,138,0,.22)` ring. Selected table row: `rgba(224,138,0,.08)` + 3px gold left border. Even rows zebra `bg-n-050`.
