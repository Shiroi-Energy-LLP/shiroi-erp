'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { createCompany, updateCompany } from '@/lib/contacts-actions';
import { Card, CardHeader, CardTitle, CardContent, Button, Input, Select, Label, useToast } from '@repo/ui';
import { AlertTriangle } from 'lucide-react';

const SEGMENT_OPTIONS = [
  { value: 'residential', label: 'Residential' },
  { value: 'commercial', label: 'Commercial' },
  { value: 'industrial', label: 'Industrial' },
];

const SIZE_OPTIONS = [
  { value: '', label: '— Select —' },
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'large', label: 'Large' },
];

interface CompanyFormProps {
  company?: {
    id: string;
    name: string;
    segment: string;
    gstin: string | null;
    pan: string | null;
    industry: string | null;
    company_size: string | null;
    address_line1: string | null;
    address_line2: string | null;
    city: string | null;
    state: string | null;
    pincode: string | null;
    website: string | null;
    notes: string | null;
  };
}

export function CompanyForm({ company }: CompanyFormProps) {
  const router = useRouter();
  const { addToast } = useToast();
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const isEdit = !!company;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const form = new FormData(e.currentTarget);

    if (isEdit) {
      const res = await updateCompany(company!.id, {
        name: form.get('name') as string,
        segment: form.get('segment') as string,
        gstin: form.get('gstin') as string,
        pan: form.get('pan') as string,
        industry: form.get('industry') as string,
        companySize: form.get('companySize') as string,
        addressLine1: form.get('addressLine1') as string,
        addressLine2: form.get('addressLine2') as string,
        city: form.get('city') as string,
        state: form.get('state') as string,
        pincode: form.get('pincode') as string,
        website: form.get('website') as string,
        notes: form.get('notes') as string,
      });
      setLoading(false);
      if (res.success) {
        addToast({ variant: 'success', title: 'Company saved', description: 'The company has been saved successfully.' });
        router.push(`/companies/${company!.id}`);
        router.refresh();
      } else {
        const errMsg = res.error ?? 'Failed to update company';
        setError(errMsg);
        addToast({ variant: 'destructive', title: 'Failed to save company', description: errMsg });
      }
    } else {
      const res = await createCompany({
        name: form.get('name') as string,
        segment: form.get('segment') as string,
        gstin: form.get('gstin') as string,
        pan: form.get('pan') as string,
        industry: form.get('industry') as string,
        companySize: form.get('companySize') as string,
        addressLine1: form.get('addressLine1') as string,
        city: form.get('city') as string,
        state: form.get('state') as string,
        pincode: form.get('pincode') as string,
        website: form.get('website') as string,
        notes: form.get('notes') as string,
      });
      setLoading(false);
      if (res.success && res.companyId) {
        addToast({ variant: 'success', title: 'Company saved', description: 'The company has been saved successfully.' });
        router.push(`/companies/${res.companyId}`);
      } else {
        const errMsg = res.error ?? 'Failed to create company';
        setError(errMsg);
        addToast({ variant: 'destructive', title: 'Failed to save company', description: errMsg });
      }
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <Card>
        <CardHeader>
          <CardTitle>{isEdit ? 'Edit Company' : 'New Company'}</CardTitle>
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
              <Input id="name" name="name" required defaultValue={company?.name ?? ''} placeholder="e.g., ABC Builders Pvt Ltd" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="segment">Segment *</Label>
              <Select id="segment" name="segment" required defaultValue={company?.segment ?? 'commercial'}>
                {SEGMENT_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="gstin">GSTIN</Label>
              <Input id="gstin" name="gstin" defaultValue={company?.gstin ?? ''} placeholder="33AABCU9603R1ZZ" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pan">PAN</Label>
              <Input id="pan" name="pan" defaultValue={company?.pan ?? ''} placeholder="AABCU9603R" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="industry">Industry</Label>
              <Input id="industry" name="industry" defaultValue={company?.industry ?? ''} placeholder="e.g., Manufacturing" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="companySize">Company Size</Label>
              <Select id="companySize" name="companySize" defaultValue={company?.company_size ?? ''}>
                {SIZE_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="city">City</Label>
              <Input id="city" name="city" defaultValue={company?.city ?? ''} placeholder="e.g., Chennai" />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="addressLine1">Address Line 1</Label>
              <Input id="addressLine1" name="addressLine1" defaultValue={company?.address_line1 ?? ''} placeholder="Street address" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="state">State</Label>
              <Input id="state" name="state" defaultValue={company?.state ?? 'Tamil Nadu'} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pincode">Pincode</Label>
              <Input id="pincode" name="pincode" defaultValue={company?.pincode ?? ''} placeholder="600001" maxLength={6} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="website">Website</Label>
            <Input id="website" name="website" defaultValue={company?.website ?? ''} placeholder="https://..." />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes</Label>
            <textarea
              id="notes"
              name="notes"
              rows={3}
              defaultValue={company?.notes ?? ''}
              className="flex w-full rounded-md border-[1.5px] border-[#DFE2E8] bg-white px-3 py-2 text-[13px] text-[#1A1D24] focus-visible:outline-none focus-visible:border-[#00B050] focus-visible:shadow-[0_0_0_3px_rgba(0,176,80,0.1)]"
              placeholder="Any notes about this company..."
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="ghost" onClick={() => router.back()} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? (isEdit ? 'Saving...' : 'Creating...') : (isEdit ? 'Save Changes' : 'Create Company')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
