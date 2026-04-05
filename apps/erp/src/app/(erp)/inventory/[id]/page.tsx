import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getStockPiece } from '@/lib/inventory-queries';
import { CutLengthTracker } from '@/components/inventory/cut-length-tracker';
import { formatDate, formatINR } from '@repo/ui/formatters';
import {
  Card, CardHeader, CardTitle, CardContent, Badge,
} from '@repo/ui';

interface StockPieceDetailPageProps {
  params: Promise<{ id: string }>;
}

function locationVariant(loc: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (loc) {
    case 'warehouse': return 'default';
    case 'on_site': return 'secondary';
    case 'installed': return 'default';
    case 'scrapped': return 'destructive';
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

export default async function StockPieceDetailPage({ params }: StockPieceDetailPageProps) {
  const { id } = await params;
  const piece = await getStockPiece(id);

  if (!piece) {
    notFound();
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Link href="/inventory" className="text-sm text-[#00B050] hover:underline">
          &larr; Back to Inventory
        </Link>
        <h1 className="text-2xl font-heading font-bold text-[#1A1D24] mt-1">
          {piece.item_description}
        </h1>
        <div className="flex items-center gap-2 mt-1">
          <Badge variant={locationVariant(piece.current_location)} className="capitalize">
            {piece.current_location.replace(/_/g, ' ')}
          </Badge>
          <Badge variant={conditionVariant(piece.condition)} className="capitalize">
            {piece.condition}
          </Badge>
          {piece.is_cut_length && (
            <Badge variant="outline">Cut-Length</Badge>
          )}
          {piece.is_scrap && (
            <Badge variant="destructive">Scrapped</Badge>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Left column: Details */}
        <div className="col-span-2 space-y-6">
          {/* Item Info */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Item Details</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-4">
                <InfoItem label="Category" value={piece.item_category.replace(/_/g, ' ')} capitalize />
                <InfoItem label="Brand" value={piece.brand} />
                <InfoItem label="Model" value={piece.model} />
                <InfoItem label="Serial Number" value={piece.serial_number} />
                <InfoItem label="Unit Cost" value={piece.unit_cost ? formatINR(piece.unit_cost) : null} />
                <InfoItem label="Warehouse Location" value={piece.warehouse_location} />
              </div>
            </CardContent>
          </Card>

          {/* Project Allocation */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Allocation</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-xs text-muted-foreground mb-0.5">Allocated Project</div>
                  {piece.projects ? (
                    <Link href={`/projects/${piece.project_id}`} className="text-sm font-medium text-[#00B050] hover:underline">
                      {piece.projects.project_number} — {piece.projects.customer_name}
                    </Link>
                  ) : (
                    <div className="text-sm text-[#1A1D24]">—</div>
                  )}
                </div>
                <InfoItem label="Installed At" value={piece.installed_at ? formatDate(piece.installed_at) : null} />
              </div>
            </CardContent>
          </Card>

          {/* Audit Info */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Audit</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <InfoItem label="Created" value={formatDate(piece.created_at)} />
                <InfoItem label="Last Updated" value={formatDate(piece.updated_at)} />
                {piece.scrapped_at && (
                  <InfoItem label="Scrapped At" value={formatDate(piece.scrapped_at)} />
                )}
                {piece.scrap_reason && (
                  <InfoItem label="Scrap Reason" value={piece.scrap_reason} />
                )}
              </div>
              {piece.notes && (
                <div className="mt-4">
                  <div className="text-xs text-muted-foreground mb-0.5">Notes</div>
                  <p className="text-sm text-[#3E3E3E] whitespace-pre-wrap">{piece.notes}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right column: Cut-Length Tracker + Actions */}
        <div>
          <CutLengthTracker piece={piece} />
        </div>
      </div>
    </div>
  );
}

function InfoItem({ label, value, capitalize: cap }: { label: string; value: string | null | undefined; capitalize?: boolean }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground mb-0.5">{label}</div>
      <div className={`text-sm font-medium text-[#1A1D24] ${cap ? 'capitalize' : ''}`}>
        {value || '—'}
      </div>
    </div>
  );
}
