# Manivel PM Corrections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 4 batches of corrections from Manivel after PM testing — project module fixes, task/AMC/tickets corrections, PO module improvements, and Price Book overhaul.

**Architecture:** Server-side rendering with Next.js App Router. `@react-pdf/renderer` for PDF generation. Supabase for data + storage. Two migrations (045, 046). All changes follow existing patterns (server actions, stepper queries, inline editing).

**Tech Stack:** Next.js 14, TypeScript, Supabase, @react-pdf/renderer, React (client components for interactivity)

**Spec:** `docs/superpowers/specs/2026-04-14-manivel-corrections-design.md`

---

## File Map

| # | File | Responsibility |
|---|------|---------------|
| 1 | `supabase/migrations/045_ceig_scope_and_commissioning_signatures.sql` | Add ceig_scope, engineer_signature_path |
| 2 | `supabase/migrations/046_price_book_expansion.sql` | Expand price_book categories, add vendor_name/default_qty/deleted_at/rate audit, seed 217 items |
| 3 | `apps/erp/src/lib/pdf/survey-report-pdf.tsx` | Survey Report PDF component |
| 4 | `apps/erp/src/app/api/projects/[id]/survey/route.ts` | Survey PDF GET endpoint |
| 5 | `apps/erp/src/components/projects/stepper-steps/step-survey.tsx` | Add download button |
| 6 | `apps/erp/src/components/projects/forms/boq-variance-form.tsx` | Extend BoqInlineEdit to support quantity |
| 7 | `apps/erp/src/components/projects/stepper-steps/step-boq.tsx` | Wire quantity inline edit |
| 8 | `apps/erp/src/app/api/projects/[id]/dc/[dcId]/route.ts` | Null guards for DC PDF |
| 9 | `apps/erp/src/lib/pdf/delivery-challan-pdf.tsx` | Defensive rendering |
| 10 | `apps/erp/src/lib/project-stepper-queries.ts` | Execution: show all tasks; Liaison: add ceig_scope; Commissioning: add signature paths |
| 11 | `apps/erp/src/components/projects/stepper-steps/step-execution.tsx` | "Other Tasks" group |
| 12 | `apps/erp/src/components/projects/stepper-steps/step-liaison.tsx` | CEIG scope toggle |
| 13 | `apps/erp/src/lib/liaison-actions.ts` | updateCeigScope action |
| 14 | `apps/erp/src/components/signature-pad.tsx` | Reusable canvas drawing component |
| 15 | `apps/erp/src/components/projects/forms/commissioning-form.tsx` | Add signature capture fields |
| 16 | `apps/erp/src/lib/project-step-actions.ts` | Upload signatures on finalize |
| 17 | `apps/erp/src/lib/pdf/commissioning-report-pdf.tsx` | Embed signature images |
| 18 | `apps/erp/src/app/api/projects/[id]/commissioning/route.ts` | Fetch signature images for PDF |
| 19 | `apps/erp/src/components/tasks/tasks-table.tsx` | Remove strikethrough styling |
| 20 | `apps/erp/src/lib/tasks-actions.ts` | Remove .limit(200) from getActiveProjects |
| 21 | `apps/erp/src/lib/tasks-queries.ts` | New: getProjectsWithTasks() |
| 22 | `apps/erp/src/app/(erp)/tasks/page.tsx` | Use new query for project filter |
| 23 | `apps/erp/src/app/(erp)/om/amc/page.tsx` | New 9-column layout, computed visit fields |
| 24 | `apps/erp/src/lib/amc-actions.ts` | Add computed visit stats to query |
| 25 | `apps/erp/src/app/(erp)/om/tickets/page.tsx` | Ticket number format, project name, filter |
| 26 | `apps/erp/src/lib/ticket-queries.ts` | New: getProjectsWithTickets() |
| 27 | `apps/erp/src/lib/po-actions.ts` | New: updatePoLineItemRate action |
| 28 | `apps/erp/src/app/(erp)/procurement/[poId]/page.tsx` | Inline rate editing, action buttons |
| 29 | `apps/erp/src/lib/pdf/purchase-order-pdf.tsx` | PO PDF component |
| 30 | `apps/erp/src/app/api/procurement/[poId]/pdf/route.ts` | PO PDF GET endpoint |
| 31 | `apps/erp/src/components/procurement/po-download-button.tsx` | PDF download button |
| 32 | `apps/erp/src/app/(erp)/price-book/page.tsx` | Full rewrite with CRUD, filters, pagination |
| 33 | `apps/erp/src/lib/price-book-actions.ts` | New: CRUD server actions for price book |

---

## Batch A — Project Module Corrections

### Task 1: Migration 045 — CEIG scope + engineer signature path

**Files:**
- Create: `supabase/migrations/045_ceig_scope_and_commissioning_signatures.sql`

- [ ] **Step 1: Create migration file**

```sql
-- Migration 045: CEIG scope toggle + commissioning engineer signature
-- Applied to: net_metering_applications, commissioning_reports

-- 1. CEIG scope: Shiroi or Client handling
ALTER TABLE net_metering_applications
  ADD COLUMN IF NOT EXISTS ceig_scope TEXT CHECK (ceig_scope IN ('shiroi', 'client'));

-- 2. Engineer signature path for commissioning reports
ALTER TABLE commissioning_reports
  ADD COLUMN IF NOT EXISTS engineer_signature_path TEXT;
```

- [ ] **Step 2: Apply migration via Supabase MCP**

Run `execute_sql` with the migration SQL against project `actqtzoxjilqnldnacqz`.

- [ ] **Step 3: Regenerate types**

```bash
cd C:\Users\vivek\Projects\shiroi-erp && npx supabase gen types typescript --project-id actqtzoxjilqnldnacqz --schema public > packages/types/database.ts
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/045_ceig_scope_and_commissioning_signatures.sql packages/types/database.ts
git commit -m "chore: migration 045 — ceig_scope on net_metering_applications + engineer_signature_path on commissioning_reports"
```

---

### Task 2: Survey PDF — API Route + PDF Component

**Files:**
- Create: `apps/erp/src/lib/pdf/survey-report-pdf.tsx`
- Create: `apps/erp/src/app/api/projects/[id]/survey/route.ts`

- [ ] **Step 1: Create the Survey Report PDF component**

Create `apps/erp/src/lib/pdf/survey-report-pdf.tsx` — a `@react-pdf/renderer` Document with:
- Shiroi Energy header (same as DC/QC/Commissioning — company name, address, GSTIN, contact)
- Title: "SITE SURVEY REPORT"
- Project info grid: project number, customer name, site address, survey date, surveyor name
- Section 1 — Project Details: GPS coords, contact person, site access notes, survey status
- Section 2 — Roof & Mounting: roof type, condition, age, orientation, tilt, area, usable area, structure type, mounting feasibility. Roof condition photo + shadow area photo rendered inline (200px max width)
- Section 3 — Electrical: existing load, sanctioned load, meter type, supply voltage, discom, earthing type/condition, net metering eligibility
- Section 4 — Equipment Finalization: inverter location (photo), DC routing (photo), earthing pit (photo), LA location (photo), termination point (photo), spare feeder (photo), DG/EB check (photo), AC routing (photo)
- Section 5 — Shading Assessment: shade sources, morning/afternoon shade, notes
- Section 6 — Recommendations: size, system type, estimated generation, panel placement, inverter location, cable routing notes
- Section 7 — Additional Items: extra panels/inverter, routing changes, cable size changes, special requests
- Section 8 — Notes & Signatures: notes field, surveyor signature image, customer signature image
- Use `Image` component from `@react-pdf/renderer` for photos (passed as `{ src: Buffer, width: number, height: number }`)
- Missing photos render "Not captured" text

Export interface `SurveyReportPdfData` with all fields and `photos: Record<string, Buffer | null>` and `signatures: Record<string, Buffer | null>`.

- [ ] **Step 2: Create the Survey PDF API route**

Create `apps/erp/src/app/api/projects/[id]/survey/route.ts`:
- Auth check (same as DC/commissioning routes)
- Fetch project (project_number, customer_name, site_address_*, lead_id)
- Fetch survey via lead_id from `lead_site_surveys`
- If no survey → 404
- Photo fields to fetch (15): `roof_condition_photo_path`, `shadow_area_photo_path`, `inverter_location_photo_path`, `dc_routing_photo_path`, `earthing_pit_photo_path`, `la_location_photo_path`, `termination_point_photo_path`, `spare_feeder_photo_path`, `dg_eb_photo_path`, `spare_feeder_rating_photo_path`, `ac_routing_photo_path` (+ 4 others from survey schema)
- For each non-null photo path: `supabase.storage.from('site-photos').createSignedUrl(path, 60)` → `fetch(signedUrl)` → `Buffer.from(await resp.arrayBuffer())`
- Signature fields (2): `surveyor_signature`, `customer_signature` — these are base64 data URLs → `Buffer.from(base64.split(',')[1], 'base64')`
- Build `SurveyReportPdfData` and render via `renderToBuffer()`
- Return as `Survey-Report-{projectNumber}.pdf`

