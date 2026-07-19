# Building with Shiroi Energy Design System

This is the **real, shipped** component library (`@repo/ui`) of the Shiroi Energy ERP — a solar-EPC operations tool. Every component here maps 1:1 to code the engineers ship. Build with these components, not hand-rolled lookalikes.

## Components

Import from the bundle: every export is on `window.ShiroiUI.<Name>` (in app code the same components import from `@repo/ui`). Compose the primitives — e.g. a table is `Table › TableHeader/TableBody › TableRow › TableHead/TableCell`; a card is `Card › CardHeader (CardTitle + CardDescription) › CardContent › CardFooter`. Read each component's `components/<group>/<Name>/<Name>.prompt.md` (usage) and `<Name>.d.ts` (prop contract) before using it.

## Wrapping & setup

Most components need no provider. Three exceptions:
- **Tooltip** — wrap the region in `TooltipProvider`, then `Tooltip › TooltipTrigger (asChild) + TooltipContent`.
- **Toast** — app-wide toasts use `ToastProvider` + the `useToast()` hook; a standalone `Toast` renders fine on its own.
- **Form** — spread a `useForm()` instance onto `<Form {...form}>`, then `FormField` (`control` + `name` + `render`) › `FormItem › FormLabel › FormControl › FormMessage`.

## Styling idiom — Tailwind utilities with these exact tokens

Components already carry their own classes. For your own layout/glue, use Tailwind utilities built on the DS tokens (do **not** invent hex values or new class names):

| Purpose | Classes |
|---|---|
| Brand fills / action | `bg-shiroi-gold` `text-shiroi-ink` (dark ink on gold — never white), hover `bg-shiroi-gold-hover`; links/eyebrows `text-shiroi-gold-dark`; brighter CTA `bg-shiroi-solar`; wash `bg-shiroi-solar-bg` |
| Neutrals (warm) | scale `n-050`…`n-950` → page `bg-n-050`, cards `bg-white`, body text `text-n-700`, muted `text-n-500`, borders `border-n-200`/`border-n-150`, dark surfaces (sidebar/table head) `bg-n-950`/`bg-n-900` |
| Status (soft tint + dark text) | `bg-status-success-bg text-status-success-text`, and `-warning-`, `-error-`, `-info-`, `-progress-`, `-neutral-` families (each has `-bg`/`-text`/`-border`) — green = live/healthy/paid |
| Radius | `rounded-md` (8px, inputs/buttons) · `rounded-lg` (12px, cards) · `rounded-full` (badges) |
| Shadows | `shadow-xs` → `shadow-lg` (soft, low-contrast) |
| Type | `font-sans` = IBM Plex Sans (body, figures) · `font-heading` = Archivo (headings, KPI values, table headers — often `uppercase tracking-wider` for labels) · `font-brand` = Rajdhani (the logo lockup only) |

**Caveat:** the shadcn `primary`/`accent`/`ring` tokens are still the *old green* — for the brand hue always use `shiroi-gold`/`shiroi-ink`, not `bg-primary`.

## Principles (from the brand)

95%-light workspace: gold is applied as thin accents (buttons, badges, active states, KPI numbers), never as large fills. Sentence case everywhere except eyebrows and table headers (uppercase). Indian formatting: ₹ lakh/crore, kW/kWh, "21 Mar 2025". No emoji — Lucide line icons only. Fixed status vocabulary (same state → same word + colour).

## Idiomatic example

```jsx
<Card className="max-w-sm">
  <CardHeader>
    <div className="flex items-center justify-between">
      <CardTitle>Sunrise Textiles — 110 kW</CardTitle>
      <Badge variant="warning">In progress</Badge>
    </div>
    <CardDescription>On-grid rooftop · Tiruppur · Net metered with TNEB</CardDescription>
  </CardHeader>
  <CardContent>
    <div className="text-[11px] text-n-500">Project value</div>
    <div className="font-heading text-lg text-n-900">₹58,20,000</div>
  </CardContent>
  <CardFooter className="gap-2">
    <Button variant="outline" size="sm">View project</Button>
    <Button variant="default" size="sm">Approve BOM</Button>
  </CardFooter>
</Card>
```
