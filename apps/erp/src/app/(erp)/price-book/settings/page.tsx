import { requireRole } from '@/lib/auth';
import { listItemCategories, listItemUnits } from '@/lib/item-catalog-queries';
import { CatalogAdmin } from '@/components/price-book/catalog-admin';

export const dynamic = 'force-dynamic';

export default async function PriceBookSettingsPage() {
  await requireRole(['founder', 'project_manager', 'purchase_officer']);

  const [categories, units] = await Promise.all([
    listItemCategories(false),
    listItemUnits(false),
  ]);

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-lg font-heading font-bold text-n-900">Price Book — Manage Lists</h1>
        <p className="text-xs text-n-500 mt-0.5">Manage the categories and units used across the price book, BOI, and BOQ.</p>
      </div>
      <CatalogAdmin categories={categories} units={units} />
    </div>
  );
}