- [ ] **Step 3: Commit**

```bash
git add apps/erp/src/lib/pdf/survey-report-pdf.tsx apps/erp/src/app/api/projects/[id]/survey/route.ts
git commit -m "feat: survey report PDF — API route + @react-pdf/renderer component with photos & signatures"
```

---

### Task 3: Survey Download Button on Step Survey

**Files:**
- Modify: `apps/erp/src/components/projects/stepper-steps/step-survey.tsx`

- [ ] **Step 1: Add download button**

In `step-survey.tsx`, add a client component `SurveyDownloadButton` (inline or extracted) at the top of the read-only display section (after the `SurveyForm` and before the grid). Show it only when `survey.survey_status === 'submitted'` or `survey.survey_status === 'approved'`.

The button uses the same blob-download pattern as `DcDownloadButton`:
```tsx
// Add to imports
import { Download } from 'lucide-react';

// Below the SurveyForm, add:
{survey && (survey.survey_status === 'submitted' || survey.survey_status === 'approved') && (
  <SurveyDownloadButton projectId={projectId} />
)}
```

The `SurveyDownloadButton` is a `'use client'` component that calls `fetch(\`/api/projects/${projectId}/survey\`)`, creates a blob URL, and triggers download.

Since step-survey.tsx is a server component, create the button as a small client component file or inline it in the same file using a separate export. Best approach: extract to `apps/erp/src/components/projects/forms/survey-download-button.tsx`.

- [ ] **Step 2: Create SurveyDownloadButton client component**

