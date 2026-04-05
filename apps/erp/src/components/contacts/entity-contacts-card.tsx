'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { unlinkContactFromEntity } from '@/lib/contacts-actions';
import { AddContactDialog } from './add-contact-dialog';
import { Card, CardHeader, CardTitle, CardContent, Button, Badge } from '@repo/ui';
import { Plus, X, Users } from 'lucide-react';

interface EntityContact {
  id: string;
  role_label: string | null;
  is_primary: boolean;
  contacts: {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    designation: string | null;
  } | null;
}

interface EntityContactsCardProps {
  entityType: 'lead' | 'proposal' | 'project';
  entityId: string;
  contacts: EntityContact[];
}

export function EntityContactsCard({ entityType, entityId, contacts }: EntityContactsCardProps) {
  const router = useRouter();
  const [showAdd, setShowAdd] = React.useState(false);

  async function handleUnlink(entityContactId: string) {
    const result = await unlinkContactFromEntity(entityContactId);
    if (result.success) router.refresh();
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4 text-n-500" />
            Contacts
          </CardTitle>
          <Button variant="outline" size="sm" onClick={() => setShowAdd(true)} className="h-7 text-xs gap-1">
            <Plus className="h-3.5 w-3.5" /> Add
          </Button>
        </CardHeader>
        <CardContent>
          {contacts.length === 0 ? (
            <p className="text-sm text-n-400 py-2 text-center">No contacts linked.</p>
          ) : (
            <div className="space-y-2">
              {contacts.map((ec) => (
                <div key={ec.id} className="flex items-center justify-between rounded-md border border-n-200 px-3 py-2">
                  <div>
                    <Link
                      href={`/contacts/${ec.contacts?.id}`}
                      className="text-sm font-medium text-shiroi-green hover:underline"
                    >
                      {ec.contacts?.name}
                    </Link>
                    <div className="flex items-center gap-2 mt-0.5">
                      {ec.role_label && (
                        <span className="text-xs text-n-500">{ec.role_label}</span>
                      )}
                      {ec.contacts?.phone && (
                        <span className="text-xs text-n-400 font-mono">{ec.contacts.phone}</span>
                      )}
                      {ec.is_primary && <Badge variant="success" className="text-[8px]">Primary</Badge>}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleUnlink(ec.id)}
                    className="text-n-400 hover:text-status-error-text transition-colors"
                    title="Remove contact"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <AddContactDialog
        entityType={entityType}
        entityId={entityId}
        open={showAdd}
        onOpenChange={setShowAdd}
      />
    </>
  );
}
