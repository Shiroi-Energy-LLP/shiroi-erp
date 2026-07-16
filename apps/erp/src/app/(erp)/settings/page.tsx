import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getUserProfile } from '@/lib/auth';
import { listMyBugReports, listAllUsers } from '@/lib/settings-queries';
import { getSystemSettings } from '@/lib/system-settings-queries';
import type { SystemSettingsRow } from '@/lib/system-settings-queries';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@repo/ui';
import { AccountTab } from './_client/account-tab';
import { FeedbackTab } from './_client/feedback-tab';
import { UsersTab } from './_client/users-tab';
import { SystemTab } from './_client/system-tab';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const profile = await getUserProfile();
  if (!profile) redirect('/login');

  const isFounder = profile.role === 'founder';
  const canSeeZohoSync = profile.role === 'founder' || profile.role === 'finance';

  const [myReports, users, systemSettings] = await Promise.all([
    listMyBugReports(),
    isFounder ? listAllUsers() : Promise.resolve([]),
    isFounder ? getSystemSettings() : Promise.resolve(null as SystemSettingsRow | null),
  ]);

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-xl font-heading font-bold text-n-900 mb-4">Settings</h1>
      <Tabs defaultValue="account">
        <TabsList>
          <TabsTrigger value="account">Account</TabsTrigger>
          <TabsTrigger value="feedback">Feedback</TabsTrigger>
          {isFounder && <TabsTrigger value="users">Users</TabsTrigger>}
          {isFounder && <TabsTrigger value="system">System</TabsTrigger>}
        </TabsList>

        <TabsContent value="account" className="mt-4">
          <AccountTab
            fullName={profile.full_name}
            email={profile.email}
            role={profile.role}
          />
        </TabsContent>

        <TabsContent value="feedback" className="mt-4">
          <FeedbackTab myReports={myReports} />
        </TabsContent>

        {isFounder && (
          <TabsContent value="users" className="mt-4">
            <UsersTab users={users} currentUserId={profile.id} />
          </TabsContent>
        )}

        {isFounder && (
          <TabsContent value="system" className="mt-4">
            <SystemTab
              currentlyEnabled={systemSettings?.proposal_gate_enabled ?? true}
              updatedAt={systemSettings?.updated_at ?? null}
              updatedByName={systemSettings?.updated_by_name ?? null}
            />
          </TabsContent>
        )}
      </Tabs>

      {/* Integrations — sub-pages with their own server-side role gates */}
      {canSeeZohoSync && (
        <div className="mt-6 flex items-center justify-between rounded-md border border-n-200 bg-white p-4">
          <div>
            <h2 className="text-sm font-semibold text-n-900">Zoho Books Sync</h2>
            <p className="text-xs text-n-500">
              Live sync status per entity, voucher push health, and manual sync trigger.
            </p>
          </div>
          <Link
            href="/settings/zoho-sync"
            className="text-sm font-medium text-shiroi-gold-dark underline-offset-4 hover:underline"
          >
            Open →
          </Link>
        </div>
      )}
    </div>
  );
}
