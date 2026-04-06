import { notFound } from 'next/navigation';
import { getLead, getLeadActivities } from '@/lib/leads-queries';
import { ActivityFeed } from '@/components/leads/activity-feed';
import { AddActivityForm } from '@/components/leads/add-activity-form';
import { Card, CardHeader, CardTitle, CardContent } from '@repo/ui';

interface ActivitiesTabProps {
  params: Promise<{ id: string }>;
}

export default async function ActivitiesTab({ params }: ActivitiesTabProps) {
  const { id } = await params;
  const [lead, activities] = await Promise.all([
    getLead(id),
    getLeadActivities(id),
  ]);

  if (!lead) {
    notFound();
  }

  return (
    <div className="space-y-6">
      {/* Quick call log form at the top (most common action) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Log Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <AddActivityForm leadId={id} />
        </CardContent>
      </Card>

      {/* Activity timeline */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Activity History ({activities.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {activities.length === 0 ? (
            <p className="text-sm text-n-500">No activities logged yet. Log the first call above.</p>
          ) : (
            <ActivityFeed activities={activities} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
