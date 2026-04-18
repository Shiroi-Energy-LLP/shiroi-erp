import { redirect } from 'next/navigation';
import { getUserProfile } from '@/lib/auth';
import { listMyBugReports, listAllUsers } from '@/lib/settings-queries';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@repo/ui';
import { AccountTab } from './_client/account-tab';
import { FeedbackTab } from './_client/feedback-tab';
import { UsersTab } from './_client/users-tab';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const profile = await getUserProfile();
  if (!profile) redirect('/login');

  const [myReports, users] = await Promise.all([
    listMyBugReports(),
    profile.role === 'founder' ? listAllUsers() : Promise.resolve([]),
  ]);

  const isFounder = profile.role === 'founder';

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-xl font-heading font-bold text-n-900 mb-4">Settings</h1>
      <Tabs defaultValue="account">
        <TabsList>
          <TabsTrigger value="account">Account</TabsTrigger>
          <TabsTrigger value="feedback">Feedback</TabsTrigger>
          {isFounder && <TabsTrigger value="users">Users</TabsTrigger>}
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
      </Tabs>
    </div>
  );
}
