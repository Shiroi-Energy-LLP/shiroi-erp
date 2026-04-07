'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Card, CardHeader, CardTitle, CardContent,
  Button, Input, Label, Select,
} from '@repo/ui';
import { Plus } from 'lucide-react';
import { createVendorDeliveryChallan } from '@/lib/project-step-actions';

interface DeliveryChallanFormProps {
  projectId: string;
  vendors: { id: string; company_name: string }[];
}

export function DeliveryChallanForm({ projectId, vendors }: DeliveryChallanFormProps) {
  const router = useRouter();
  const [showForm, setShowForm] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const fd = new FormData(e.currentTarget);

    const result = await createVendorDeliveryChallan({
      projectId,
      data: {
        vendor_dc_number: (fd.get('vendor_dc_number') as string) || '',
        vendor_dc_date: (fd.get('vendor_dc_date') as string) || new Date().toISOString().split('T')[0]!,
        vendor_id: (fd.get('vendor_id') as string) || null,
        received_date: (fd.get('received_date') as string) || null,
        status: (fd.get('status') as string) || 'pending',
      },
    });

    setSaving(false);
    if (result.success) {
      setShowForm(false);
      router.refresh();
    } else {
      setError(result.error ?? 'Failed to create delivery challan');
    }
  }

  if (!showForm) {
    return (
      <div className="mb-4">
        <Button size="sm" onClick={() => setShowForm(true)}>
          <Plus className="h-4 w-4 mr-1" /> Upload DC
        </Button>
      </div>
    );
  }

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="text-base">Record Delivery Challan</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Label htmlFor="vendor_dc_number">DC Number *</Label>
              <Input id="vendor_dc_number" name="vendor_dc_number" required placeholder="e.g. DC-2026-001" />
            </div>
            <div>
              <Label htmlFor="vendor_dc_date">DC Date *</Label>
              <Input id="vendor_dc_date" name="vendor_dc_date" type="date" defaultValue={new Date().toISOString().split('T')[0]} required />
            </div>
            <div>
              <Label htmlFor="vendor_id">Vendor</Label>
              <Select id="vendor_id" name="vendor_id">
                <option value="">Select vendor...</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>{v.company_name}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="received_date">Received Date</Label>
              <Input id="received_date" name="received_date" type="date" />
            </div>
            <div>
              <Label htmlFor="status">Status</Label>
              <Select id="status" name="status" defaultValue="pending">
                <option value="pending">Pending</option>
                <option value="accepted">Accepted</option>
                <option value="partial">Partial</option>
                <option value="rejected">Rejected</option>
              </Select>
            </div>
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">{error}</p>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving...' : 'Record DC'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
