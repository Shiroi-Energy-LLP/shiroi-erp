import Link from 'next/link';
import { getStockPieces, getInventorySummary, getLowStockCutLengths } from '@/lib/inventory-queries';
import type { InventoryFilters } from '@/lib/inventory-queries';
import { formatDate } from '@repo/ui/formatters';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Badge,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@repo/ui';
import { Package, Scissors, AlertTriangle, Ruler } from 'lucide-react';
import { SearchInput } from '@/components/search-input';
import { FilterSelect } from '@/components/filter-select';
import { FilterBar } from '@/components/filter-bar';

interface InventoryPageProps {
  searchParams: Promise<{
    category?: string;
    location?: string;
    condition?: string;
    cut_length?: string;
    scrap?: string;
    search?: string;
  }>;
}

const CATEGORIES = [
  'panel', 'inverter', 'battery', 'structure', 'dc_cable', 'ac_cable',
  'conduit', 'earthing', 'acdb', 'dcdb', 'net_meter', 'other',
];

const LOCATIONS = ['warehouse', 'in_transit', 'on_site', 'installed', 'scrapped', 'returned'];

const CONDITIONS = ['new', 'good', 'damaged', 'faulty', 'scrapped'];

function locationVariant(loc: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (loc) {
    case 'warehouse': return 'default';
    case 'on_site': return 'secondary';
    case 'installed': return 'default';
    case 'scrapped': return 'destructive';
    case 'in_transit': return 'outline';
    case 'returned': return 'outline';
    default: return 'outline';
  }
}

function conditionVariant(cond: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (cond) {
    case 'new': return 'default';
    case 'good': return 'secondary';
    case 'damaged': return 'outline';
    case 'faulty': return 'destructive';
    case 'scrapped': return 'destructive';
    default: return 'outline';
  }
}

export default async function InventoryPage({ searchParams }: InventoryPageProps) {
  const sp = await searchParams;

  const filters: InventoryFilters = {};
  if (sp.category) filters.category = sp.category;
  if (sp.location) filters.location = sp.location;
  if (sp.condition) filters.condition = sp.condition;
  if (sp.cut_length === 'true') filters.isCutLength = true;
  if (sp.scrap === 'true') filters.isScrap = true;
  if (sp.scrap === 'false') filters.isScrap = false;
  if (sp.search) filters.search = sp.search;

  const [pieces, summary, lowStockCutLengths] = await Promise.all([
    getStockPieces(filters),
    getInventorySummary(),
    getLowStockCutLengths(),
  ]);



  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-heading font-bold text-[#1A1D24]">Inventory</h1>
        <p className="text-sm text-gray-500">
          {summary.totalPieces} items total · {summary.cutLengthPieces} cut-length · {summary.scrapPieces} scrapped
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <Package className="h-8 w-8 text-[#00B050]" />
              <div>
                <p className="text-2xl font-bold font-mono">{summary.totalPieces}</p>
                <p className="text-xs text-muted-foreground">Total Pieces</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <Scissors className="h-8 w-8 text-[#2563EB]" />
              <div>
                <p className="text-2xl font-bold font-mono">{summary.cutLengthPieces}</p>
                <p className="text-xs text-muted-foreground">Cut-Length Items</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <Ruler className="h-8 w-8 text-[#EA580C]" />
              <div>
                <p className="text-2xl font-bold font-mono">{lowStockCutLengths.length}</p>
                <p className="text-xs text-muted-foreground">Low Stock (Cut)</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-8 w-8 text-[#991B1B]" />
              <div>
                <p className="text-2xl font-bold font-mono">{summary.scrapPieces}</p>
                <p className="text-xs text-muted-foreground">Scrapped</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Low Stock Alert */}
      {lowStockCutLengths.length > 0 && (
        <Card className="border-[#EA580C]/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-[#EA580C] flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              Low Stock Cut-Length Items
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {lowStockCutLengths.slice(0, 5).map((p) => (
                <div key={p.id} className="flex items-center justify-between text-sm">
                  <div>
                    <span className="font-medium">{p.item_description}</span>
                    {p.brand && <span className="text-muted-foreground ml-2">({p.brand})</span>}
                  </div>
                  <div className="font-mono text-[#EA580C]">
                    {p.current_length_m}m remaining (min: {p.minimum_usable_length_m}m)
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <Card className="sticky top-0 z-20 shadow-sm">
        <CardContent className="pt-4">
          <FilterBar basePath="/inventory" filterParams={['search', 'category', 'location', 'condition', 'cut_length']}>
            <SearchInput
              placeholder="Description, brand, serial..."
              className="w-64 h-9 text-sm"
            />
            <FilterSelect paramName="category" className="w-40 h-9 text-sm">
              <option value="">All Categories</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>
              ))}
            </FilterSelect>
            <FilterSelect paramName="location" className="w-40 h-9 text-sm">
              <option value="">All Locations</option>
              {LOCATIONS.map((l) => (
                <option key={l} value={l}>{l.replace(/_/g, ' ')}</option>
              ))}
            </FilterSelect>
            <FilterSelect paramName="condition" className="w-40 h-9 text-sm">
              <option value="">All Conditions</option>
              {CONDITIONS.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </FilterSelect>
            <FilterSelect paramName="cut_length" className="w-36 h-9 text-sm">
              <option value="">All</option>
              <option value="true">Cut-Length Only</option>
            </FilterSelect>
          </FilterBar>
        </CardContent>
      </Card>

      {/* Stock Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Serial #</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Condition</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Cut-Length</TableHead>
                <TableHead>Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pieces.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                    No stock pieces found.
                  </TableCell>
                </TableRow>
              ) : (
                pieces.map((piece) => (
                  <TableRow key={piece.id}>
                    <TableCell>
                      <Link href={`/inventory/${piece.id}`} className="text-[#00B050] hover:underline font-medium">
                        {piece.item_description}
                      </Link>
                      {piece.brand && (
                        <span className="text-xs text-muted-foreground ml-1">({piece.brand})</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="capitalize text-sm">{piece.item_category.replace(/_/g, ' ')}</span>
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {piece.serial_number ?? '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={locationVariant(piece.current_location)} className="capitalize">
                        {piece.current_location.replace(/_/g, ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={conditionVariant(piece.condition)} className="capitalize">
                        {piece.condition}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {piece.projects ? (
                        <Link href={`/projects/${piece.project_id}`} className="text-[#00B050] hover:underline">
                          {piece.projects.project_number}
                        </Link>
                      ) : '—'}
                    </TableCell>
                    <TableCell>
                      {piece.is_cut_length ? (
                        <div className="text-sm">
                          <div className="font-mono">
                            {piece.current_length_m ?? '?'}m / {piece.original_length_m ?? '?'}m
                          </div>
                          {piece.minimum_usable_length_m && piece.current_length_m && (
                            <div className="w-full bg-gray-200 rounded-full h-1.5 mt-1">
                              <div
                                className={`h-1.5 rounded-full ${
                                  piece.current_length_m <= piece.minimum_usable_length_m
                                    ? 'bg-[#991B1B]'
                                    : piece.current_length_m <= piece.minimum_usable_length_m * 2
                                    ? 'bg-[#EA580C]'
                                    : 'bg-[#00B050]'
                                }`}
                                style={{
                                  width: `${Math.min(100, ((piece.current_length_m) / (piece.original_length_m ?? piece.current_length_m)) * 100)}%`,
                                }}
                              />
                            </div>
                          )}
                          {piece.is_scrap && (
                            <Badge variant="destructive" className="text-[10px] mt-1">Scrap</Badge>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(piece.updated_at)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
