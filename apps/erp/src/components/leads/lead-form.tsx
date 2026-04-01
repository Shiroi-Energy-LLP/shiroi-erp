'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@repo/supabase/client';
import { Card, CardHeader, CardTitle, CardContent, Button, Input, Label, Select } from '@repo/ui';
import { normalizePhone } from '@/lib/leads-helpers';
import type { Database } from '@repo/types/database';

type CustomerSegment = Database['public']['Enums']['customer_segment'];
type LeadSource = Database['public']['Enums']['lead_source'];
type SystemType = Database['public']['Enums']['system_type'];

const SEGMENTS: { value: CustomerSegment; label: string }[] = [
  { value: 'residential', label: 'Residential' },
  { value: 'commercial', label: 'Commercial' },
  { value: 'industrial', label: 'Industrial' },
];

const SOURCES: { value: LeadSource; label: string }[] = [
  { value: 'referral', label: 'Referral' },
  { value: 'website', label: 'Website' },
  { value: 'builder_tie_up', label: 'Builder Tie-up' },
  { value: 'channel_partner', label: 'Channel Partner' },
  { value: 'cold_call', label: 'Cold Call' },
  { value: 'exhibition', label: 'Exhibition' },
  { value: 'social_media', label: 'Social Media' },
  { value: 'walkin', label: 'Walk-in' },
];

const SYSTEM_TYPES: { value: SystemType; label: string }[] = [
  { value: 'on_grid', label: 'On Grid' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'off_grid', label: 'Off Grid' },
];

const STATES = [
  'Tamil Nadu', 'Kerala', 'Karnataka', 'Andhra Pradesh', 'Telangana',
  'Maharashtra', 'Pondicherry',
];

export function LeadForm() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    customer_name: '',
    phone: '',
    email: '',
    city: '',
    state: 'Tamil Nadu',
    pincode: '',
    address_line1: '',
    address_line2: '',
    segment: '' as CustomerSegment | '',
    source: '' as LeadSource | '',
    system_type: '' as SystemType | '',
    estimated_size_kwp: '',
    notes: '',
  });

  function updateField(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (error) setError(null);
  }

  function handlePhoneBlur() {
    if (form.phone) {
      updateField('phone', normalizePhone(form.phone));
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const op = '[LeadForm.handleSubmit]';

    if (!form.customer_name || !form.phone || !form.city || !form.segment || !form.source) {
      setError('Please fill all required fields.');
      return;
    }

    const normalizedPhone = normalizePhone(form.phone);
    if (normalizedPhone.length !== 10) {
      setError('Phone number must be 10 digits.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    const supabase = createClient();
    const newId = crypto.randomUUID();

    const { error: insertError } = await supabase.from('leads').insert({
      id: newId,
      customer_name: form.customer_name.trim(),
      phone: normalizedPhone,
      email: form.email.trim() || null,
      city: form.city.trim(),
      state: form.state || undefined,
      pincode: form.pincode.trim() || null,
      address_line1: form.address_line1.trim() || null,
      address_line2: form.address_line2.trim() || null,
      segment: form.segment as CustomerSegment,
      source: form.source as LeadSource,
      system_type: form.system_type ? (form.system_type as SystemType) : null,
      estimated_size_kwp: form.estimated_size_kwp ? parseFloat(form.estimated_size_kwp) : null,
      notes: form.notes.trim() || null,
      status: 'new' as const,
    });

    if (insertError) {
      console.error(`${op} Insert failed:`, { code: insertError.code, message: insertError.message });
      if (insertError.code === '23505' && insertError.message.includes('phone')) {
        setError('A lead with this phone number already exists.');
      } else {
        setError(`Failed to create lead: ${insertError.message}`);
      }
      setIsSubmitting(false);
      return;
    }

    router.push(`/leads/${newId}`);
  }

  return (
    <form onSubmit={handleSubmit}>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">New Lead</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {error && (
            <div className="rounded-md bg-[#FEF2F2] border border-[#DC2626] px-4 py-2 text-sm text-[#991B1B]">
              {error}
            </div>
          )}

          {/* Required fields */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="customer_name">Customer Name *</Label>
              <Input
                id="customer_name"
                value={form.customer_name}
                onChange={(e) => updateField('customer_name', e.target.value)}
                placeholder="Full name"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Phone *</Label>
              <Input
                id="phone"
                value={form.phone}
                onChange={(e) => updateField('phone', e.target.value)}
                onBlur={handlePhoneBlur}
                placeholder="10-digit mobile number"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="city">City *</Label>
              <Input
                id="city"
                value={form.city}
                onChange={(e) => updateField('city', e.target.value)}
                placeholder="e.g. Chennai"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="state">State</Label>
              <Select
                id="state"
                value={form.state}
                onChange={(e) => updateField('state', e.target.value)}
              >
                {STATES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="pincode">Pincode</Label>
              <Input
                id="pincode"
                value={form.pincode}
                onChange={(e) => updateField('pincode', e.target.value)}
                placeholder="600001"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="segment">Segment *</Label>
              <Select
                id="segment"
                value={form.segment}
                onChange={(e) => updateField('segment', e.target.value)}
                required
              >
                <option value="">Select segment</option>
                {SEGMENTS.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="source">Source *</Label>
              <Select
                id="source"
                value={form.source}
                onChange={(e) => updateField('source', e.target.value)}
                required
              >
                <option value="">Select source</option>
                {SOURCES.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </Select>
            </div>
          </div>

          {/* Optional fields */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={form.email}
                onChange={(e) => updateField('email', e.target.value)}
                placeholder="customer@example.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="system_type">System Type</Label>
              <Select
                id="system_type"
                value={form.system_type}
                onChange={(e) => updateField('system_type', e.target.value)}
              >
                <option value="">Select type</option>
                {SYSTEM_TYPES.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="estimated_size_kwp">Estimated Size (kWp)</Label>
              <Input
                id="estimated_size_kwp"
                type="number"
                step="0.1"
                min="0"
                value={form.estimated_size_kwp}
                onChange={(e) => updateField('estimated_size_kwp', e.target.value)}
                placeholder="e.g. 10"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="address_line1">Address Line 1</Label>
              <Input
                id="address_line1"
                value={form.address_line1}
                onChange={(e) => updateField('address_line1', e.target.value)}
                placeholder="Street address"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <textarea
              id="notes"
              value={form.notes}
              onChange={(e) => updateField('notes', e.target.value)}
              placeholder="Any additional notes about this lead..."
              rows={3}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => router.back()}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Creating...' : 'Create Lead'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
