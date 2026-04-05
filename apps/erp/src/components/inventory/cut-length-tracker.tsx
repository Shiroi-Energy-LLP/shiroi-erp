'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { updateCutLength, scrapStockPiece, updateStockLocation } from '@/lib/inventory-actions';
import {
  Card, CardHeader, CardTitle, CardContent, Button, Input, Label, Badge,
} from '@repo/ui';
import { Scissors, AlertTriangle, Ruler, MapPin } from 'lucide-react';

interface CutLengthTrackerProps {
  piece: {
    id: string;
    item_description: string;
    brand: string | null;
    is_cut_length: boolean;
    original_length_m: number | null;
    current_length_m: number | null;
    minimum_usable_length_m: number | null;
    is_scrap: boolean;
    scrap_reason: string | null;
    current_location: string;
    warehouse_location: string | null;
    condition: string;
  };
}

const LOCATIONS = ['warehouse', 'in_transit', 'on_site', 'installed', 'scrapped', 'returned'];

export function CutLengthTracker({ piece }: CutLengthTrackerProps) {
  const router = useRouter();
  const [saving, setSaving] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);

  const usagePercent = piece.original_length_m && piece.current_length_m
    ? ((piece.original_length_m - piece.current_length_m) / piece.original_length_m) * 100
    : 0;

  const remainingPercent = piece.original_length_m && piece.current_length_m
    ? (piece.current_length_m / piece.original_length_m) * 100
    : 100;

  const isLow = piece.current_length_m !== null && piece.minimum_usable_length_m !== null
    && piece.current_length_m < piece.minimum_usable_length_m * 2;

  async function handleCutUpdate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving('cut');
    setError(null);
    setSuccess(null);

    const form = new FormData(e.currentTarget);
    const newLength = parseFloat(form.get('newLength') as string);
    const notes = form.get('notes') as string;

    if (isNaN(newLength) || newLength < 0) {
      setError('Please enter a valid length');
      setSaving(null);
      return;
    }

    const res = await updateCutLength({
      stockPieceId: piece.id,
      newLengthM: newLength,
      notes: notes || undefined,
    });

    setSaving(null);
    if (res.success) {
      setSuccess('Length updated successfully');
      router.refresh();
    } else {
      setError(res.error ?? 'Failed to update');
    }
  }

  async function handleLocationUpdate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving('location');
    setError(null);

    const form = new FormData(e.currentTarget);
    const location = form.get('location') as string;
    const warehouseLocation = form.get('warehouseLocation') as string;

    const res = await updateStockLocation({
      stockPieceId: piece.id,
      location,
      warehouseLocation: warehouseLocation || undefined,
    });

    setSaving(null);
    if (res.success) {
      setSuccess('Location updated');
      router.refresh();
    } else {
      setError(res.error ?? 'Failed to update location');
    }
  }

  async function handleScrap() {
    const reason = prompt('Reason for scrapping this piece:');
    if (!reason) return;

    setSaving('scrap');
    const res = await scrapStockPiece({ stockPieceId: piece.id, reason });
    setSaving(null);

    if (res.success) {
      router.refresh();
    } else {
      setError(res.error ?? 'Failed to scrap piece');
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#991B1B]">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          {error}
        </div>
      )}
      {success && (
        <div className="flex items-center gap-2 rounded-lg border border-[#BBF7D0] bg-[#F0FDF4] px-4 py-3 text-sm text-[#065F46]">
          {success}
        </div>
      )}

      {/* Cut-Length Section */}
      {piece.is_cut_length && (
        <Card className={isLow ? 'border-[#EA580C]/30' : ''}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Scissors className="h-4 w-4" />
              Cut-Length Tracking
              {piece.is_scrap && <Badge variant="destructive" className="ml-auto">Scrapped</Badge>}
              {isLow && !piece.is_scrap && <Badge variant="warning" className="ml-auto">Low Stock</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Visual gauge */}
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">
                  {piece.current_length_m ?? 0}m remaining of {piece.original_length_m ?? '?'}m
                </span>
                <span className="font-mono text-xs">
                  {usagePercent.toFixed(1)}% used
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-3">
                <div
                  className={`h-3 rounded-full transition-all ${
                    piece.is_scrap
                      ? 'bg-[#991B1B]'
                      : isLow
                      ? 'bg-[#EA580C]'
                      : 'bg-[#00B050]'
                  }`}
                  style={{ width: `${Math.max(2, remainingPercent)}%` }}
                />
              </div>
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>0m</span>
                {piece.minimum_usable_length_m && (
                  <span className="text-[#EA580C]">Min: {piece.minimum_usable_length_m}m</span>
                )}
                <span>{piece.original_length_m}m</span>
              </div>
            </div>

            {/* Update form */}
            {!piece.is_scrap && (
              <form onSubmit={handleCutUpdate} className="space-y-3 pt-2 border-t">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">New Length (m)</Label>
                    <Input
                      name="newLength"
                      type="number"
                      step="0.01"
                      max={piece.current_length_m ?? undefined}
                      min="0"
                      placeholder={`Max: ${piece.current_length_m}m`}
                      className="h-9 text-sm font-mono"
                      required
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Notes (optional)</Label>
                    <Input
                      name="notes"
                      placeholder="Cut for project, etc."
                      className="h-9 text-sm"
                    />
                  </div>
                </div>
                {piece.minimum_usable_length_m && (
                  <p className="text-xs text-muted-foreground">
                    <Ruler className="h-3 w-3 inline mr-1" />
                    Minimum usable length: {piece.minimum_usable_length_m}m. Below this will auto-scrap.
                  </p>
                )}
                <Button type="submit" size="sm" disabled={saving === 'cut'}>
                  {saving === 'cut' ? 'Updating...' : 'Record Cut'}
                </Button>
              </form>
            )}

            {piece.is_scrap && piece.scrap_reason && (
              <div className="text-sm text-[#991B1B] bg-[#FEF2F2] p-3 rounded-md">
                <strong>Scrap reason:</strong> {piece.scrap_reason}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Location Update */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <MapPin className="h-4 w-4" />
            Location
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLocationUpdate} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Current Location</Label>
                <select
                  name="location"
                  defaultValue={piece.current_location}
                  className="h-9 w-full rounded-md border px-3 text-sm"
                >
                  {LOCATIONS.map((l) => (
                    <option key={l} value={l}>{l.replace(/_/g, ' ')}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Warehouse Shelf/Bin</Label>
                <Input
                  name="warehouseLocation"
                  defaultValue={piece.warehouse_location ?? ''}
                  placeholder="e.g. Shelf A3, Bin 12"
                  className="h-9 text-sm"
                />
              </div>
            </div>
            <Button type="submit" variant="outline" size="sm" disabled={saving === 'location'}>
              {saving === 'location' ? 'Updating...' : 'Update Location'}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Scrap Action */}
      {!piece.is_scrap && (
        <div className="flex justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={handleScrap}
            disabled={saving === 'scrap'}
            className="text-[#991B1B] border-[#991B1B]/30 hover:bg-[#FEF2F2]"
          >
            {saving === 'scrap' ? 'Processing...' : 'Mark as Scrap'}
          </Button>
        </div>
      )}
    </div>
  );
}
