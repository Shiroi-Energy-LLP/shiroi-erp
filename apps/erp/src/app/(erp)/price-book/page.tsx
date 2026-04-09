import { createClient } from '@repo/supabase/server';
import { formatINR, formatDate } from '@repo/ui/formatters';
import {
  Card,
  CardContent,
  Badge,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  EmptyState,
  Eyebrow,
} from '@repo/ui';
import { BookOpen } from 'lucide-react';

function categoryVariant(category: string): 'default' | 'secondary' | 'outline' {
  switch (category) {
    case 'Solar Panel':
    case 'Inverter':
      return 'default';
    case 'Battery':
    case 'MMS':
      return 'secondary';
    default:
      return 'outline';
  }
}

export default async function PriceBookPage() {
  let items: Array<{
    id: string;
    item_description: string;
    item_category: string;
    unit: string;
    base_price: number;
    gst_rate: number;
    gst_type: string;
    hsn_code: string | null;
    brand: string | null;
    model: string | null;
    specification: string | null;
    effective_from: string;
    is_active: boolean;
    updated_at: string;
  }> = [];

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('price_book')
      .select('id, item_description, item_category, unit, base_price, gst_rate, gst_type, hsn_code, brand, model, specification, effective_from, is_active, updated_at')
      .eq('is_active', true)
      .order('item_category', { ascending: true })
      .order('item_description', { ascending: true });

    if (error) {
      console.error('[PriceBookPage] Query failed:', { code: error.code, message: error.message });
      throw error;
    }
    items = (data ?? []) as typeof items;
  } catch {
    return (
      <div className="space-y-6">
        <div>
          <Eyebrow className="mb-1">PRICE BOOK</Eyebrow>
          <h1 className="text-2xl font-heading font-bold text-[#1A1D24]">Price Book</h1>
        </div>
        <Card>
          <CardContent>
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <p className="text-sm text-[#7C818E]">Could not load price book. Please try again later.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Eyebrow className="mb-1">PRICE BOOK</Eyebrow>
        <h1 className="text-2xl font-heading font-bold text-[#1A1D24]">Price Book</h1>
        <p className="text-sm text-gray-500">
          {items.length} item{items.length !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>HSN</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead className="text-right">Base Rate</TableHead>
                  <TableHead className="text-right">GST %</TableHead>
                  <TableHead className="text-right">Effective Rate</TableHead>
                  <TableHead>Effective From</TableHead>
                  <TableHead>Last Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9}>
                      <EmptyState
                        icon={<BookOpen className="h-12 w-12" />}
                        title="No price book entries"
                        description="Standard material pricing, vendor rate cards, and BOM cost templates will be maintained here."
                      />
                    </TableCell>
                  </TableRow>
                ) : (
                  items.map((item) => {
                    const effectiveRate = item.base_price * (1 + item.gst_rate / 100);
                    return (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium max-w-[280px]">
                          <div>{item.item_description}</div>
                          {(item.brand || item.model || item.specification) && (
                            <div className="text-xs text-[#7C818E] mt-0.5">
                              {[item.brand, item.model, item.specification].filter(Boolean).join(' / ')}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant={categoryVariant(item.item_category)}>
                            {item.item_category}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs text-[#7C818E]">
                          {item.hsn_code ?? '—'}
                        </TableCell>
                        <TableCell>{item.unit}</TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {formatINR(item.base_price)}
                        </TableCell>
                        <TableCell className="text-right text-sm">
                          {item.gst_rate}%
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm font-medium">
                          {formatINR(effectiveRate)}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDate(item.effective_from)}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDate(item.updated_at.split('T')[0] ?? item.updated_at)}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