Create `apps/erp/src/components/projects/forms/survey-download-button.tsx`:
```tsx
'use client';

import * as React from 'react';
import { Button } from '@repo/ui';
import { Download } from 'lucide-react';

export function SurveyDownloadButton({ projectId }: { projectId: string }) {
  const [loading, setLoading] = React.useState(false);

  async function handleDownload() {
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/survey`);
      if (!res.ok) throw new Error('Failed to generate PDF');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = res.headers.get('Content-Disposition')?.split('filename="')[1]?.replace('"', '') ?? 'survey-report.pdf';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('[SurveyDownloadButton] Failed:', err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button size="sm" variant="outline" onClick={handleDownload} disabled={loading} className="h-8 text-xs">
      <Download className="h-3.5 w-3.5 mr-1.5" />
      {loading ? 'Generating...' : 'Download Survey PDF'}
    </Button>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/erp/src/components/projects/forms/survey-download-button.tsx apps/erp/src/components/projects/stepper-steps/step-survey.tsx
git commit -m "feat: survey PDF download button on project stepper survey step"
```

---

### Task 4: BOQ Quantity Inline Edit

**Files:**
- Modify: `apps/erp/src/components/projects/forms/boq-variance-form.tsx` (lines 120-177)
- Modify: `apps/erp/src/components/projects/stepper-steps/step-boq.tsx` (line 274)

- [ ] **Step 1: Extend BoqInlineEdit to support quantity field**

In `boq-variance-form.tsx`, change the `BoqInlineEditProps` interface:

```typescript
// OLD:
field: 'unit_price' | 'gst_rate';

// NEW:
field: 'unit_price' | 'gst_rate' | 'quantity';
```

Update the display format in the non-editing state (line 159):
```typescript
// OLD:
{field === 'unit_price' ? formatINR(currentValue) : `${currentValue}%`}

// NEW:
{field === 'unit_price' ? formatINR(currentValue) : field === 'quantity' ? String(currentValue) : `${currentValue}%`}
```

Update the step attribute (line 170):
```typescript
// OLD:
step={field === 'gst_rate' ? '1' : '0.01'}

// NEW:
step={field === 'gst_rate' ? '1' : field === 'quantity' ? '1' : '0.01'}
```

- [ ] **Step 2: Wire quantity edit in step-boq.tsx**

In `step-boq.tsx`, replace the static quantity display (line 274):

```tsx
// OLD:
<td className="px-2 py-1.5 text-right font-mono">{item.quantity} {item.unit}</td>

// NEW:
<td className="px-2 py-1.5 text-right font-mono">
  <BoqInlineEdit
    projectId={projectId}
    itemId={item.id}
    field="quantity"
    currentValue={qty}
  />
  <span className="text-[10px] text-n-400 ml-0.5">{item.unit}</span>
</td>
```

The `updateBoqItem` server action in `project-step-actions.ts` already handles `quantity` in the data payload — it accepts `{ [field]: numValue }` and passes it to the Supabase update. When quantity changes, `total_price` needs to be recalculated server-side. Check if `updateBoqItem` does this — if not, add the recalculation.

- [ ] **Step 3: Verify updateBoqItem recalculates total_price**

Read `project-step-actions.ts` → find `updateBoqItem`. If it doesn't recalculate `total_price = quantity * unit_price * (1 + gst_rate/100)`, add that logic. The function should detect when `quantity` is being updated and fetch the current `unit_price` and `gst_rate` to recompute.

- [ ] **Step 4: Commit**

```bash
git add apps/erp/src/components/projects/forms/boq-variance-form.tsx apps/erp/src/components/projects/stepper-steps/step-boq.tsx
git commit -m "feat: BOQ quantity inline edit — double-click to edit quantity, auto-recalculates total"
```

---

### Task 5: Delivery Challan Null Error Fix

**Files:**
- Modify: `apps/erp/src/app/api/projects/[id]/dc/[dcId]/route.ts`
- Modify: `apps/erp/src/lib/pdf/delivery-challan-pdf.tsx`

- [ ] **Step 1: Add null guards in DC API route**

In `route.ts`, add guards after the data fetches:

1. Line 89 — items array already guarded: `((dc as any).delivery_challan_items ?? [])` ✓
2. Line 73-79 — siteAddress already uses `.filter(Boolean).join(', ')` ✓ but add fallback:

```typescript
// OLD (line 73-79):
const siteAddress = [
  project.site_address_line1,
  project.site_address_line2,
  project.site_city,
  project.site_state,
  project.site_pincode,
].filter(Boolean).join(', ');

// NEW:
const siteAddress = [
  project.site_address_line1,
  project.site_address_line2,
  project.site_city,
  project.site_state,
  project.site_pincode,
].filter(Boolean).join(', ') || 'Address not available';
```

3. Line 51-59 — dispatchedByName already handles null ✓ but ensure it's never `null` in PDF data:

```typescript
// Line 97 in pdfData:
dispatchedByName: dispatchedByName ?? 'Shiroi Energy',
```

4. Guard items mapping — ensure each item property is safe:

```typescript
items: items.map((item: any, idx: number) => ({
  slNo: idx + 1,
  description: String(item.item_description ?? '—'),
  hsnCode: item.hsn_code ?? null,
  quantity: Number(item.quantity ?? 0),
  unit: String(item.unit ?? 'Nos'),
})),
```

5. Guard the date formatting:

```typescript
// Already guarded with ternary ✓
```

- [ ] **Step 2: Add defensive rendering in DC PDF component**

In `delivery-challan-pdf.tsx`, guard the items table rendering:

```tsx
// Before the items.map (around line 298), add empty check:
{data.items.length === 0 ? (
  <View style={s.tableRow}>
    <Text style={[s.tableCell, { width: '100%', textAlign: 'center' as any }]}>No items</Text>
  </View>
) : (
  data.items.map((item, idx) => (
    // existing row rendering...
  ))
)}
```

Also ensure all `<Text>` components render safe values:
- `{data.placeOfSupply || '\u2014'}` ✓ (already safe)
- `{data.deliverTo || '\u2014'}` ✓
- `{data.projectName}` → `{String(data.projectName ?? '')}` (add guard)
- `{data.customerName}` → `{String(data.customerName ?? '')}` (add guard)

- [ ] **Step 3: Commit**

```bash
git add apps/erp/src/app/api/projects/[id]/dc/[dcId]/route.ts apps/erp/src/lib/pdf/delivery-challan-pdf.tsx
git commit -m "fix: delivery challan PDF null error — defensive rendering + null guards in API route"
```

---

### Task 6: Execution — Show All Project Tasks

**Files:**
- Modify: `apps/erp/src/components/projects/stepper-steps/step-execution.tsx`

- [ ] **Step 1: Add "Other Tasks" group in step-execution.tsx**

The query in `getStepExecutionData()` (project-stepper-queries.ts line 326-330) already fetches ALL tasks for the project (`eq('project_id', projectId)`), not filtering by `milestone_id IS NOT NULL`. So the data is already there.

The issue is in `step-execution.tsx` — tasks are grouped by milestone. Tasks without `milestone_id` are lost in the grouping.

Find the section where tasks are grouped by milestone (around line 80+). After the milestone loop, add an "Other Tasks" section:

```tsx
// After the milestone cards, add:
{/* Other Tasks (no milestone assigned) */}
{(() => {
  const otherTasks = tasks.filter((t: any) => !t.milestone_id);
  if (otherTasks.length === 0) return null;
  const completedOther = otherTasks.filter((t: any) => t.is_completed).length;
  const otherPct = otherTasks.length > 0 ? Math.round((completedOther / otherTasks.length) * 100) : 0;
  
  return (
    <Card className="mt-4">
      <CardHeader className="py-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <ListTodo className="w-4 h-4 text-n-400" />
            Other Tasks (No Milestone)
          </CardTitle>
          <Badge variant={otherPct === 100 ? 'default' : 'outline'}>
            {completedOther}/{otherTasks.length} ({otherPct}%)
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {/* Same task table structure as milestone tasks */}
        <table className="w-full text-[11px]">
          <thead>
            <tr className="border-b border-n-200 bg-n-50 text-left">
              {/* Same headers as milestone task table */}
            </tr>
          </thead>
          <tbody>
            {otherTasks.map((task: any) => (
              // Same row rendering as milestone tasks
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
})()}
```

Also update the overall completion % calculation to include other tasks.

- [ ] **Step 2: Commit**

```bash
git add apps/erp/src/components/projects/stepper-steps/step-execution.tsx
git commit -m "feat: execution step shows all project tasks — tasks without milestone appear in 'Other Tasks' group"
```

---

### Task 7: Liaison — CEIG Client/Shiroi Scope Toggle

**Files:**
- Modify: `apps/erp/src/lib/project-stepper-queries.ts` — add ceig_scope to liaison query
- Modify: `apps/erp/src/lib/liaison-actions.ts` — add updateCeigScope action
- Modify: `apps/erp/src/components/projects/stepper-steps/step-liaison.tsx` — scope selector UI
- Modify: `apps/erp/src/components/projects/forms/liaison-form.tsx` — CeigScopeToggle component

- [ ] **Step 1: Add ceig_scope to liaison query**

In `project-stepper-queries.ts`, find the `getStepLiaisonData` function (line 374). In the net_metering_applications select (line 390), add `ceig_scope` to the select string:

```typescript
// Add ceig_scope after ceig_certificate_number
.select('id, discom_name, discom_status, discom_application_date, discom_application_number, ceig_required, ceig_status, ceig_scope, ceig_application_date, ceig_approval_date, ceig_inspection_date, ceig_certificate_number, ...')
```

- [ ] **Step 2: Add updateCeigScope server action**

In `liaison-actions.ts`, add:

```typescript
export async function updateCeigScope(input: {
  applicationId: string;
  scope: 'shiroi' | 'client';
}): Promise<{ success: boolean; error?: string }> {
  const op = '[updateCeigScope]';
  console.log(`${op} Setting CEIG scope to ${input.scope} for application: ${input.applicationId}`);

  const supabase = await createClient();

  const updateData: any = {
    ceig_scope: input.scope,
    ceig_required: input.scope === 'shiroi',
  };

  const { error } = await supabase
    .from('net_metering_applications')
    .update(updateData)
    .eq('id', input.applicationId);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath('/projects');
  return { success: true };
}
```

- [ ] **Step 3: Add CeigScopeToggle to liaison-form.tsx**

In the client component file `liaison-form.tsx`, add a new exported component:

```tsx
export function CeigScopeToggle({ applicationId, currentScope }: { applicationId: string; currentScope: string | null }) {
  const router = useRouter();
  const [saving, setSaving] = React.useState(false);

  async function handleChange(scope: 'shiroi' | 'client') {
    setSaving(true);
    const result = await updateCeigScope({ applicationId, scope });
    setSaving(false);
    if (result.success) router.refresh();
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-medium text-n-500">CEIG Scope:</span>
      <button
        onClick={() => handleChange('shiroi')}
        disabled={saving}
        className={`px-3 py-1 text-xs rounded-l-md border ${currentScope === 'shiroi' ? 'bg-green-50 border-green-300 text-green-700 font-medium' : 'bg-white border-n-200 text-n-500 hover:bg-n-50'}`}
      >
        Shiroi
      </button>
      <button
        onClick={() => handleChange('client')}
        disabled={saving}
        className={`px-3 py-1 text-xs rounded-r-md border-y border-r ${currentScope === 'client' ? 'bg-blue-50 border-blue-300 text-blue-700 font-medium' : 'bg-white border-n-200 text-n-500 hover:bg-n-50'}`}
      >
        Client
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Wire scope toggle in step-liaison.tsx**

In `step-liaison.tsx`, after the system size check for CEIG visibility:
- If `project.system_size_kwp >= 10` AND application exists, show `<CeigScopeToggle>` above the CEIG section
- If `ceig_scope === 'client'`, replace CEIG workflow with "Managed by Client" message card
- If `ceig_scope === 'shiroi'` or null, show existing CEIG workflow (current behavior)

```tsx
{/* CEIG Section — only for ≥10kW */}
{project.system_size_kwp >= 10 && app && (
  <>
    <CeigScopeToggle applicationId={app.id} currentScope={app.ceig_scope} />
    {app.ceig_scope === 'client' ? (
      <Card className="mt-3">
        <CardContent className="py-4">
          <div className="flex items-center gap-2 text-sm text-blue-600">
            <Building2 className="w-4 h-4" />
            <span className="font-medium">CEIG managed by Client</span>
          </div>
          <p className="text-xs text-n-500 mt-1">Client is handling the CEIG clearance process for this project.</p>
        </CardContent>
      </Card>
    ) : (
      // Existing CEIG workflow UI
    )}
  </>
)}
```

- [ ] **Step 5: Commit**

```bash
git add apps/erp/src/lib/project-stepper-queries.ts apps/erp/src/lib/liaison-actions.ts apps/erp/src/components/projects/forms/liaison-form.tsx apps/erp/src/components/projects/stepper-steps/step-liaison.tsx
git commit -m "feat: liaison CEIG scope toggle — Shiroi/Client handling for ≥10kW projects"
```

---

### Task 8: SignaturePad Reusable Component

**Files:**
- Create: `apps/erp/src/components/signature-pad.tsx`

- [ ] **Step 1: Create SignaturePad component**

```tsx
'use client';

import * as React from 'react';
import { Button } from '@repo/ui';
import { Eraser, Undo2 } from 'lucide-react';

interface SignaturePadProps {
  label: string;
  width?: number;
  height?: number;
  onSignatureChange: (dataUrl: string | null) => void;
  initialDataUrl?: string | null;
}

export function SignaturePad({
  label,
  width = 300,
  height = 150,
  onSignatureChange,
  initialDataUrl,
}: SignaturePadProps) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = React.useState(false);
  const [hasSignature, setHasSignature] = React.useState(!!initialDataUrl);
  const strokesRef = React.useRef<ImageData[]>([]);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set up canvas
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = '#1A1D24';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Load initial signature if provided
    if (initialDataUrl) {
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0, width, height);
      };
      img.src = initialDataUrl;
    }
  }, [width, height, initialDataUrl]);

  function getPosition(e: React.MouseEvent | React.TouchEvent) {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = width / rect.width;
    const scaleY = height / rect.height;

    if ('touches' in e) {
      return {
        x: (e.touches[0].clientX - rect.left) * scaleX,
        y: (e.touches[0].clientY - rect.top) * scaleY,
      };
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }

  function startDrawing(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault();
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx || !canvas) return;

    // Save current state for undo
    strokesRef.current.push(ctx.getImageData(0, 0, width, height));

    setIsDrawing(true);
    const pos = getPosition(e);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
  }

  function draw(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault();
    if (!isDrawing) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const pos = getPosition(e);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
  }

  function stopDrawing() {
    if (!isDrawing) return;
    setIsDrawing(false);
    setHasSignature(true);
    const canvas = canvasRef.current;
    if (canvas) {
      onSignatureChange(canvas.toDataURL('image/png'));
    }
  }

  function handleClear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx || !canvas) return;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);
    strokesRef.current = [];
    setHasSignature(false);
    onSignatureChange(null);
  }

  function handleUndo() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx || !canvas || strokesRef.current.length === 0) return;
    const prev = strokesRef.current.pop()!;
    ctx.putImageData(prev, 0, 0);
    if (strokesRef.current.length === 0) {
      setHasSignature(false);
      onSignatureChange(null);
    } else {
      onSignatureChange(canvas.toDataURL('image/png'));
    }
  }

  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-n-700">{label}</label>
      <div className="relative border border-n-200 rounded-md overflow-hidden" style={{ width, height }}>
        {!hasSignature && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-sm text-n-300">Sign here</span>
          </div>
        )}
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          style={{ width, height, touchAction: 'none' }}
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
        />
      </div>
      <div className="flex gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={handleUndo} className="h-7 text-xs">
          <Undo2 className="h-3 w-3 mr-1" /> Undo
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={handleClear} className="h-7 text-xs">
          <Eraser className="h-3 w-3 mr-1" /> Clear
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/erp/src/components/signature-pad.tsx
git commit -m "feat: reusable SignaturePad component — HTML5 Canvas with touch/mouse, undo, clear"
```

---

### Task 9: Commissioning — Digital Signatures + PDF

**Files:**
- Modify: `apps/erp/src/components/projects/forms/commissioning-form.tsx`
- Modify: `apps/erp/src/lib/project-step-actions.ts`
- Modify: `apps/erp/src/lib/pdf/commissioning-report-pdf.tsx`
- Modify: `apps/erp/src/app/api/projects/[id]/commissioning/route.ts`
- Modify: `apps/erp/src/lib/project-stepper-queries.ts`

- [ ] **Step 1: Add signature fields to commissioning form**

In `commissioning-form.tsx`, add state for engineer and customer signatures:

```typescript
const [engineerSig, setEngineerSig] = React.useState<string | null>(null);
const [customerSig, setCustomerSig] = React.useState<string | null>(null);
```

Before the "Finalize" button, add two `SignaturePad` components:

```tsx
import { SignaturePad } from '@/components/signature-pad';

// Before the Finalize button:
{existingReport?.status === 'submitted' && (
  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 pt-4 border-t border-n-200">
    <SignaturePad
      label="Engineer Signature *"
      onSignatureChange={setEngineerSig}
    />
    <SignaturePad
      label="Client Signature *"
      onSignatureChange={setCustomerSig}
    />
  </div>
)}
```

On the finalize handler, check that both signatures are captured:
```typescript
if (!engineerSig || !customerSig) {
  setError('Both engineer and client signatures are required');
  return;
}
```

Pass signatures to the finalize action.

- [ ] **Step 2: Update finalize action to upload signatures**

In `project-step-actions.ts`, find the `finalizeCommissioningReport` function (or the function called by the Finalize button). Add signature upload logic:

```typescript
// Upload engineer signature
const engineerSigBuffer = Buffer.from(engineerSig.split(',')[1], 'base64');
const engineerSigPath = `projects/${projectId}/commissioning/engineer_sig_${Date.now()}.png`;
await supabase.storage.from('site-photos').upload(engineerSigPath, engineerSigBuffer, {
  contentType: 'image/png',
});

// Upload customer signature
const customerSigBuffer = Buffer.from(customerSig.split(',')[1], 'base64');
const customerSigPath = `projects/${projectId}/commissioning/customer_sig_${Date.now()}.png`;
await supabase.storage.from('site-photos').upload(customerSigPath, customerSigBuffer, {
  contentType: 'image/png',
});

// Update commissioning report with signature paths
await supabase
  .from('commissioning_reports')
  .update({
    engineer_signature_path: engineerSigPath,
    signature_storage_path: customerSigPath,
    signature_method: 'drawn_on_device',
    customer_signed_at: new Date().toISOString(),
    customer_name_signed: customerName,
    status: 'finalized',
  })
  .eq('id', reportId);
```

- [ ] **Step 3: Update commissioning query to include signature paths**

In `project-stepper-queries.ts`, find `getStepCommissioningData` (line 426). Add `engineer_signature_path, signature_storage_path, signature_method, customer_name_signed` to the select string.

- [ ] **Step 4: Update commissioning PDF to embed signatures**

In `commissioning-report-pdf.tsx`, add `engineerSignature` and `customerSignature` optional Buffer fields to `CommissioningPdfData`:

```typescript
export interface CommissioningPdfData {
  // ... existing fields ...
  engineerSignature?: Buffer | null;
  customerSignature?: Buffer | null;
}
```

In the signature section of the PDF, render actual images when available:

```tsx
{data.engineerSignature ? (
  <Image src={{ data: data.engineerSignature, format: 'png' }} style={{ width: 120, height: 60 }} />
) : (
  <View style={s.signatureLine} />
)}
```

- [ ] **Step 5: Update commissioning API route to fetch signatures**

In `route.ts`, after fetching the report, fetch signature images from storage:

```typescript
let engineerSigBuffer: Buffer | null = null;
let customerSigBuffer: Buffer | null = null;

if (report.engineer_signature_path) {
  const { data: signedUrl } = await supabase.storage.from('site-photos')
    .createSignedUrl(report.engineer_signature_path, 60);
  if (signedUrl?.signedUrl) {
    const resp = await fetch(signedUrl.signedUrl);
    engineerSigBuffer = Buffer.from(await resp.arrayBuffer());
  }
}

if (report.signature_storage_path) {
  const { data: signedUrl } = await supabase.storage.from('site-photos')
    .createSignedUrl(report.signature_storage_path, 60);
  if (signedUrl?.signedUrl) {
    const resp = await fetch(signedUrl.signedUrl);
    customerSigBuffer = Buffer.from(await resp.arrayBuffer());
  }
}
```

Pass these to the PDF data:
```typescript
engineerSignature: engineerSigBuffer,
customerSignature: customerSigBuffer,
```

- [ ] **Step 6: Commit**

```bash
git add apps/erp/src/components/projects/forms/commissioning-form.tsx apps/erp/src/lib/project-step-actions.ts apps/erp/src/lib/pdf/commissioning-report-pdf.tsx apps/erp/src/app/api/projects/[id]/commissioning/route.ts apps/erp/src/lib/project-stepper-queries.ts
git commit -m "feat: commissioning digital signatures — SignaturePad capture, storage upload, PDF embed"
```

---

## Batch B — Task / AMC / Tickets Corrections

### Task 10: Tasks — Remove Strikethrough + Fix Project List

**Files:**
- Modify: `apps/erp/src/components/tasks/tasks-table.tsx`
- Modify: `apps/erp/src/lib/tasks-actions.ts`

- [ ] **Step 1: Remove strikethrough styling from tasks-table.tsx**

Find and remove the opacity and line-through CSS classes. Search for `opacity-50` and `line-through`:
- Replace `task.is_completed ? 'opacity-50' : ''` with `''`
- Replace `task.is_completed ? 'line-through text-n-400' : 'text-n-900'` with `'text-n-900'`

The Open(red) / Closed(green) status badge is the sole completion indicator.

- [ ] **Step 2: Fix getActiveProjects limit in tasks-actions.ts**

Find `getActiveProjects()` function. Remove the `.limit(200)` call and remove the `.not('status', 'in', '("completed")')` filter so ALL projects are returned for create/edit dropdowns:

```typescript
// OLD:
const { data, error } = await supabase
  .from('projects')
  .select('id, project_number, customer_name')
  .is('deleted_at', null)
  .not('status', 'in', '("completed")')
  .order('customer_name', { ascending: true })
  .limit(200);

// NEW:
const { data, error } = await supabase
  .from('projects')
  .select('id, project_number, customer_name')
  .is('deleted_at', null)
  .order('customer_name', { ascending: true });
```

- [ ] **Step 3: Commit**

```bash
git add apps/erp/src/components/tasks/tasks-table.tsx apps/erp/src/lib/tasks-actions.ts
git commit -m "fix: tasks — remove strikethrough on completed tasks, show all 314 projects in dropdowns"
```

---

### Task 11: Tasks — Project Filter Shows Only Projects with Tasks

**Files:**
- Create: `apps/erp/src/lib/tasks-queries.ts`
- Modify: `apps/erp/src/app/(erp)/tasks/page.tsx`

- [ ] **Step 1: Create tasks-queries.ts with getProjectsWithTasks()**

```typescript
'use server';

import { createClient } from '@repo/supabase/server';

/**
 * Get only projects that have at least one task.
 * Used for the filter dropdown on /tasks page.
 */
export async function getProjectsWithTasks(): Promise<{ id: string; project_number: string; customer_name: string }[]> {
  const op = '[getProjectsWithTasks]';
  console.log(`${op} Starting`);

  const supabase = await createClient();

  const { data, error } = await supabase
    .rpc('get_projects_with_tasks');

  if (error) {
    console.error(`${op} RPC failed, falling back to client query:`, { code: error.code, message: error.message });
    // Fallback: use a raw query approach via distinct join
    const { data: fallback, error: fbErr } = await supabase
      .from('tasks')
      .select('project_id, projects!tasks_project_id_fkey(id, project_number, customer_name)')
      .not('project_id', 'is', null)
      .is('deleted_at', null)
      .limit(500);

    if (fbErr) {
      console.error(`${op} Fallback failed:`, { code: fbErr.code, message: fbErr.message });
      return [];
    }

    // Deduplicate by project_id
    const seen = new Set<string>();
    const result: { id: string; project_number: string; customer_name: string }[] = [];
    for (const row of fallback ?? []) {
      const p = (row as any).projects;
      if (p && !seen.has(p.id)) {
        seen.add(p.id);
        result.push({ id: p.id, project_number: p.project_number, customer_name: p.customer_name });
      }
    }
    return result.sort((a, b) => (a.customer_name ?? '').localeCompare(b.customer_name ?? ''));
  }

  return (data ?? []) as { id: string; project_number: string; customer_name: string }[];
}
```

Note: Since we can't create RPC functions easily, use the fallback approach directly — fetch tasks with project joins, then deduplicate client-side.

- [ ] **Step 2: Use getProjectsWithTasks in tasks page**

In `tasks/page.tsx`, import and call `getProjectsWithTasks()` for the filter dropdown, while keeping `getActiveProjects()` for create/edit forms:

```typescript
import { getProjectsWithTasks } from '@/lib/tasks-queries';

// In the Promise.all:
const [{ tasks, total }, employees, projects, filterProjects] = await Promise.all([
  getAllTasks({ ... }),
  getActiveEmployees(),
  getActiveProjects(), // Full list for create/edit
  getProjectsWithTasks(), // Filtered list for filter dropdown
]);
```

Pass `filterProjects` to `SearchableProjectFilter` and `projects` to `CreateTaskDialog`.

- [ ] **Step 3: Commit**

```bash
git add apps/erp/src/lib/tasks-queries.ts apps/erp/src/app/(erp)/tasks/page.tsx
git commit -m "feat: tasks project filter shows only projects with existing tasks"
```

---

### Task 12: AMC Table Restructure

**Files:**
- Modify: `apps/erp/src/app/(erp)/om/amc/page.tsx`
- Modify: `apps/erp/src/lib/amc-actions.ts`

- [ ] **Step 1: Enhance getAllAmcData query with computed visit stats**

In `amc-actions.ts`, find `getAllAmcData`. After fetching contracts, for each contract compute visit stats (or fetch them via a second query). Add these computed fields:

```typescript
// For each contract, compute:
// completed_visit_count, total_visit_count, next_visit_date, last_completed_date

// Approach: fetch all visits in one query, group client-side
const { data: allVisits } = await supabase
  .from('om_visit_schedules')
  .select('id, contract_id, scheduled_date, status, completed_at')
  .in('contract_id', contractIds)
  .order('scheduled_date', { ascending: true });

// Build a map: contract_id → visit stats
const visitStats: Record<string, {
  completed: number;
  total: number;
  nextDate: string | null;
  lastCompleted: string | null;
}> = {};

for (const v of allVisits ?? []) {
  if (!visitStats[v.contract_id]) {
    visitStats[v.contract_id] = { completed: 0, total: 0, nextDate: null, lastCompleted: null };
  }
  const s = visitStats[v.contract_id];
  s.total++;
  if (v.status === 'completed') {
    s.completed++;
    if (!s.lastCompleted || (v.completed_at && v.completed_at > s.lastCompleted)) {
      s.lastCompleted = v.completed_at;
    }
  } else if (v.status !== 'cancelled' && !s.nextDate) {
    s.nextDate = v.scheduled_date;
  }
}
```

Merge these stats into the returned contracts.

- [ ] **Step 2: Rewrite AMC page table with 9 columns**

Replace the current table in `amc/page.tsx` with the new column layout:

| Project Name | Category | Scheduled Visits | Status | Next AMC Date | Completed Date | Notes | Actions | Report |

- Project Name: `customer_name` as clickable link to `/projects/{project_id}`
- Category: Free AMC / Paid AMC badge
- Scheduled Visits: "X / Y" (completed / total) with AmcVisitTracker expand
- Status: AmcStatusToggle (Open/Closed)
- Next AMC Date: computed from visit stats
- Completed Date: last completed visit date
- Notes: truncated text
- Actions: Edit / Delete buttons
- Report: Upload/download PDF button

Remove: Start Date, End Date, Assigned To columns.

- [ ] **Step 3: Add project filter fix — getProjectsWithAmc**

Similar to tasks, add a `getProjectsWithAmc()` function in `amc-actions.ts` that returns only projects with at least one AMC contract. Use for the filter dropdown.

- [ ] **Step 4: Commit**

```bash
git add apps/erp/src/app/(erp)/om/amc/page.tsx apps/erp/src/lib/amc-actions.ts
git commit -m "feat: AMC table restructure — 9 columns, computed visit stats, project filter fix"
```

---

### Task 13: Service Tickets — Number, Name, Filters

**Files:**
- Modify: `apps/erp/src/app/(erp)/om/tickets/page.tsx`
- Create: `apps/erp/src/lib/ticket-queries.ts`

- [ ] **Step 1: Fix ticket number format**

In `tickets/page.tsx`, find where `ticket_number` is displayed. Change to 3-digit format:

```tsx
// OLD:
<td>{ticket.ticket_number}</td>

// NEW:
<td className="px-2 py-1.5 font-mono text-n-500">
  {String(parseInt((ticket.ticket_number || '').replace('TKT-', '') || '0')).padStart(3, '0')}
</td>
```

- [ ] **Step 2: Fix project name display**

Replace the stacked project_number + customer_name with customer_name only as clickable link:

```tsx
// OLD:
<td>
  <div>{ticket.projects?.project_number}</div>
  <div className="text-xs text-n-500">{ticket.projects?.customer_name}</div>
</td>

// NEW:
<td className="px-2 py-1.5">
  {ticket.project_id ? (
    <Link href={`/projects/${ticket.project_id}`} className="text-[#00B050] hover:underline text-xs">
      {ticket.projects?.customer_name ?? '—'}
    </Link>
  ) : '—'}
</td>
```

- [ ] **Step 3: Create getProjectsWithTickets**

Create `apps/erp/src/lib/ticket-queries.ts`:

```typescript
'use server';

import { createClient } from '@repo/supabase/server';

export async function getProjectsWithTickets(): Promise<{ id: string; project_number: string; customer_name: string }[]> {
  const op = '[getProjectsWithTickets]';
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('service_tickets')
    .select('project_id, projects!service_tickets_project_id_fkey(id, project_number, customer_name)')
    .not('project_id', 'is', null)
    .limit(500);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return [];
  }

  const seen = new Set<string>();
  const result: { id: string; project_number: string; customer_name: string }[] = [];
  for (const row of data ?? []) {
    const p = (row as any).projects;
    if (p && !seen.has(p.id)) {
      seen.add(p.id);
      result.push({ id: p.id, project_number: p.project_number, customer_name: p.customer_name });
    }
  }
  return result.sort((a, b) => (a.customer_name ?? '').localeCompare(b.customer_name ?? ''));
}
```

- [ ] **Step 4: Replace project filter with SearchableProjectFilter**

In `tickets/page.tsx`, import `getProjectsWithTickets` and `SearchableProjectFilter`. Replace the static `<FilterSelect paramName="project">` with:

```tsx
<SearchableProjectFilter projects={filterProjects} />
```

Where `filterProjects` is fetched via `getProjectsWithTickets()` in the page's Promise.all.

- [ ] **Step 5: Commit**

```bash
git add apps/erp/src/app/(erp)/om/tickets/page.tsx apps/erp/src/lib/ticket-queries.ts
git commit -m "fix: service tickets — 3-digit numbers, customer_name links, searchable project filter"
```

---

## Batch C — Purchase Order Module

### Task 14: PO Line Item Rate Editing

**Files:**
- Create: `apps/erp/src/lib/po-actions.ts`
- Modify: `apps/erp/src/app/(erp)/procurement/[poId]/page.tsx`

- [ ] **Step 1: Create po-actions.ts with updatePoLineItemRate**

```typescript
'use server';

import { createClient } from '@repo/supabase/server';
import { revalidatePath } from 'next/cache';

export async function updatePoLineItemRate(input: {
  poId: string;
  itemId: string;
  newRate: number;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[updatePoLineItemRate]';
  console.log(`${op} Updating rate for PO item ${input.itemId} to ${input.newRate}`);

  const supabase = await createClient();

  // Fetch current item to get quantity and gst_rate
  const { data: item, error: fetchErr } = await supabase
    .from('purchase_order_items')
    .select('quantity_ordered, gst_rate')
    .eq('id', input.itemId)
    .single();

  if (fetchErr || !item) {
    console.error(`${op} Item fetch failed:`, fetchErr);
    return { success: false, error: 'Item not found' };
  }

  const qty = Number(item.quantity_ordered);
  const totalPrice = input.newRate * qty;
  const gstRate = Number(item.gst_rate ?? 18);
  const gstAmount = totalPrice * (gstRate / 100);

  // Update item
  const { error: updateErr } = await supabase
    .from('purchase_order_items')
    .update({
      unit_price: input.newRate,
      total_price: totalPrice,
      gst_amount: gstAmount,
    })
    .eq('id', input.itemId);

  if (updateErr) {
    console.error(`${op} Update failed:`, updateErr);
    return { success: false, error: updateErr.message };
  }

  // Recalculate PO totals
  const { data: allItems } = await supabase
    .from('purchase_order_items')
    .select('total_price, gst_amount')
    .eq('purchase_order_id', input.poId);

  const subtotal = (allItems ?? []).reduce((sum, i) => sum + Number(i.total_price ?? 0), 0);
  const totalGst = (allItems ?? []).reduce((sum, i) => sum + Number(i.gst_amount ?? 0), 0);
  const totalAmount = subtotal + totalGst;

  await supabase
    .from('purchase_orders')
    .update({
      subtotal,
      gst_amount: totalGst,
      total_amount: totalAmount,
    })
    .eq('id', input.poId);

  revalidatePath(`/procurement/${input.poId}`);
  return { success: true };
}

export async function deletePoSoft(poId: string): Promise<{ success: boolean; error?: string }> {
  const op = '[deletePoSoft]';
  const supabase = await createClient();

  const { error } = await supabase
    .from('purchase_orders')
    .update({ deleted_at: new Date().toISOString() } as any)
    .eq('id', poId);

  if (error) {
    console.error(`${op} Failed:`, error);
    return { success: false, error: error.message };
  }

  revalidatePath('/procurement');
  return { success: true };
}
```

- [ ] **Step 2: Add inline rate editing to PO detail page**

In `procurement/[poId]/page.tsx`, create a client component `PoRateInlineEdit` (similar to `BoqInlineEdit` pattern). Show it in the Rate column for each line item when PO status is `draft` or `sent`.

```tsx
// Add at the bottom of the file or in a separate component:
'use client';

function PoRateInlineEdit({ poId, itemId, currentRate }: { poId: string; itemId: string; currentRate: number }) {
  const router = useRouter();
  const [editing, setEditing] = React.useState(false);
  const [value, setValue] = React.useState(currentRate.toString());
  const [saving, setSaving] = React.useState(false);

  async function handleSave() {
    const num = parseFloat(value);
    if (isNaN(num) || num === currentRate) { setEditing(false); return; }
    setSaving(true);
    const result = await updatePoLineItemRate({ poId, itemId, newRate: num });
    setSaving(false);
    if (result.success) { setEditing(false); router.refresh(); }
  }

  if (!editing) {
    return (
      <span className="font-mono cursor-pointer hover:bg-p-50 rounded px-1 -mx-1" onDoubleClick={() => setEditing(true)} title="Double-click to edit">
        {formatINR(currentRate)}
      </span>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <input value={value} onChange={e => setValue(e.target.value)} type="number" step="0.01"
        className="text-xs h-7 w-[80px] text-right font-mono border rounded px-1" autoFocus
        onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') { setEditing(false); setValue(currentRate.toString()); }}}
      />
      <button onClick={handleSave} disabled={saving} className="text-green-600 text-xs">✓</button>
    </div>
  );
}
```

Since the page is a server component, extract the items table into a client component wrapper.

- [ ] **Step 3: Commit**

```bash
git add apps/erp/src/lib/po-actions.ts apps/erp/src/app/(erp)/procurement/[poId]/page.tsx
git commit -m "feat: PO line item rate inline editing — double-click to edit, auto-recalculates totals"
```

---

### Task 15: PO PDF Template + API Route

**Files:**
- Create: `apps/erp/src/lib/pdf/purchase-order-pdf.tsx`
- Create: `apps/erp/src/app/api/procurement/[poId]/pdf/route.ts`

- [ ] **Step 1: Create PO PDF component**

Create `apps/erp/src/lib/pdf/purchase-order-pdf.tsx` with `@react-pdf/renderer`:

```tsx
import React from 'react';
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import { BRAND } from './pdf-styles';

export interface PurchaseOrderPdfData {
  poNumber: string;
  poDate: string;
  paymentTerms: string;
  projectName: string;
  placeOfSupply: string;
  // Vendor
  vendorName: string;
  vendorAddress: string;
  vendorGstin: string;
  vendorContact: string;
  // Ship To
  shipToAddress: string;
  shipToContact: string;
  shipToPhone: string;
  // Items
  items: {
    slNo: number;
    description: string;
    hsnCode: string;
    quantity: number;
    unit: string;
    rate: number;
    amount: number;
  }[];
  // Totals
  subtotal: number;
  gstBreakdown: { label: string; amount: number }[]; // e.g. [{label:'CGST 9%', amount:X}, {label:'SGST 9%', amount:X}]
  roundOff: number;
  grandTotal: number;
  // Notes
  notes: string;
  generatedAt: string;
}
```

Layout matching the spec in the design doc:
- Company header (Shiroi Energy LLP, address, GSTIN, email)
- "PURCHASE ORDER" title box
- PO info row (PO No, Date, Terms, Project, Place of Supply)
- 2-column: Vendor Details | Ship To
- Items table: #, Item, HSN, Qty, Rate, Amount
- Footer: Items count, Notes, T&C | Subtotal, CGST, SGST, Round Off, GRAND TOTAL
- Authorized Signature line

Format amounts in Indian number format using a helper:
```typescript
function fmtINR(n: number): string {
  return '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
```

- [ ] **Step 2: Create PO PDF API route**

Create `apps/erp/src/app/api/procurement/[poId]/pdf/route.ts`:

```typescript
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@repo/supabase/server';
import { renderToBuffer } from '@react-pdf/renderer';
import { PurchaseOrderPDF, type PurchaseOrderPdfData } from '@/lib/pdf/purchase-order-pdf';
import React from 'react';

export async function GET(request: NextRequest, { params }: { params: Promise<{ poId: string }> }) {
  const { poId } = await params;
  const op = '[GET /api/procurement/[poId]/pdf]';

  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    // Fetch PO with items, vendor, project
    const { data: po, error } = await supabase
      .from('purchase_orders')
      .select('*, purchase_order_items(*), vendors!purchase_orders_vendor_id_fkey(company_name, address_line1, address_line2, city, state, pincode, gstin, contact_person, phone), projects!purchase_orders_project_id_fkey(customer_name, project_number, site_address_line1, site_address_line2, site_city, site_state, site_pincode, customer_phone)')
      .eq('id', poId)
      .single();

    if (error || !po) return NextResponse.json({ error: 'PO not found' }, { status: 404 });

    const vendor = (po as any).vendors ?? {};
    const project = (po as any).projects ?? {};
    const items = ((po as any).purchase_order_items ?? []).sort((a: any, b: any) => (a.line_number ?? 0) - (b.line_number ?? 0));

    // Build vendor address
    const vendorAddr = [vendor.address_line1, vendor.address_line2, vendor.city, vendor.state, vendor.pincode].filter(Boolean).join(', ');
    const shipTo = [project.site_address_line1, project.site_address_line2, project.site_city, project.site_state, project.site_pincode].filter(Boolean).join(', ') || 'Address not available';

    // Calculate totals
    const subtotal = items.reduce((sum: number, i: any) => sum + Number(i.total_price ?? 0), 0);
    
    // Per-item GST aggregation
    const gstTotals: Record<number, number> = {};
    for (const i of items) {
      const rate = Number(i.gst_rate ?? 18);
      gstTotals[rate] = (gstTotals[rate] ?? 0) + Number(i.gst_amount ?? 0);
    }
    
    // For intra-state (Tamil Nadu): split as CGST + SGST
    const gstBreakdown: { label: string; amount: number }[] = [];
    for (const [rate, total] of Object.entries(gstTotals)) {
      const half = Number(total) / 2;
      gstBreakdown.push({ label: `CGST ${Number(rate)/2}%`, amount: half });
      gstBreakdown.push({ label: `SGST ${Number(rate)/2}%`, amount: half });
    }

    const totalGst = Object.values(gstTotals).reduce((s, v) => s + v, 0);
    const rawTotal = subtotal + totalGst;
    const roundOff = Math.round(rawTotal) - rawTotal;
    const grandTotal = Math.round(rawTotal);

    const pdfData: PurchaseOrderPdfData = {
      poNumber: po.po_number ?? '',
      poDate: po.po_date ? new Date(po.po_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—',
      paymentTerms: po.payment_terms_days ? `${po.payment_terms_days} days` : '—',
      projectName: `${project.customer_name ?? ''} — ${project.project_number ?? ''}`,
      placeOfSupply: project.site_state ?? 'Tamil Nadu',
      vendorName: vendor.company_name ?? '—',
      vendorAddress: vendorAddr || '—',
      vendorGstin: vendor.gstin ?? '—',
      vendorContact: [vendor.contact_person, vendor.phone].filter(Boolean).join(' / ') || '—',
      shipToAddress: shipTo,
      shipToContact: project.customer_name ?? '',
      shipToPhone: project.customer_phone ?? '',
      items: items.map((i: any, idx: number) => ({
        slNo: idx + 1,
        description: String(i.item_description ?? '—'),
        hsnCode: String(i.hsn_code ?? '—'),
        quantity: Number(i.quantity_ordered ?? 0),
        unit: String(i.unit ?? 'Nos'),
        rate: Number(i.unit_price ?? 0),
        amount: Number(i.total_price ?? 0),
      })),
      subtotal,
      gstBreakdown,
      roundOff,
      grandTotal,
      notes: po.notes ?? '',
      generatedAt: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
    };

    const pdfBuffer = await renderToBuffer(React.createElement(PurchaseOrderPDF, { data: pdfData }) as any);
    const fileName = `${(po.po_number ?? 'PO').replace(/\//g, '-')}_PurchaseOrder.pdf`;

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${fileName}"`,
      },
    });
  } catch (err) {
    console.error(`${op} Failed:`, err);
    return NextResponse.json({ error: 'PDF generation failed' }, { status: 500 });
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/erp/src/lib/pdf/purchase-order-pdf.tsx apps/erp/src/app/api/procurement/[poId]/pdf/route.ts
git commit -m "feat: purchase order PDF — @react-pdf/renderer template with Shiroi format + API route"
```

---

### Task 16: PO Actions — Download Button + Delete

**Files:**
- Create: `apps/erp/src/components/procurement/po-download-button.tsx`
- Modify: `apps/erp/src/app/(erp)/procurement/[poId]/page.tsx`

- [ ] **Step 1: Create PoDownloadButton**

```tsx
'use client';

import * as React from 'react';
import { Button } from '@repo/ui';
import { Download } from 'lucide-react';

export function PoDownloadButton({ poId, poNumber }: { poId: string; poNumber: string }) {
  const [loading, setLoading] = React.useState(false);

  async function handleDownload() {
    setLoading(true);
    try {
      const res = await fetch(`/api/procurement/${poId}/pdf`);
      if (!res.ok) throw new Error('Failed to generate PDF');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${poNumber.replace(/\//g, '-')}_PurchaseOrder.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('[PoDownloadButton] Failed:', err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button size="sm" variant="outline" onClick={handleDownload} disabled={loading} className="h-8 text-xs">
      <Download className="h-3.5 w-3.5 mr-1.5" />
      {loading ? 'Generating...' : 'Download PDF'}
    </Button>
  );
}
```

- [ ] **Step 2: Add action buttons to PO detail page**

In `procurement/[poId]/page.tsx`, add to the header area:

```tsx
import { PoDownloadButton } from '@/components/procurement/po-download-button';

// In the header section, after the h1:
<div className="flex items-center gap-2 mt-2">
  <PoDownloadButton poId={poId} poNumber={po.po_number ?? ''} />
  {(po.status === 'draft' || po.status === 'sent') && (
    <Link href={`/procurement/${poId}/edit`}>
      <Button size="sm" variant="outline" className="h-8 text-xs">Edit</Button>
    </Link>
  )}
</div>
```

- [ ] **Step 3: Commit**

```bash
git add apps/erp/src/components/procurement/po-download-button.tsx apps/erp/src/app/(erp)/procurement/[poId]/page.tsx
git commit -m "feat: PO download PDF button + action buttons on detail page"
```

---

## Batch D — Price Book / Item Master

### Task 17: Migration 046 — Price Book Expansion

**Files:**
- Create: `supabase/migrations/046_price_book_expansion.sql`

- [ ] **Step 1: Create migration file**

```sql
-- Migration 046: Price Book expansion for Item Master
-- Adds vendor_name, default_qty, deleted_at, rate audit columns
-- Expands item_category CHECK constraint to 22 categories

-- New columns
ALTER TABLE price_book ADD COLUMN IF NOT EXISTS vendor_name TEXT;
ALTER TABLE price_book ADD COLUMN IF NOT EXISTS default_qty NUMERIC(10,2) DEFAULT 1;
ALTER TABLE price_book ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE price_book ADD COLUMN IF NOT EXISTS rate_updated_at TIMESTAMPTZ;
ALTER TABLE price_book ADD COLUMN IF NOT EXISTS rate_updated_by UUID REFERENCES profiles(id);

-- Drop old restrictive CHECK constraint and replace with expanded one
ALTER TABLE price_book DROP CONSTRAINT IF EXISTS price_book_item_category_check;
ALTER TABLE price_book ADD CONSTRAINT price_book_item_category_check
  CHECK (item_category IN (
    'solar_panel', 'inverter', 'battery', 'mounting_structure',
    'dc_cable', 'dc_access', 'ac_cable', 'dcdb', 'acdb',
    'lt_panel', 'conduit', 'earthing', 'earth_access',
    'net_meter', 'civil_work', 'installation_labour', 'transport',
    'miscellaneous', 'walkway', 'gi_cable_tray', 'handrail', 'other',
    'panel', 'structure'
  ));

-- Index for common queries
CREATE INDEX IF NOT EXISTS idx_price_book_category ON price_book(item_category) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_price_book_active ON price_book(is_active) WHERE deleted_at IS NULL;
```

Note: The seed of 217 items will be done via a separate script or SQL INSERT block, not in the migration itself (migration keeps schema changes only, seed data as a follow-up step).

- [ ] **Step 2: Apply migration via Supabase MCP**

Run `execute_sql` with the migration SQL.

- [ ] **Step 3: Regenerate types**

```bash
npx supabase gen types typescript --project-id actqtzoxjilqnldnacqz --schema public > packages/types/database.ts
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/046_price_book_expansion.sql packages/types/database.ts
git commit -m "chore: migration 046 — price book expansion (vendor_name, default_qty, deleted_at, rate audit, expanded categories)"
```

---

### Task 18: Price Book CRUD Server Actions

**Files:**
- Create: `apps/erp/src/lib/price-book-actions.ts`

- [ ] **Step 1: Create price-book-actions.ts**

```typescript
'use server';

import { createClient } from '@repo/supabase/server';
import { revalidatePath } from 'next/cache';

export async function getPriceBookItems(params: {
  search?: string;
  category?: string;
  brand?: string;
  vendor?: string;
  page?: number;
  per_page?: number;
}): Promise<{ items: any[]; total: number }> {
  const op = '[getPriceBookItems]';
  const supabase = await createClient();
  const page = params.page ?? 1;
  const perPage = params.per_page ?? 50;
  const offset = (page - 1) * perPage;

  let query = supabase
    .from('price_book')
    .select('*', { count: 'estimated' })
    .is('deleted_at', null)
    .order('item_category', { ascending: true })
    .order('item_description', { ascending: true })
    .range(offset, offset + perPage - 1);

  if (params.category) query = query.eq('item_category', params.category);
  if (params.brand) query = query.eq('brand', params.brand);
  if (params.vendor) query = query.eq('vendor_name', params.vendor);
  if (params.search) query = query.or(`item_description.ilike.%${params.search}%,brand.ilike.%${params.search}%,vendor_name.ilike.%${params.search}%`);

  const { data, error, count } = await query;

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return { items: [], total: 0 };
  }

  return { items: data ?? [], total: count ?? 0 };
}

export async function createPriceBookItem(input: {
  item_category: string;
  item_description: string;
  brand?: string;
  model?: string;
  unit: string;
  base_price: number;
  gst_rate: number;
  gst_type?: string;
  hsn_code?: string;
  vendor_name?: string;
  default_qty?: number;
  specification?: string;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[createPriceBookItem]';
  const supabase = await createClient();

  const { error } = await supabase
    .from('price_book')
    .insert({
      ...input,
      is_active: true,
      effective_from: new Date().toISOString().split('T')[0],
    } as any);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath('/price-book');
  return { success: true };
}

export async function updatePriceBookItem(input: {
  id: string;
  data: Record<string, any>;
}): Promise<{ success: boolean; error?: string }> {
  const op = '[updatePriceBookItem]';
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();

  const updateData = { ...input.data };

  // If base_price is being changed, track the audit
  if ('base_price' in updateData) {
    updateData.rate_updated_at = new Date().toISOString();
    updateData.rate_updated_by = user?.id ?? null;
  }

  const { error } = await supabase
    .from('price_book')
    .update(updateData as any)
    .eq('id', input.id);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath('/price-book');
  return { success: true };
}

export async function deletePriceBookItem(id: string): Promise<{ success: boolean; error?: string }> {
  const op = '[deletePriceBookItem]';
  const supabase = await createClient();

  const { error } = await supabase
    .from('price_book')
    .update({ deleted_at: new Date().toISOString() } as any)
    .eq('id', id);

  if (error) {
    console.error(`${op} Failed:`, { code: error.code, message: error.message });
    return { success: false, error: error.message };
  }

  revalidatePath('/price-book');
  return { success: true };
}

/** Get distinct categories from active price book items */
export async function getPriceBookCategories(): Promise<string[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('price_book')
    .select('item_category')
    .is('deleted_at', null)
    .eq('is_active', true);

  const cats = new Set((data ?? []).map((d: any) => d.item_category as string));
  return [...cats].sort();
}

/** Get distinct brands from active price book items */
export async function getPriceBookBrands(): Promise<string[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('price_book')
    .select('brand')
    .is('deleted_at', null)
    .eq('is_active', true)
    .not('brand', 'is', null);

  const brands = new Set((data ?? []).map((d: any) => d.brand as string).filter(Boolean));
  return [...brands].sort();
}

/** Get distinct vendors from active price book items */
export async function getPriceBookVendors(): Promise<string[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('price_book')
    .select('vendor_name')
    .is('deleted_at', null)
    .not('vendor_name', 'is', null);

  const vendors = new Set((data ?? []).map((d: any) => d.vendor_name as string).filter(Boolean));
  return [...vendors].sort();
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/erp/src/lib/price-book-actions.ts
git commit -m "feat: price book CRUD server actions — create, update, delete, paginated query with filters"
```

---

### Task 19: Price Book Page Overhaul

**Files:**
- Modify: `apps/erp/src/app/(erp)/price-book/page.tsx`

- [ ] **Step 1: Rewrite price-book page with CRUD**

Replace the entire page with a server component that:
- Calls `getPriceBookItems(params)` with URL searchParams
- Calls `getPriceBookCategories()`, `getPriceBookBrands()`, `getPriceBookVendors()` for filter dropdowns
- Shows filter bar with: Category dropdown, Brand dropdown, Vendor dropdown, SearchInput, "Add Item" button
- Table columns: S.No, Category, Item, Make, Qty, Unit, Rate/Unit, Vendor, Actions
- "Rate pending" amber badge on items with `base_price === 0`
- Pagination (50 items/page)
- Actions: Edit button (opens dialog), Delete button (soft delete with confirm)

Create inline client components for:
- `AddPriceBookItemDialog` — dialog with all fields
- `EditPriceBookItemDialog` — dialog pre-filled with current values
- `DeletePriceBookItemButton` — confirm dialog then soft delete
- `PriceBookRateInlineEdit` — double-click to edit rate in place

- [ ] **Step 2: Commit**

```bash
git add apps/erp/src/app/(erp)/price-book/page.tsx
git commit -m "feat: price book page overhaul — full CRUD, filters, pagination, rate inline edit"
```

---

### Task 20: Import 217 Items into Price Book

**Files:**
- Create seed SQL or script to insert items

- [ ] **Step 1: Fetch Google Sheet data**

Fetch the Google Sheet at `https://docs.google.com/spreadsheets/d/1cUOOWQmM5DIeAyM9POv3KCXiTiB7VtUbwEoG33OwKNs/` (CSV export) and parse the 217 items.

Map columns:
- Category → item_category (lowercase, underscore)
- Items → item_description
- Make → brand
- Qty → default_qty
- Units → unit
- Rate/Unit → base_price (0 for empty/zero rates)
- Vendor → vendor_name

Category mapping:
```
Panel → solar_panel
Inverter → inverter
Battery → battery
Structure → mounting_structure
DC Cable → dc_cable
DC & Access → dc_access
AC Cable → ac_cable
DCDB → dcdb
ACDB → acdb
LT Panel → lt_panel
Conduit → conduit
Earthing → earthing
Earth & Access → earth_access
Net Meter → net_meter
Civil Work → civil_work
Installation Labour → installation_labour
Transport → transport
Miscellaneous → miscellaneous
Walkway → walkway
GI Cable Tray → gi_cable_tray
Handrail → handrail
Other → other
```

- [ ] **Step 2: Generate and apply INSERT SQL**

Build INSERT statements from the parsed data. Run via Supabase MCP `execute_sql`.

```sql
INSERT INTO price_book (item_category, item_description, brand, unit, base_price, gst_rate, gst_type, vendor_name, default_qty, is_active, effective_from)
VALUES
  ('solar_panel', 'Solar Panel 545W Mono PERC', 'Waaree', 'Nos', 16.50, 12, 'inclusive', 'Vendor A', 1, true, '2026-04-14'),
  -- ... 216 more rows
;
```

Items with ₹0 rates are inserted with `base_price = 0` (not blocked).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/046_price_book_expansion.sql
git commit -m "feat: seed 217 price book items from Manivel's Item Master sheet"
```

---

### Task 21: Update CLAUDE.md + Master Reference + Push

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/SHIROI_MASTER_REFERENCE_3_0.md`

- [ ] **Step 1: Update CLAUDE.md current state table**

Add entries for:
- Migration 045 ✅ Applied (dev)
- Migration 046 ✅ Applied (dev)
- Survey PDF download ✅ Complete
- BOQ quantity edit ✅ Complete
- DC null error fix ✅ Complete
- Execution task visibility ✅ Complete
- Liaison CEIG scope ✅ Complete
- Commissioning signatures ✅ Complete
- Tasks corrections ✅ Complete
- AMC table restructure ✅ Complete
- Service tickets corrections ✅ Complete
- PO rate editing + PDF ✅ Complete
- Price Book overhaul ✅ Complete

- [ ] **Step 2: Update Master Reference**

Update version number, add entries for all 4 batches.

- [ ] **Step 3: Commit and push**

```bash
git add CLAUDE.md docs/SHIROI_MASTER_REFERENCE_3_0.md
git commit -m "docs: update CLAUDE.md + master reference — Manivel PM Corrections 4 batches complete"
git push origin main
```

---

## Verification Checklist

After all tasks are complete:

1. **Survey PDF:** Navigate to any project → Survey step → "Download Survey PDF" button visible for submitted/approved surveys → downloads PDF with photos and signatures
2. **BOQ Qty Edit:** Project → BOQ tab → double-click quantity → edit → saves, total_price recalculates
3. **DC PDF:** Project → Delivery tab → download any DC PDF → no null errors, all fields rendered safely
4. **Execution Tasks:** Project → Execution tab → tasks created from /tasks page (without milestone) appear in "Other Tasks" group
5. **Liaison CEIG:** Project (≥10kW) → Liaison tab → Shiroi/Client toggle visible → selecting "Client" shows "Managed by Client" card
6. **Commissioning Sigs:** Project → Commissioning → Submit → SignaturePads appear → draw both → Finalize → PDF shows actual signatures
7. **Tasks:** /tasks → no strikethrough on completed tasks → all 314 projects in create dropdown → filter shows only projects with tasks
8. **AMC:** /om/amc → 9-column table → computed visit stats → project filter shows only projects with AMC
9. **Tickets:** /om/tickets → 3-digit numbers → customer_name links → searchable project filter
10. **PO Rate:** /procurement/[poId] → double-click rate → edit → totals recalculate → Download PDF button works
11. **Price Book:** /price-book → 217 items → filter by category/brand/vendor → add/edit/delete items → "Rate pending" badge on ₹0 items
12. **tsc --noEmit:** 0 errors
