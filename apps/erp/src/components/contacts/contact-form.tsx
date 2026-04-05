'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { createContact, updateContact } from '@/lib/contacts-actions';
import { Card, CardHeader, CardTitle, CardContent, Button, Input, Select, Label, useToast } from '@repo/ui';
import { AlertTriangle } from 'lucide-react';

const LIFECYCLE_OPTIONS = [
  { value: 'subscriber', label: 'Subscriber' },
  { value: 'lead', label: 'Lead' },
  { value: 'opportunity', label: 'Opportunity' },
  { value: 'customer', label: 'Customer' },
  { value: 'evangelist', label: 'Evangelist' },
];

interface ContactFormProps {
  contact?: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    name: string;
    phone: string | null;
    secondary_phone: string | null;
    email: string | null;
    designation: string | null;
    lifecycle_stage: string | null;
    source: string | null;
    notes: string | null;
  };
}

export function ContactForm({ contact }: ContactFormProps) {
  const router = useRouter();
  const { addToast } = useToast();
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const isEdit = !!contact;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const form = new FormData(e.currentTarget);

    if (isEdit) {
      const res = await updateContact(contact!.id, {
        firstName: form.get('firstName') as string,
        lastName: form.get('lastName') as string,
        phone: form.get('phone') as string,
        secondaryPhone: form.get('secondaryPhone') as string,
        email: form.get('email') as string,
        designation: form.get('designation') as string,
        lifecycleStage: form.get('lifecycleStage') as string,
        source: form.get('source') as string,
        notes: form.get('notes') as string,
      });
      setLoading(false);
      if (res.success) {
        addToast({ variant: 'success', title: 'Contact saved', description: 'The contact has been saved successfully.' });
        router.push(`/contacts/${contact!.id}`);
        router.refresh();
      } else {
        const errMsg = res.error ?? 'Failed to update contact';
        setError(errMsg);
        addToast({ variant: 'destructive', title: 'Failed to save contact', description: errMsg });
      }
    } else {
      const res = await createContact({
        firstName: form.get('firstName') as string,
        lastName: form.get('lastName') as string,
        phone: form.get('phone') as string,
        secondaryPhone: form.get('secondaryPhone') as string,
        email: form.get('email') as string,
        designation: form.get('designation') as string,
        lifecycleStage: form.get('lifecycleStage') as string,
        source: form.get('source') as string,
        notes: form.get('notes') as string,
      });
      setLoading(false);
      if (res.success && res.contactId) {
        addToast({ variant: 'success', title: 'Contact saved', description: 'The contact has been saved successfully.' });
        router.push(`/contacts/${res.contactId}`);
      } else {
        const errMsg = res.error ?? 'Failed to create contact';
        setError(errMsg);
        addToast({ variant: 'destructive', title: 'Failed to save contact', description: errMsg });
      }
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <Card>
        <CardHeader>
          <CardTitle>{isEdit ? 'Edit Contact' : 'New Contact'}</CardTitle>
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
              <Label htmlFor="firstName">First Name *</Label>
              <Input id="firstName" name="firstName" required defaultValue={contact?.first_name ?? ''} placeholder="e.g., Rajesh" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lastName">Last Name</Label>
              <Input id="lastName" name="lastName" defaultValue={contact?.last_name ?? ''} placeholder="e.g., Kumar" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" name="phone" defaultValue={contact?.phone ?? ''} placeholder="10-digit mobile" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="secondaryPhone">Secondary Phone</Label>
              <Input id="secondaryPhone" name="secondaryPhone" defaultValue={contact?.secondary_phone ?? ''} placeholder="WhatsApp / alternate" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" defaultValue={contact?.email ?? ''} placeholder="email@example.com" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="designation">Designation</Label>
              <Input id="designation" name="designation" defaultValue={contact?.designation ?? ''} placeholder="e.g., Purchase Head" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="lifecycleStage">Lifecycle Stage</Label>
              <Select id="lifecycleStage" name="lifecycleStage" defaultValue={contact?.lifecycle_stage ?? 'lead'}>
                {LIFECYCLE_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="source">Source</Label>
              <Input id="source" name="source" defaultValue={contact?.source ?? ''} placeholder="e.g., Referral, Walk-in, Website" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes</Label>
            <textarea
              id="notes"
              name="notes"
              rows={3}
              defaultValue={contact?.notes ?? ''}
              className="flex w-full rounded-md border-[1.5px] border-[#DFE2E8] bg-white px-3 py-2 text-[13px] text-[#1A1D24] focus-visible:outline-none focus-visible:border-[#00B050] focus-visible:shadow-[0_0_0_3px_rgba(0,176,80,0.1)]"
              placeholder="Any notes about this contact..."
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="ghost" onClick={() => router.back()} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? (isEdit ? 'Saving...' : 'Creating...') : (isEdit ? 'Save Changes' : 'Create Contact')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
