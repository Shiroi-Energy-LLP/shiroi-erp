'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { createContact } from '@/lib/contacts-actions';
import { Card, CardHeader, CardTitle, CardContent, Button, Input, Label } from '@repo/ui';
import { AlertTriangle } from 'lucide-react';

export function ContactForm() {
  const router = useRouter();
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const form = new FormData(e.currentTarget);
    const res = await createContact({
      name: form.get('name') as string,
      phone: form.get('phone') as string,
      email: form.get('email') as string,
      designation: form.get('designation') as string,
      notes: form.get('notes') as string,
    });

    setLoading(false);
    if (res.success && res.contactId) {
      router.push(`/contacts/${res.contactId}`);
    } else {
      setError(res.error ?? 'Failed to create contact');
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <Card>
        <CardHeader>
          <CardTitle>New Contact</CardTitle>
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
              <Label htmlFor="name">Full Name *</Label>
              <Input id="name" name="name" required placeholder="e.g., Rajesh Kumar" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" name="phone" placeholder="10-digit mobile" maxLength={10} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" placeholder="email@example.com" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="designation">Designation</Label>
              <Input id="designation" name="designation" placeholder="e.g., Purchase Head" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes</Label>
            <textarea
              id="notes"
              name="notes"
              rows={3}
              className="flex w-full rounded-md border-[1.5px] border-[#DFE2E8] bg-white px-3 py-2 text-[13px] text-[#1A1D24] focus-visible:outline-none focus-visible:border-[#00B050] focus-visible:shadow-[0_0_0_3px_rgba(0,176,80,0.1)]"
              placeholder="Any notes about this contact..."
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="ghost" onClick={() => router.push('/contacts')} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Creating...' : 'Create Contact'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
