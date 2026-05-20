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
    </div>
  );
}
