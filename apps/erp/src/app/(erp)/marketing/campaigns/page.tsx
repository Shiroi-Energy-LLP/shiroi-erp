import Link from 'next/link';
import { createClient } from '@repo/supabase/server';
import { formatDate } from '@repo/ui/formatters';
import {
  Card,
  CardContent,
  Badge,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  EmptyState,
  Eyebrow,
} from '@repo/ui';
import { Megaphone } from 'lucide-react';

function campaignStatusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'active':
      return 'default';
    case 'completed':
      return 'secondary';
    case 'draft':
      return 'outline';
    case 'paused':
      return 'outline';
    case 'cancelled':
      return 'destructive';
    default:
      return 'outline';
  }
}

export default async function CampaignsPage() {
  let campaigns: Array<{
    id: string;
    campaign_name: string;
    channel: string;
    start_date: string;
    end_date: string;
    target_count: number;
    sent_count: number;
    responded_count: number;
    converted_count: number;
    status: string;
  }> = [];

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('marketing_campaigns')
      .select('id, campaign_name, channel, start_date, end_date, target_count, sent_count, responded_count, converted_count, status')
      .order('start_date', { ascending: false });

    if (error) {
      console.error('[CampaignsPage] Query failed:', { code: error.code, message: error.message });
      throw error;
    }
    campaigns = (data ?? []) as typeof campaigns;
  } catch {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-heading font-bold text-[#1A1D24]">Marketing Campaigns</h1>
        <Card>
          <CardContent>
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <p className="text-sm text-[#7C818E]">No data available. Could not load campaigns.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Link href="/marketing" className="text-sm text-[#00B050] hover:underline">
            &larr; Back to Marketing
          </Link>
          <Eyebrow className="mb-1">CAMPAIGNS</Eyebrow>
          <h1 className="text-2xl font-heading font-bold text-[#1A1D24] mt-1">Marketing Campaigns</h1>
          <p className="text-sm text-gray-500">
            {campaigns.length} campaign{campaigns.length !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Campaign Name</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Start Date</TableHead>
                <TableHead>End Date</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Leads Generated</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {campaigns.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7}>
                    <EmptyState
                      icon={<Megaphone className="h-12 w-12" />}
                      title="No campaigns found"
                      description="Create a marketing campaign to start tracking lead generation efforts."
                    />
                  </TableCell>
                </TableRow>
              ) : (
                campaigns.map((campaign) => (
                  <TableRow key={campaign.id}>
                    <TableCell className="font-medium">{campaign.campaign_name}</TableCell>
                    <TableCell className="capitalize">
                      {campaign.channel?.replace(/_/g, ' ') ?? '—'}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(campaign.start_date)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(campaign.end_date)}
                    </TableCell>
                    <TableCell>{campaign.target_count}</TableCell>
                    <TableCell>{campaign.converted_count}</TableCell>
                    <TableCell>
                      <Badge variant={campaignStatusVariant(campaign.status)}>
                        {campaign.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
