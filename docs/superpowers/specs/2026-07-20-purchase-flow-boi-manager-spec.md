# Purchase Flow — "Bill of Items Manager" Functional Spec (for ERP re-implementation)

> Extracted 2026-07-20 from the live Google Apps Script app ("Bill of Items Manager", server build
> `BOI-2026-07-16-R5-SERVER`, client build `BOI-2026-07-16-R5`) and its backing Google Spreadsheet
> ("Bill of Items", ID `1CsAYamXivIpqPJkKzum0vdkyfoKWBNUrv1C62wmktt8`).
> Purpose: the purchase team (Manivel, Keshav, site engineers) is fluent in this exact flow.
> The ERP replacement must preserve every behavior below unless explicitly renegotiated.
> Apps-Script auth plumbing (Google identity, PIN login, CacheService session tokens) is
> intentionally out of scope — the ERP has its own auth. Role semantics ARE in scope.

---

## 1. Roles & price visibility (cross-cutting — applies to every screen)

Roles: `Admin`, `Project Manager`, `Purchase Manager`, `Site Engineer`.

`PRICE_VISIBLE_ROLES = [Admin, Project Manager, Purchase Manager]`.

- **Server-side stripping, not CSS hiding.** For non-price-visible roles (i.e. Site Engineer) the
  server deletes these fields from every row before it leaves the backend:
  - Projects rows: `Project Budget`, `Bill of Items Budget`, `Expenses`, `Profit in %`
  - Price Book rows: `Rate`, `Gst`
  - BOI rows: `Rate`, `Amount`, `Gst`, `Total Amount`
  - (Vendor is NOT stripped anywhere.)
- **Every mutation** on Projects / Price Book / BOI / Expenses / POs requires a price-visible role
  ("You do not have permission to perform this action."). Users management requires `Admin`
  ("Only Admins can manage users.").
- Site Engineers get an entirely different UI (§11) — they never see the full app at all. Their only
  write path is a server function that resolves Rate/GST/Vendor from the Price Book server-side, so
  the client never supplies or receives pricing.
- Exports: "with price" export requires a price-visible role; "without price" export is open.

## 2. Screens / navigation

Left sidebar (collapsible; fixed overlay drawer + hamburger under 820px), dark-purple gradient,
active item highlighted with pink→purple gradient. Order:

1. **Projects** (default view on load)
2. **Price Book**
3. **Bill of Items** (all)
4. **Expenses**
5. **Purchase Orders**
6. — separator "STATUS VIEWS" —
7. **Yet to Finalize** / **Yet to Place** / **Order Placed** / **Received** / **Delivered**
   — each is the Bill of Items screen pre-locked to that one status (status filter hidden)
8. — separator "ADMIN" —
9. **Users** (visible to Admin only)

Main pane layout, top to bottom, identical on every view:
- **Topbar**: view title, transient save indicator ("Saving…", "Saved ✓", errors in red; auto-hides
  after ~1.8 s), sign-out button.
- **KPI row**: colored stat cards (per-view, see each section).
- **Filter row**: search inputs / dropdowns / action buttons (per-view).
- **View container**: a single card-styled table (`table-wrap`, sticky gradient header row, zebra
  rows, hover highlight, max-height 70vh with internal scroll).

Data loading: Projects + Price Book + BOI load in one batch on app start; Expenses, Purchase Orders,
and Users load lazily the first time their tab is opened and are cached until an explicit
"⟳ Refresh" (Expenses and POs each have one). Switching tabs clears the BOI multi-select.

Shared UI primitives:
- **Project combobox** — text input + live-filtered dropdown of all known project names (union of
  Projects sheet names and any project name already used on a BOI row). User can pick from the list
  OR type a brand-new name. Keyboard: arrows/Enter/Escape. Used by: BOI filter, BOI add/edit modal,
  bulk-add modal, Expenses filter, Expense modal, Site Engineer app.
- **Modal dialog** — 480px (760px for bulk-add), header + body + Cancel/Save footer. All "add new
  record" flows are modals; all single-field edits are inline in the table.
