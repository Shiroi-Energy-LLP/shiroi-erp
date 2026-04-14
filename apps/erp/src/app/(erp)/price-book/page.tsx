import {
  getPriceBookItems,
  getPriceBookCategories,
  getPriceBookBrands,
  getPriceBookVendors,
} from '@/lib/price-book-actions';
import {
  Card,
  CardContent,
  Button,
} from '@repo/ui';
import { BookOpen } from 'lucide-react';
import { SearchInput } from '@/components/search-input';
import { FilterSelect } from '@/components/filter-select';
import { FilterBar } from '@/components/filter-bar';
import { AddPriceBookItemDialog } from '@/components/price-book/add-price-book-item-dialog';
import { EditPriceBookItemDialog } from '@/components/price-book/edit-price-book-item-dialog';
import { DeletePriceBookItemButton } from '@/components/price-book/delete-price-book-item-button';
import { PriceBookRateInlineEdit } from '@/components/price-book/price-book-rate-inline-edit';
import Link from 'next/link';

/** Maps snake_case DB category values to display labels */
const CATEGORY_LABELS: Record<string, string> = {
  solar_panel: 'Solar Panel',
  inverter: 'Inverter',
  battery: 'Battery',
  mounting_structure: 'Mounting Structure',
  dc_cable: 'DC Cable',
  dc_access: 'DC Accessories',
  ac_cable: 'AC Cable',
  dcdb: 'DCDB',
  acdb: 'ACDB',
  lt_panel: 'LT Panel',
  conduit: 'Conduit',
  earthing: 'Earthing',
  earth_access: 'Earthing Accessories',
  net_meter: 'Net Meter',
  civil_work: 'Civil Work',
  installation_labour: 'Installation Labour',
  transport: 'Transport',
  miscellaneous: 'Miscellaneous',
  walkway: 'Walkway',
  gi_cable_tray: 'GI Cable Tray',
  handrail: 'Handrail',
  panel: 'Panel',
  structure: 'Structure',
  other: 'Other',
};

