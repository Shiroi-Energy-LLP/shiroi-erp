/**
 * Tab 1 — BOQ editable table.
 *
 * Server component. Shows every BOQ line for the project with an action bar
 * that lets the engineer:
 *   - Select BOQ rows via checkbox
 *   - Send selected rows to multiple vendors (→ creates RFQ)
 *   - OR skip competitive quoting and go direct-to-PO ("Quick PO")
 *
 * The interactive pieces live in `BoqEditableTable` (client).
 */

import { Card, CardContent, CardHeader, CardTitle } from '@repo/ui';
import type { Database } from '@repo/types/database';
import type { PurchaseDetailItem } from '@/lib/procurement-queries';
import { BoqEditableTable } from '../_client/boq-editable-table';

type AppRole = Database['public']['Enums']['app_role'];

interface TabBoqProps {
  projectId: string;
  items: PurchaseDetailItem[];
  vendors: Array<{ id: string; company_name: string; phone: string | null; email: string | null; contact_person: string | null }>;
  viewerRole: AppRole;
}

export function TabBoq({ projectId, items, vendors, viewerRole }: TabBoqProps) {
  const withVendor = items.filter((i) => i.vendor_id).length;

  return (
    <Card>
      <CardHeader className="py-3 px-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold">
            BOQ — Ready for Purchase
            <span className="text-xs font-normal text-n-500 ml-2">
              ({withVendor}/{items.length} assigned to vendor)
            </span>
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <BoqEditableTable
          projectId={projectId}
          items={items}
          vendors={vendors}
          viewerRole={viewerRole}
        />
      </CardContent>
    </Card>
  );
}