- **Inline edit** — clicking an editable cell (dashed purple outline on hover) swaps in an
  `<input>`; Enter/blur commits one field via a single-cell update call, Escape cancels. The server
  re-returns the recalculated row, which is patched into the client cache. Money cells strip
  `₹`/commas before editing. `Project Name` inline edits attach a datalist of known projects;
  `Engineer Name` a datalist of known engineers.
- **Select cells** — Status / Priority / GST% render as always-visible `<select>` dropdowns styled
  as colored badges; changing commits immediately (same single-cell update path).
- Status badge colors: Yet to Finalize = orange, Yet to Place = amber, Order Placed = blue,
  Received = violet, Delivered = green, Partialy Delivered = pink; Priority High = red /
  Medium = amber / Low = green.
- Deletes: single-row deletes use a browser `confirm()`; bulk delete and PO delete get an explicit
  warning about irreversibility.

## 3. Projects tab

Columns: Project Name · System Size · Status · Priority · Project Budget · Bill of Items Budget ·
Expenses · Profit % · Actions.

- **Editable inline**: Project Name, System Size (free text, e.g. "5 kW" — data has bare numbers
  like `50`, `9.9`), Project Budget (number). Status and Priority are badge-selects.
- **Computed (read-only, server-maintained)**:
  - `Bill of Items Budget` = SUM of `Total Amount` over all BOI rows whose Project Name matches
    (sheet formula `SUMIF('Bill of Items'!B:B, <name>, 'Bill of Items'!L:L)`).
  - `Expenses` = SUM of Expenses.`Amount` for the project (`SUMIF('Expenses'!B:B, <name>, 'Expenses'!G:G)`).
  - `Profit in %` = `Project Budget = 0 ? 0 : ROUND((Project Budget − (BOI Budget + Expenses)) / Project Budget × 100, 2)`.
  - Attempting to edit a computed field errors: "This field is calculated automatically and cannot
    be edited directly."
- **Status values** (Projects): `Yet to Place`, `Delivered`, `Partialy Delivered` (sic — keep the
  typo or migrate the data). Default on create: `Yet to Place`.
- **Priority values**: `High`, `Medium`, `Low`. Default: `Medium`.
- **Filters**: free-text search (matches Project Name + System Size), Status dropdown, Priority
  dropdown, Clear Filters. Search/table split so the search box never loses focus while typing.
- **KPIs** (over the filtered list): Projects (filtered) count · Total Project Budget ·
  Total BOI Cost · Total Expenses · Delivered count.
- **Row actions**: 🧾 jump to Bill of Items filtered to this project · 💰 jump to Expenses filtered
  to this project · 🗑 delete.
- **Add Project modal**: Project Name (required), System Size, Status, Priority, Project Budget (₹).
- **Delete rule**: deleting a project does NOT cascade — confirm text: "Delete this project? (Its
  Bill of Items rows will remain unless removed separately)". BOI/Expense rows keep the (now
  orphaned) project name and still appear in the project-name union list.
- Project identity everywhere is the **name string**, not the ID. Renaming a project inline does
  not rename its BOI/Expense rows.

## 4. Price Book tab