function formatCategory(raw: string): string {
  return CATEGORY_LABELS[raw] ?? raw.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const PER_PAGE = 50;

export default async function PriceBookPage({ searchParams }: PageProps) {
  const params = await searchParams;

  const page = parseInt((params.page as string | undefined) ?? '1') || 1;
  const search = (params.search as string | undefined) || undefined;
  const category = (params.category as string | undefined) || undefined;
  const brand = (params.brand as string | undefined) || undefined;
  const vendor = (params.vendor as string | undefined) || undefined;

  const [{ items, total }, categories, brands, vendors] = await Promise.all([
    getPriceBookItems({ page, per_page: PER_PAGE, search, category, brand, vendor }),
    getPriceBookCategories(),
    getPriceBookBrands(),
    getPriceBookVendors(),
  ]);

  const totalPages = Math.ceil(total / PER_PAGE);
  const offset = (page - 1) * PER_PAGE;
  const hasFilters = search || category || brand || vendor;

  function pageUrl(p: number): string {
    const q = new URLSearchParams();
    if (search) q.set('search', search);
    if (category) q.set('category', category);
    if (brand) q.set('brand', brand);
    if (vendor) q.set('vendor', vendor);
    if (p > 1) q.set('page', String(p));
    const qs = q.toString();
    return `/price-book${qs ? `?${qs}` : ''}`;
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-heading font-bold text-n-900">
            Price Book{' '}
            <span className="text-sm font-normal text-n-500">({total} items)</span>
          </h1>
        </div>
        <AddPriceBookItemDialog />
      </div>

      {/* Filters */}
      <Card className="sticky top-0 z-20 shadow-sm">
        <CardContent className="py-3">
          <FilterBar basePath="/price-book" filterParams={['search', 'category', 'brand', 'vendor']}>
            <FilterSelect paramName="category" className="w-44 text-xs h-8">
              <option value="">All Categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>{formatCategory(c)}</option>
              ))}
            </FilterSelect>
            <FilterSelect paramName="brand" className="w-36 text-xs h-8">
              <option value="">All Brands</option>
              {brands.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </FilterSelect>
            <FilterSelect paramName="vendor" className="w-44 text-xs h-8">
              <option value="">All Vendors</option>
              {vendors.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </FilterSelect>
            <SearchInput
              placeholder="Search item, brand, vendor..."
              className="w-52 h-8 text-xs"
              debounceMs={200}
            />
          </FilterBar>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <BookOpen className="h-10 w-10 text-n-300 mb-3" />
              <h2 className="text-sm font-heading font-bold text-n-700">No Items Found</h2>
              <p className="text-xs text-n-500 max-w-[320px] mt-1">
                {hasFilters
                  ? 'No price book items match your current filters.'
                  : 'No items have been added yet. Click "Add Item" to get started.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-n-200 bg-n-50 text-left">
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider w-10 text-right">S.No</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Category</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Item</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Make</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider text-right">Qty</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Unit</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider text-right">Rate / Unit</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider">Vendor</th>
                    <th className="px-2 py-2 text-[10px] font-semibold text-n-500 uppercase tracking-wider w-16 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-n-100">
                  {items.map((item, idx) => {
                    const sNo = offset + idx + 1;
                    const make = [item.brand, item.model].filter(Boolean).join(' ');

                    return (
                      <tr key={item.id} className="hover:bg-n-50 transition-colors">
                        {/* S.No */}
                        <td className="px-2 py-2 text-[11px] text-n-400 text-right font-mono">{sNo}</td>

                        {/* Category */}
                        <td className="px-2 py-2">
                          <span className="text-[11px] text-n-600">{formatCategory(item.item_category)}</span>
                        </td>

                        {/* Item */}
                        <td className="px-2 py-2 max-w-[260px]">
                          <div className="text-[11px] text-n-900 font-medium">{item.item_description}</div>
                          {item.specification && (
                            <div className="text-[10px] text-n-400 mt-0.5 truncate">{item.specification}</div>
                          )}
                        </td>

                        {/* Make */}
                        <td className="px-2 py-2 text-[11px] text-n-600">
                          {make || <span className="text-n-300">—</span>}
                        </td>

                        {/* Qty */}
                        <td className="px-2 py-2 text-[11px] text-n-600 text-right font-mono">
                          {item.default_qty != null ? item.default_qty : 1}
                        </td>

                        {/* Unit */}
                        <td className="px-2 py-2 text-[11px] text-n-500">{item.unit}</td>

                        {/* Rate / Unit — inline edit + pending badge */}
                        <td className="px-2 py-2 text-right">
                          <PriceBookRateInlineEdit
                            id={item.id}
                            currentRate={item.base_price ?? 0}
                          />
                        </td>

                        {/* Vendor */}
                        <td className="px-2 py-2 text-[11px] text-n-500 max-w-[140px] truncate">
                          {item.vendor_name ?? <span className="text-n-300">—</span>}
                        </td>

                        {/* Actions */}
                        <td className="px-2 py-2">
                          <div className="flex items-center justify-center gap-0.5">
                            <EditPriceBookItemDialog item={item} />
                            <DeletePriceBookItemButton
                              id={item.id}
                              itemDescription={item.item_description}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-2.5 border-t border-n-200 bg-n-50">
              <span className="text-[11px] text-n-500">
                Page {page} of {totalPages} &middot; {total} items
              </span>
              <div className="flex gap-2">
                {page > 1 && (
                  <Link href={pageUrl(page - 1)}>
                    <Button size="sm" variant="outline" className="h-7 text-[11px] px-2.5">
                      ← Previous
                    </Button>
                  </Link>
                )}
                {page < totalPages && (
                  <Link href={pageUrl(page + 1)}>
                    <Button size="sm" variant="outline" className="h-7 text-[11px] px-2.5">
                      Next →
                    </Button>
                  </Link>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
