'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  Button,
  Input,
} from '@repo/ui';
import { Search, UserPlus, Phone, Mail, MapPin, ExternalLink } from 'lucide-react';
import { EditableField } from './editable-field';
import {
  searchContactsLite,
  updateProjectField,
} from '@/lib/project-detail-actions';

interface CustomerInfoBoxProps {
  projectId: string;
  project: {
    customer_name: string;
    customer_email: string | null;
    customer_phone: string;
    primary_contact_id: string | null;
    site_address_line1: string;
    site_address_line2: string | null;
    site_city: string;
    site_state: string;
    site_pincode: string | null;
    billing_address: string | null;
    location_map_link: string | null;
  };
  primaryContact: {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
  } | null;
}

export function CustomerInfoBox({ projectId, project, primaryContact }: CustomerInfoBoxProps) {
  const router = useRouter();
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [results, setResults] = React.useState<
    { id: string; name: string; phone: string | null; email: string | null }[]
  >([]);
  const [searching, setSearching] = React.useState(false);
  const [linking, setLinking] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Debounced search
  React.useEffect(() => {
    if (!pickerOpen) return;
    const t = setTimeout(async () => {
      setSearching(true);
      const res = await searchContactsLite(query);
      setResults(res);
      setSearching(false);
    }, 250);
    return () => clearTimeout(t);
  }, [query, pickerOpen]);

  async function linkContact(contact: { id: string; name: string; phone: string | null; email: string | null }) {
    setLinking(true);
    setError(null);

    // Update three fields — primary_contact_id is the source of truth, but we
    // also mirror name/phone/email into the denormalized project columns so
    // that list pages and old code paths still see the right customer.
    const updates = [
      updateProjectField({ projectId, field: 'primary_contact_id', value: contact.id }),
      updateProjectField({ projectId, field: 'customer_name', value: contact.name }),
      ...(contact.phone
        ? [updateProjectField({ projectId, field: 'customer_phone', value: contact.phone })]
        : []),
      ...(contact.email
        ? [updateProjectField({ projectId, field: 'customer_email', value: contact.email })]
        : []),
    ];

    const results = await Promise.all(updates);
    setLinking(false);
    const failure = results.find((r) => !r.success);
    if (failure) {
      setError(failure.error ?? 'Failed to link contact');
      return;
    }
    setPickerOpen(false);
    router.refresh();
  }

  const displayContactName = primaryContact?.name ?? project.customer_name;
  const displayPhone = primaryContact?.phone ?? project.customer_phone;
  const displayEmail = primaryContact?.email ?? project.customer_email;

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Customer Information</CardTitle>
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="flex items-center gap-1.5 text-xs text-shiroi-green hover:underline"
            >
              <Search className="h-3.5 w-3.5" /> Link contact
            </button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Contact row — from the contacts DB if linked */}
          <div className="grid grid-cols-1 gap-3">
            <div>
              <div className="text-xs text-n-500 mb-0.5">Contact Name</div>
              <div className="text-sm font-medium text-n-900">{displayContactName}</div>
              {primaryContact && (
                <div className="text-[11px] text-n-400 mt-0.5">from contacts DB</div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-xs text-n-500 mb-0.5">Phone</div>
                <div className="text-sm font-mono text-n-900 flex items-center gap-1.5">
                  <Phone className="h-3 w-3 text-n-400" /> {displayPhone || '—'}
                </div>
              </div>
              <div>
                <div className="text-xs text-n-500 mb-0.5">Email</div>
                <div className="text-sm text-n-900 flex items-center gap-1.5">
                  <Mail className="h-3 w-3 text-n-400" /> {displayEmail || '—'}
                </div>
              </div>
            </div>
          </div>

          <div className="border-t border-n-100 -mx-6" />

          {/* Site address — PM editable */}
          <div className="space-y-3">
            <div>
              <div className="text-xs text-n-500 mb-0.5 flex items-center gap-1">
                <MapPin className="h-3 w-3" /> Site Address
              </div>
              <EditableField
                projectId={projectId}
                field="site_address_line1"
                value={project.site_address_line1}
                placeholder="Address line 1"
              />
              <div className="mt-1">
                <EditableField
                  projectId={projectId}
                  field="site_address_line2"
                  value={project.site_address_line2}
                  placeholder="Address line 2"
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <EditableField
                projectId={projectId}
                field="site_city"
                label="City"
                value={project.site_city}
              />
              <EditableField
                projectId={projectId}
                field="site_state"
                label="State"
                value={project.site_state}
              />
              <EditableField
                projectId={projectId}
                field="site_pincode"
                label="Pincode"
                value={project.site_pincode}
              />
            </div>
          </div>

          <div className="border-t border-n-100 -mx-6" />

          {/* Billing address */}
          <EditableField
            projectId={projectId}
            field="billing_address"
            label="Billing Address (if different)"
            value={project.billing_address}
            type="textarea"
            placeholder="Leave empty to use site address"
          />

          {/* Google Maps link */}
          <div>
            <EditableField
              projectId={projectId}
              field="location_map_link"
              label="Location (Google Maps link)"
              value={project.location_map_link}
              type="url"
              placeholder="https://maps.google.com/…"
              render={(v) => {
                if (!v) return <span className="text-n-400">—</span>;
                return (
                  <a
                    href={String(v)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm text-shiroi-green hover:underline inline-flex items-center gap-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    Open in Maps <ExternalLink className="h-3 w-3" />
                  </a>
                );
              }}
            />
          </div>
        </CardContent>
      </Card>

      {/* Contact picker dialog */}
      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Link Customer Contact</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, phone, or email…"
              autoFocus
            />
            <div className="max-h-80 overflow-y-auto border border-n-200 rounded">
              {searching ? (
                <div className="p-4 text-sm text-n-500 text-center">Searching…</div>
              ) : results.length === 0 ? (
                <div className="p-4 text-sm text-n-500 text-center">
                  {query ? 'No contacts found' : 'Start typing to search contacts'}
                </div>
              ) : (
                results.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    disabled={linking}
                    onClick={() => linkContact(c)}
                    className="w-full text-left p-3 border-b border-n-100 last:border-b-0 hover:bg-n-50 disabled:opacity-50"
                  >
                    <div className="font-medium text-sm text-n-900">{c.name}</div>
                    <div className="text-xs text-n-500 flex items-center gap-3 mt-0.5">
                      {c.phone && (
                        <span className="font-mono flex items-center gap-1">
                          <Phone className="h-3 w-3" /> {c.phone}
                        </span>
                      )}
                      {c.email && (
                        <span className="flex items-center gap-1">
                          <Mail className="h-3 w-3" /> {c.email}
                        </span>
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>
            {error && (
              <div className="text-xs text-red-600 bg-red-50 px-2 py-1.5 rounded border border-red-200">
                {error}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPickerOpen(false)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