Columns: Category · Item · Make · Unit · Rate · Gst% · Vendor · Actions. (No Qty — it's a catalog.)

- All fields inline-editable (Category/Item/Make/Unit/Vendor as text, Rate as number, Gst as a
  badge-select of `0/5/12/18/28`). Any price-visible role can CRUD; Site Engineers get the list
  with Rate/Gst stripped (they see Item/Make/Unit/Category/Vendor).
- **Filters**: search (Item+Make+Vendor+Category), Category dropdown, Vendor dropdown (distinct
  vendors present in data), Clear Filters.
- **KPIs**: Total Items · Showing (filtered count) · Avg Rate.
- **Add modal**: Category (select), Item (required), Make, Unit (placeholder "Nos / Mtr / Set"),
  Rate (₹), Gst % (select), Vendor. No duplicate check — same Item can exist under several vendors
  (this is how vendor-price comparison works, e.g. the same inverter model listed under Festa
  Solar, Sunbridger, Southern Power at different rates).
- **Category options** (fixed list, shared with BOI):
  `Solar Panels, MMS, Inverter, Battery & Accessories, DC & Accessories, AC & Accessories,
  Earth & Accessories, Conduits, Safety & Accessories, I&C, Statutory Approvals, Local Expenses,
  Miscellaneous, Transport, Others`.
  Live data has drifted free-text variants (`Solar Panel` singular, `Earth & Access`,
  `Misscellaneous`, `Walkway`, `Handrail`) because inline edit is free text — the ERP should
  normalize on import but keep the canonical list above.
- **Units seen in data** (free text, no enum): `Nos` (dominant), `Meter`, `Wp` (per-watt panel
  pricing), `Pocket`, `Set`, `Length`, `Box`, `Lot`, `Unit`, `No`, `Mtr`, `Kg`, `KWp`.
- **Vendors seen in data** (free text): Green Field, Krishna Electricals, Southern Power,
  Sunbridger, Festa Solar, Shankeswar Electricals, KL Earthing, G - Nexter, Premier, Creative ECO,
  Uno Power, Hivesolar, Deekay Electricals, Vashi, Myk Enterprises, Thanigai Agencies, Inspire,
  Viridis (plus spelling drift: Shankheswar/Shankheshwar, Insipre Energy).
- Feeds BOI three ways: single-item autocomplete in the Add Item modal (§5.3), the bulk-add modal
  (§5.4), and the Site Engineer submission flow (§11).

## 5. Bill of Items tab (the working screen)

Columns: [select-checkbox] · Project · Category · Item · Make · Qty · Units · Status · Rate ·
Amount · Gst% · Total Amount · Vendor · Actions. Footer row: "TOTAL (filtered view)" =
Σ Total Amount of visible rows.

### 5.1 Fields & computation
- **Editable inline**: Qty (number), Rate (number), Vendor (text); Status and Gst% are
  badge-selects. Project/Category/Item/Make/Units are display-only in the table but editable via
  the row's ✏️ Edit modal (which is the same form as Add).
- **Computed (read-only)**: `Amount = Qty × Rate`; `Total Amount = ROUND(Amount × (1 + Gst/100), 2)`.
  Recomputed server-side immediately whenever Qty/Rate/Gst (or Project Name) changes.
- **Status values** (BOI): `Yet to Finalize` → `Yet to Place` → `Order Placed` → `Received` →
  `Delivered`. Default on create: `Yet to Finalize`. Semantics as used by the team:
  - *Yet to Finalize* — engineer/PM has listed the material; qty/vendor/rate not confirmed yet.
  - *Yet to Place* — finalized and approved for purchase; waiting for a PO.
  - *Order Placed* — set automatically when a PO is generated for the line (§6); can also be set
    manually via bulk status change.
  - *Received* — material arrived (store/office).
  - *Delivered* — material at site / consumed.
- **GST options**: `0, 5, 12, 18, 28` (%). Real data: panels/inverters 5%, BOS/electrical 18%.

### 5.2 Filters, status views, KPIs
- Filter row: Project combobox · Status dropdown (hidden when a Status View locks it) · Category
  dropdown · Vendor dropdown (distinct vendors in BOI data) · free-text search
  (Item+Category+Make+Vendor+Project) · Clear Filters · ⬇ Download Excel · ⬇ Download PDF ·
  📦 Add Multiple (Price Book) · + Add Item.
- The 5 sidebar Status Views are this same screen with the status pre-locked; all other filters
  still work there.
- **KPIs**: first card "Total Amount (filtered)"; then one card per BOI status showing the
  Σ Total Amount in that status *with every other active filter applied but ignoring the status
  filter itself* — i.e. a full status-wise money breakdown always visible (this is the team's
  at-a-glance pipeline: how much is yet to finalize / yet to place / ordered / received /
  delivered for the current project).

### 5.3 Add / Edit Item modal (single line)
Fields, in order:
1. Project Name — combobox, "search existing or type a new one" (required).
2. Item (search Price Book) — autocomplete over Price Book items (substring on Item, max 8 shown,
   each rendered as "**Item** — Make (₹Rate)"). **Picking a match auto-fills**: Category (mapped to
   the canonical list, falls back to `Others`), Make, Units (from PB `Unit`), Rate, Gst, Vendor.
   The user may also just type a free-form item name — Price Book linkage is a convenience, not a
   constraint; there is no FK.
3. Category (select), Make (text), Qty (number, default 1), Units (text), Status (select,
   default Yet to Finalize), Rate (₹), Gst % (select), Vendor (text) — **all remain editable after
   auto-fill** (rates get negotiated per-project).
Validation: Project Name and Item required. Save = insert or full-row update; afterwards project
totals refresh in the background.

### 5.4 "Add Multiple from Price Book" modal (bulk BOM assembly)
Large modal:
1. Project Name combobox (one project for the whole batch).
2. Default Status select (applied to all lines; default Yet to Finalize).
3. Price Book search box + checkbox list (first 50 matches; "+N more — refine your search").
4. "Selected Items (n)" panel: each checked item shows name/make/category/unit, a remove ✕, and
   per-item editable mini-fields **Qty** (default 1), **Rate ₹** (default PB rate), **GST %**
   (default PB gst). Category/Item/Make/Units/Vendor come from the PB row and are not editable
   here.
Save inserts all rows in one batch (single write + batch formulas — stays fast for 20–30 lines)
with the chosen status. Requires ≥1 item and a project name.

### 5.5 Multi-select & bulk actions
- Each row has a checkbox; header checkbox = select/deselect all *visible (filtered)* rows.
  Changing filters silently prunes now-hidden rows from the selection. Switching views clears it.
- When ≥1 selected, a **bulk action bar** appears above the table:
  `"N selected"` · Status dropdown + **Change Status** (confirm: "Change status of N item(s) to
  X?"; server updates all, returns fresh rows) · **📄 Create PO** (§6) · **🗑 Delete Selected**
  (confirm "This cannot be undone"; bottom-up row deletion) · **Clear Selection**.

## 6. Create Purchase Order flow (THE core flow)

Trigger: select BOI rows (any statuses, any projects) → bulk bar → **Create PO**.

### 6.1 The modal
- If the selected rows span **multiple vendors**, a red warning shows:
  "⚠ Selected items have different vendors (A, B). Consider creating separate POs per vendor, or
  set one vendor below to override." — it is a warning only; **one PO CAN span vendors** (the PO
  stores a single vendor string; per-line vendors are ignored on the document).
- Summary line: "N item(s) selected · Total ₹X" (Σ Total Amount of selection).
- Fields (all plain inputs, all optional):
  | Field | Prefill / default |
  |---|---|
  | Vendor | first distinct vendor among selected items |
  | Project Name | first distinct project among selected items |
  | Delivery Date | empty (date picker) |
  | Payment Terms | `"Credit"` |
  | Transport | `"At Actual"` |
  | Delivery Place | empty (placeholder "e.g. Site Office") |
  | ☑ Also save a copy to Google Drive | checked |

### 6.2 On Save (server, atomic sequence)
1. Items are **re-read from the sheet by ID** — client-sent prices are never trusted. Missing IDs
   → error.
2. Per line: `amount = Qty × Rate`; `gstAmt = amount × Gst/100`. Totals:
   `Subtotal = Σ amount`, `Gst Amount = Σ gstAmt`, `Net Amount = Subtotal + Gst Amount`.
   If every line shares one GST rate the PO shows "GST (18%)", otherwise just "GST".
3. **PO Number**: scan the existing `PO Number` column for the trailing integer of each value,
   take max, +1, format `PO-` + zero-padded-4 → `PO-0001`, `PO-0002`, … (gap-tolerant, resilient
   to manually typed numbers; a deleted PO's number CAN be reused if it held the max).
4. **PDF generated** (A4 portrait; company-purple styling):
   - Title "PURCHASE ORDER", subtitle = PO number.
   - Info grid: Project Name | Payment Terms // Vendor | Transport // Delivery Date | Delivery
     Place ("-" when blank).
   - Section "MATERIAL SPECIFICATION & COST BREAKDOWN": table S.No · Description
     (`Item — Make`) · Qty (`qty units`, right-aligned) · Unit Price · Total (₹, rounded to whole
     rupees, en-IN grouping).
   - Totals box (right-aligned): Subtotal / GST(x%) / **Net Amount**.
   - No company letterhead/address/GSTIN, no signature block, no per-line GST column, no vendor
     address — deliberately minimal. Filename: `<PO Number>.pdf`.
5. PDF is returned to the browser as an immediate download AND (if checked) saved to the Drive
   folder "Bill of Items Manager - Purchase Orders" (Drive failure never blocks the download;
   Drive URL stored on the log row when it works). ERP equivalent: Supabase Storage path.
6. A row is appended to the **Purchase Orders** log: ID, PO Number, Project Name, Vendor,
   Delivery Date, Payment Terms, Transport, Delivery Place, `Item IDs` (comma-joined BOI row IDs),
   Subtotal, Gst Amount, Net Amount, Created By (user email), Created At (`yyyy-MM-dd HH:mm`),
   Drive File Url.
7. **Every included BOI line's Status is flipped to `Order Placed`.**
8. Client: downloads the PDF, patches the updated BOI rows, clears the selection, marks the PO
   tab stale (so it refetches), toasts "PO-00NN created ✓ (saved to Drive)".

### 6.3 PO immutability
The PO's line items and amounts are **frozen at creation**. Editing a PO (§7) changes only its
metadata; there is no "regenerate PDF" and no line-item editing. Later BOI edits do not touch the
PO record.

## 7. Purchase Orders tab (history log)

Read-only log, most recent first. Columns: PO Number · Project · Vendor · Delivery Date ·
Net Amount · Created By · Drive Copy ("Open in Drive" link, or "Not saved") · Actions (✏️ / 🗑).

- **Filter**: one search box (PO number + project + vendor + created-by), Clear, ⟳ Refresh.
- **KPIs**: Total POs · Total PO Value (Σ Net Amount, filtered).
- **Edit modal** ("Edit PO-00NN"): Project Name, Vendor, Delivery Date, Payment Terms, Transport,
  Delivery Place. Banner: "Editing corrects this record only — it won't regenerate the PDF or
  change the items/amounts already fixed when the PO was created."
- **Delete modal**: "permanently removes PO-00NN … cannot be undone", with checkbox (default ON)
  **"Also revert this PO's item(s) status back to 'Yet to Place'"** — reverts every BOI line in
  the PO's `Item IDs` list (used when a PO was created by mistake; note revert target is
  Yet to Place, not each line's prior status).

## 8. Expenses tab (site vouchers)

Columns: Project · Category · Engineer · Description · Voucher No · Amount · Status · Actions.
Footer: "TOTAL (filtered view)" = Σ Amount.

- **Category values**: `Transport, Material Purchase, Travel, Food & Accommodations, Others,
  Laboure` (sic — the team's spelling of "Labour"; keep or migrate deliberately).
- **Status values**: `Pending` (default on create), `Verified`. Verification is just flipping the
  badge-select — done by the office (Admin/PM/Purchase Manager); there is no approver record or
  timestamp. Site Engineers have **no access** to this tab at all (read requires a price-visible
  role).
- **Editable inline**: Project Name, Engineer Name (datalist of previously used names, seeded with
  `Manivel, Anbarasan, A Manikandan, S Manikandan, Mohan Kumar`; free text allowed), Description,
  Voucher No (free text, often blank or a running number), Amount (number). Category and Status
  are badge-selects.
- **Add Voucher modal**: Project (combobox, required), Category, Engineer Name, Description,
  Voucher No, Amount (₹, required), Status.
- **Filters**: Project combobox · Engineer dropdown · Category dropdown · search
  (project+engineer+description+voucher) · Clear · ⟳ Refresh · + Add Voucher.
- **KPIs**: No. of Vouchers · Total Amount · Verified count · Pending count.
- **Roll-up**: every expense add/edit/delete triggers a background refresh of Projects so the
  project's `Expenses` total and `Profit in %` update immediately. Expenses reduce profit exactly
  like BOI cost: `Profit % = (Budget − (BOI + Expenses)) / Budget × 100`.

## 9. Users tab (Admin only)

Columns: Email · Name (inline-editable) · Role (dropdown, saves immediately) · PIN status badge +
Set/Change button · Remove. Add User modal: Google Email (required), Name, Role (default Site
Engineer), optional PIN. In the ERP this maps to the existing employees/roles system; the only
functional carry-over is the **role → price-visibility mapping** (§1). Live users: 1 Admin
(manivel@shiroienergy.com), 1 Purchase Manager (coord@shiroienergy.com / Keshav), 3+ Site
Engineers on personal Gmail with PIN `1234`.

## 10. Exports (Bill of Items)

Both export buttons first show a chooser: **💰 With Price** (Rate, Amount, GST %, Total Amount —
price-visible roles only) vs **📄 Without Price** (Project, Category, Item, Make, Qty, Units,
Status, Vendor only). Exports cover exactly the currently filtered rows.

- **PDF** (A4 landscape): if a single project is filtered, header = project name + 3 stat boxes
  (System Size / Total Budget / Bill of Items Total); otherwise a generated title
  "Bill of Items — <status> — <category> — <vendor>". Table mirrors the on-screen columns;
  GRAND TOTAL footer (with-price only). Filename `<name>_BOI.pdf` / `<name>_BOI_noprice.pdf`.
- **Excel**: same content/columns as the PDF, plus the styled header rows and GRAND TOTAL row.
  Same naming with `.xlsx`.

## 11. Site Engineer app (mobile-first, the only Site Engineer UI)

Single-screen flow ("Hi, <name> · Site Engineer · Add Bill of Items"):
1. **Project** combobox (existing projects only in the dropdown, but typing new text works).
2. **Search Price Book** — search box + checkbox list (Item / Category · Make · Unit; first 50).
   NO prices shown anywhere (server stripped them).
3. **Selected Items (n)** — each with a Qty number input (default 1) and remove ✕.
4. **Submit Items** → server resolves each `{priceBookId, qty}` against the Price Book
   server-side, filling Category/Item/Make/Units/Rate/Gst/Vendor from the PB row, Status
   `Yet to Finalize`, and batch-inserts into BOI. Success message
   "✓ N item(s) submitted for <project>."; selection resets, project stays.

This is the intake side of the purchase flow: engineer requests material → lines land in
*Yet to Finalize* → office finalizes (rates/vendor/qty) and moves to *Yet to Place* → PO.

## 12. Other behaviors worth preserving

- **Single-field commits**: inline edits save one field per round-trip and get the fully
  recalculated row back; UI updates optimistically-after-response with cache patching (no full
  refetch). Failed saves toast the error and re-render from cache.
- **Project totals freshness**: any BOI change to Qty/Rate/Gst/Project Name, any BOI add/delete,
  and any Expense change triggers a background Projects refetch.
- **Duplicate handling**: none anywhere — no unique constraints on project names, price book
  items, or BOI lines. Bulk-add can insert the same PB item into the same project repeatedly.
  Preserve permissiveness (warn-not-block if the ERP adds anything).
- **Saving an edit whose ID no longer exists** (row deleted elsewhere) silently becomes an insert
  of a new row (save-or-recreate). Concurrent-edit conflict resolution is last-write-wins.
- **Filter persistence**: filters live in memory per tab and persist across tab switches within a
  session (jumping from Projects → 🧾 arrives with the project filter pre-applied).
- **Money formatting**: `₹` + en-IN grouping, no decimals in UI/KPIs/PDF (rounded); 2-decimal
  precision only in stored `Total Amount` and PO GST math. (ERP: `formatINR`.)
- **No pagination anywhere** — full lists render with client-side filtering; sticky header +
  scrolling container. Data scale today: ~275 projects, ~220 price book items, ~1k+ BOI lines.
- **No sorting UI** — rows appear in insertion order (POs newest-first). Nobody sorts; they filter.

## 13. Data model mapping (sheet columns verbatim)

| Sheet | Columns (in order) |
|---|---|
| **Projects** | ID, Project Name, System Size, Status, Priority, Project Budget, *Bill of Items Budget*, *Expenses*, *Profit in %* |
| **Price Book** | ID, Category, Item, Make, Unit, Rate, Gst, Vendor |
| **Bill of Items** | ID, Project Name, Category, Item, Make, Qty, Units, Status, Rate, *Amount*, Gst, *Total Amount*, Vendor — live sheet also carries a 14th, manually-added **PO Number** column the app code neither reads nor writes (the team hand-annotates which PO covered a line; the ERP should make this a real FK from BOI line → PO) |
| **Users** | ID, Email, Name, Role, Pin |
| **Expenses** | ID, Project Name, Category, Engineer Name, Description, Voucher No, Amount, Status |
| **Purchase Orders** | ID, PO Number, Project Name, Vendor, Delivery Date, Payment Terms, Transport, Delivery Place, Item IDs (comma-joined BOI IDs), Subtotal, Gst Amount, Net Amount, Created By, Created At, Drive File Url |

*Italics* = computed/read-only. IDs are UUIDs. All cross-sheet references except PO `Item IDs`
are by **Project Name string**.

Enumerations (canonical):
- Project Status: `Yet to Place | Delivered | Partialy Delivered` · Priority: `High | Medium | Low`
- BOI Status: `Yet to Finalize | Yet to Place | Order Placed | Received | Delivered`
- GST %: `0 | 5 | 12 | 18 | 28`
- BOI/PB Category: `Solar Panels | MMS | Inverter | Battery & Accessories | DC & Accessories |
  AC & Accessories | Earth & Accessories | Conduits | Safety & Accessories | I&C |
  Statutory Approvals | Local Expenses | Miscellaneous | Transport | Others`
- Expense Category: `Transport | Material Purchase | Travel | Food & Accommodations | Others | Laboure`
- Expense Status: `Verified | Pending` · Roles: `Admin | Project Manager | Purchase Manager | Site Engineer`

Computed formulas:
- BOI: `Amount = Qty × Rate` · `Total Amount = ROUND(Amount × (1 + Gst/100), 2)`
- Project: `BOI Budget = Σ BOI.Total Amount (by name)` · `Expenses = Σ Expenses.Amount (by name)` ·
  `Profit % = Budget=0 ? 0 : ROUND((Budget − (BOI Budget + Expenses)) / Budget × 100, 2)`
- PO: `Subtotal = Σ (Qty×Rate)` · `Gst Amount = Σ (Qty×Rate×Gst/100)` · `Net = Subtotal + Gst Amount` ·
  `PO Number = 'PO-' + padStart4(max trailing integer in column + 1)`

Sample live PO row: `PO-0001 | RCC Austrom Icon | Festa Solar | 2026-07-18 | Credit | At Actual |
Site | <one BOI id> | 45979 | 2298.95 | 48277.95 | manivel@shiroienergy.com | 2026-07-16 7:48 |
<drive url>`.

## 14. ERP re-implementation notes (deltas to decide, not part of the as-is spec)

1. Replace name-string joins with real FKs (project_id on BOI/Expenses; po_id on BOI lines —
   supersedes the hand-maintained PO Number column) while keeping the UI's type-a-new-project
   affordance.
2. PO numbering should become a sequence/RPC (`PO-%04d`) — keep the visible format, drop the
   reuse-after-delete quirk.
3. Money → NUMERIC(14,2) + decimal.js; the Σ/rollups become SQL RPCs (never JS reduce).
4. PDF → @react-pdf/renderer replicating §6.2's layout; storage → Supabase Storage (path on the
   PO row), replacing the Drive checkbox.
5. Category/Unit/Vendor free-text drift: import as-is, then normalize; vendors likely become
   `contacts` rows.
6. Keep the five status views, the always-visible status-wise money KPI row, the bulk bar, and
   the vendor-mismatch warn-but-allow behavior exactly — these are the muscle-memory parts.
