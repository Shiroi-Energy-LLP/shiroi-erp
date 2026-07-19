# design-sync notes — @repo/ui → "Shiroi Energy Design System"

Project: `Shiroi Energy Design System` (projectId in config.json). This is the ONE
unified DS = the real shipped `@repo/ui` code. The older hand-authored
"Shiroi Energy Design" project (id `34211935-...`) is a design *recreation* kept
as an archive; do not sync into it.

## How this repo is set up (non-obvious)

- **No JS/CSS build ships in `packages/ui`** — it exports `.tsx` from `src/` and
  styles via Tailwind resolved at the host app's build time. `cfg.buildCmd`
  (`.design-sync/build.mjs`) synthesizes what the converter needs:
  1. `tsc` → `packages/ui/dist/*.{js,d.ts}` + a generated `dist/package.json`
     (name `@repo/ui`, `types`, `module`). This makes the converter treat
     `dist/` as the package root (PKG_DIR) with resolvable `.d.ts` — required
     for component discovery AND prop extraction. Run the converter with
     `--entry ./packages/ui/dist/index.js`.
  2. `tailwindcss` (via a wrapper config that adds a **token safelist**) →
     `dist/ds.css` = all utilities + shadcn `:root` vars + the three font CSS
     vars (`--font-ibm-plex-sans/-archivo/-rajdhani`) with system fallbacks.
     The safelist is essential: it forces the FULL brand/neutral/status token
     surface into the stylesheet so the design agent's new compositions render
     styled (not just the classes the 22 components happen to use).
- **`cfg.srcDir: "../src"`** points enrichment back at the real source (PKG_DIR
  is `dist/`).
- **Fonts** ship self-contained from `.design-sync/assets/fonts/` (Google Fonts
  IBM Plex Sans + Archivo variable, Rajdhani 500/600/700 static) via
  `cfg.extraFonts` → `.design-sync/assets/fonts.css`. Regenerating them needs
  network; the woff2 are committed so re-sync is offline.
- **componentSrcMap** excludes ~62 shadcn compound sub-parts (CardHeader,
  DialogContent, TableRow, …) from the component LIST — they stay on the runtime
  global for previews to compose, but each family ships as ONE root card with a
  composed preview.
- **Grouping** comes from `category:` frontmatter in `.design-sync/docs/<Name>.md`
  (6 groups). Those docs also enrich each `prompt.md` (props auto-append).
- **Overlays** (Dialog/Sheet/Tooltip/DropdownMenu) use `cfg.overrides.<Name>.cardMode`
  + a viewport, and their previews force `open` (+ `modal={false}`). Pagination
  is `cardMode: column` (wide). Dialog preview sets
  `onOpenAutoFocus={e=>e.preventDefault()}` to avoid a stray focus ring.

## Playwright

Render check uses playwright **1.61.0** (pins the cached chromium-1228 in
`~/.cache/ms-playwright`). Installed into `.ds-sync/`. The repo's own
`@playwright/test` is 1.59.1 (chromium 1217) — a mismatch, so install 1.61.0.

## Known render warns
- SkipToContent: sr-only until Tab focus → its preview shows a static focused
  gold-pill replica + caption + the live component. Graded good as an a11y utility.

## Re-sync risks / watch-list
- **Brand token drift (backlog):** shadcn `--primary` / `--accent` / `--ring` in
  `globals.css` are still the OLD green (`145 100% 35%`), while the brand is
  Solar Gold. `Badge` default was repointed to `bg-shiroi-gold` (2026-07-19);
  focus rings (`--ring`) and any remaining `bg-primary`/`bg-accent` usage are
  still green. Conventions header tells the agent to use `shiroi-gold`, not
  `primary`. If these tokens get repointed to gold in code, rebuild + re-sync.
- **Bespoke patterns not yet in code (backlog):** the old design project had
  KpiCard, DataTable (config wrapper), InfoBox, StageIndicator, FieldHint, plus
  conveniences (dot Badge, `required` asterisk, `CardLabel`, clickable Card).
  When added to `packages/ui`, they'll sync automatically as real components.
- **Ported (2026-07-19):** the old project's design-language docs → markdown
  guidelines (`.design-sync/guidelines/*.md`, via `cfg.guidelinesGlob`) covering
  brand foundations, colour, type/spacing, and voice. **Not ported:** the old
  project's ERP screen mockups + presentation templates — they're bound to the
  old bundle/tokens and would render broken; regenerate screens from the real
  components instead.
- Grades are carried-forward working state in `.cache/` (gitignored); durable
  verified-state lives in the uploaded `_ds_sync.json`.
