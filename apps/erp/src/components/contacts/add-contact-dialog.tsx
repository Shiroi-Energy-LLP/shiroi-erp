'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { linkContactToEntity, createContact } from '@/lib/contacts-actions';
import { Button, Input, Label, Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@repo/ui';
import { Search, Plus, UserPlus } from 'lucide-react';

interface AddContactDialogProps {
  entityType: 'lead' | 'proposal' | 'project';
  entityId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddContactDialog({ entityType, entityId, open, onOpenChange }: AddContactDialogProps) {
  const router = useRouter();
  const [mode, setMode] = React.useState<'search' | 'create'>('search');
  const [searchQuery, setSearchQuery] = React.useState('');
  const [searchResults, setSearchResults] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [roleLabel, setRoleLabel] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  // New contact fields
  const [newName, setNewName] = React.useState('');
  const [newPhone, setNewPhone] = React.useState('');
  const [newEmail, setNewEmail] = React.useState('');

  async function handleSearch() {
    if (!searchQuery.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/contacts/search?q=${encodeURIComponent(searchQuery)}`);
      const data = await res.json();
      setSearchResults(data);
    } catch {
      setError('Search failed');
    }
    setLoading(false);
  }

  async function handleLink(contactId: string) {
    setLoading(true);
    const result = await linkContactToEntity({
      contactId,
      entityType,
      entityId,
      roleLabel: roleLabel.trim() || undefined,
    });
    setLoading(false);
    if (result.success) {
      onOpenChange(false);
      router.refresh();
    } else {
      setError(result.error ?? 'Failed to link contact');
    }
  }

  async function handleCreateAndLink() {
    if (!newName.trim()) { setError('Name is required'); return; }
    setLoading(true);
    setError(null);

    // Split name into first/last for the new createContact signature
    const nameParts = newName.trim().split(/\s+/);
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || undefined;

    const createResult = await createContact({
      firstName,
      lastName,
      phone: newPhone.trim() || undefined,
      email: newEmail.trim() || undefined,
    });

    if (!createResult.success || !createResult.contactId) {
      setLoading(false);
      setError(createResult.error ?? 'Failed to create contact');
      return;
    }

    const linkResult = await linkContactToEntity({
      contactId: createResult.contactId,
      entityType,
      entityId,
      roleLabel: roleLabel.trim() || undefined,
    });

    setLoading(false);
    if (linkResult.success) {
      onOpenChange(false);
      router.refresh();
    } else {
      setError(linkResult.error ?? 'Contact created but linking failed');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Contact to {entityType}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Role label — shared between search and create */}
          <div className="space-y-1.5">
            <Label>Role (optional)</Label>
            <Input
              value={roleLabel}
              onChange={(e) => setRoleLabel(e.target.value)}
              placeholder="e.g., Purchase Head, Site Contact"
            />
          </div>

          {/* Mode toggle */}
          <div className="flex gap-2">
            <Button
              variant={mode === 'search' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setMode('search')}
              className="gap-1"
            >
              <Search className="h-3.5 w-3.5" /> Search Existing
            </Button>
            <Button
              variant={mode === 'create' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setMode('create')}
              className="gap-1"
            >
              <UserPlus className="h-3.5 w-3.5" /> Create New
            </Button>
          </div>

          {mode === 'search' && (
            <>
              <div className="flex gap-2">
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by name or phone..."
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleSearch())}
                />
                <Button variant="outline" size="sm" onClick={handleSearch} disabled={loading}>
                  Search
                </Button>
              </div>

              {searchResults.length > 0 && (
                <div className="max-h-48 overflow-y-auto space-y-1">
                  {searchResults.map((c: any) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => handleLink(c.id)}
                      disabled={loading}
                      className="w-full text-left rounded-md border border-n-200 p-2 hover:bg-n-050 transition-colors"
                    >
                      <p className="text-sm font-medium text-n-900">{c.name}</p>
                      <p className="text-xs text-n-500">
                        {[c.phone, c.email, c.designation].filter(Boolean).join(' · ')}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {mode === 'create' && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Name *</Label>
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Full name" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Phone</Label>
                  <Input value={newPhone} onChange={(e) => setNewPhone(e.target.value)} placeholder="Phone" />
                </div>
                <div className="space-y-1.5">
                  <Label>Email</Label>
                  <Input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="Email" />
                </div>
              </div>
              <Button onClick={handleCreateAndLink} disabled={loading} className="w-full gap-1">
                <Plus className="h-4 w-4" />
                {loading ? 'Creating...' : 'Create & Link'}
              </Button>
            </div>
          )}

          {error && <p className="text-sm text-status-error-text">{error}</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
