# Brand foundations — Solar Gold

Shiroi Energy LLP is a solar EPC (engineering, procurement, construction) company in Chennai, Tamil Nadu — rooftop solar for residential, commercial, and industrial customers, plus net metering with TNEB and ongoing AMC. ~50 employees, 500+ projects completed. This design system is for the **Shiroi ERP** — the dense, professional internal tool that runs the business end to end.

## The defining principle: the workspace is 95% light

Colour is never a large background fill in the content area. The brand **solar gold** (`#E08A00`) is applied *intentionally* — thin lines, icons, badges, KPI accents, active states, and buttons. The two dark surfaces are the **sidebar** (`#16130D`) and **table headers** (`#221C12`), both a warm near-black tuned to the gold.

- **Gold fills carry dark ink text** (`#1F1709`), never white — white-on-gold fails contrast. Text links and eyebrows use the deeper `#B45309`.
- The brighter marigold `#F0B429` is the **solar accent** for highlights and solar-themed glyphs.
- **Green is no longer the brand hue** — it is reserved as a **status signal** (live / healthy / paid / generating).
- Backgrounds are **flat**: page `#FBF8F2` (warm cream), cards white. No gradients, images, textures, or patterns in the app chrome.
- Shadows are soft and low-contrast (four steps, `--shadow-xs` → `--shadow-lg`) — elevation, not drama.
- Borders are hairline warm neutral (`#E5DFD3` default, `#EDE8DD` subtle); inputs use a slightly heavier 1.5px border.

## Motion

Purposeful and quick: 150ms button hover / input focus, 200ms modal open (opacity + scale .96→1), 250ms drawer slide, 300ms toast. Standard easing `cubic-bezier(.4,0,.2,1)`. Buttons press to `scale(0.97)` for ~100ms. Everything respects `prefers-reduced-motion`.

## Iconography

**Lucide** outline icons only — `stroke-width: 2`, rounded caps, monochrome (inherit text colour). Sizes: 20px default, 16px compact, 24px primary actions. **Never emoji** — functional Unicode marks only (✓ ▲ ▼ → ⌘).
