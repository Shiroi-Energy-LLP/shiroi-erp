'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { createCompany } from '@/lib/contacts-actions';
import { Card, CardHeader, CardTitle, CardContent, Button, Input, Select, Label } from '@repo/ui';
import { AlertTriangle } from 'lucide-react';

const SEGMENT_OPTIONS = [
  { value: 'residential', label: 'Residential' },
  { value: 'commercial', label: 'Commercial' },
  { value: 'industrial', label: 'Industrial' },
];

export function CompanyForm() {
  const router = useRouter();
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const form = new FormData(e.currentTarget);
    const res = await createCompany({
      name: form.get('name') as string,
      segment: form.get('segment') as string,
      gstin: form.get('gstin') as string,
      addressLine1: form.get('addressLine1') as string,
      city: form.get('city') as string,
      state: form.get('state') as string,
      pincode: form.get('pincode') as string,
      website: form.get('website') as string,
      notes: form.get('notes') as string,
    });

    setLoading(false);
    if (res.success && res.companyId) {
      router.push(`/companies/${res.companyId}`);
    } else {
      setError(res.error ?? 'Failed to create company');
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <Card>
        <CardHeader>
          <CardTitle>New Company</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#991B1B]">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" />
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="name">Company Name *</Label>
              <Input id="name" name="name" required placeholder="e.g., ABC Builders Pvt Ltd" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="segment">Segment *</Label>
              <Select id="segment" name="segment" required defaultValue="commercial">
                {SEGMENT_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="gstin">GSTIN</Label>
              <Input id="gstin" name="gstin" placeholder="e.g., 33AABCU9603R1ZZ" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="city">City</Label>
              <Input id="city" name="city" placeholder="e.g., Chennai" />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="addressLine1">Address</Label>
              <Input id="addressLine1" name="addressLine1" placeholder="Street address" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="state">State</Label>
              <Input id="state" name="state" defaultValue="Tamil Nadu" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pincode">Pincode</Label>
              <Input id="pincode" name="pincode" placeholder="600001" maxLength={6} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="website">Website</Label>
            <Input id="website" name="website" placeholder="https://..." />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="ghost" onClick={() => router.push('/companies')} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Creating...' : 'Create Company'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
