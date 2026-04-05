'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { createActivity } from '@/lib/contacts-actions';
import { Card, CardHeader, CardTitle, CardContent, Button, Input, Select, Label, Badge } from '@repo/ui';
import {
  MessageSquare, Phone, Mail, Users, MapPin, MessageCircle,
  CheckSquare, ArrowRight, Plus, Clock, X,
} from 'lucide-react';

const ACTIVITY_TYPE_CONFIG: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  note: { label: 'Note', icon: MessageSquare, color: '#7C818E' },
  call: { label: 'Call', icon: Phone, color: '#2563EB' },
  email: { label: 'Email', icon: Mail, color: '#9333EA' },
  meeting: { label: 'Meeting', icon: Users, color: '#00B050' },
  site_visit: { label: 'Site Visit', icon: MapPin, color: '#EA580C' },
  whatsapp: { label: 'WhatsApp', icon: MessageCircle, color: '#25D366' },
  task: { label: 'Task', icon: CheckSquare, color: '#0891B2' },
  status_change: { label: 'Status Change', icon: ArrowRight, color: '#DC2626' },
};

interface Activity {
  id: string;
  activity_type: string;
  title: string | null;
  body: string | null;
  occurred_at: string;
  duration_minutes: number | null;
  owner: { full_name: string } | null;
  metadata: Record<string, unknown>;
}

interface ActivityTimelineProps {
  activities: Activity[];
  entityType: string;
  entityId: string;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export function ActivityTimeline({ activities, entityType, entityId }: ActivityTimelineProps) {
  const router = useRouter();
  const [showForm, setShowForm] = React.useState(false);
  const [formType, setFormType] = React.useState('note');
  const [saving, setSaving] = React.useState(false);

  async function handleAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    const form = new FormData(e.currentTarget);

    const res = await createActivity({
      activityType: form.get('activityType') as string,
      title: form.get('title') as string,
      body: form.get('body') as string,
      durationMinutes: form.get('duration') ? parseInt(form.get('duration') as string, 10) : undefined,
      entityLinks: [{ entityType, entityId }],
    });

    setSaving(false);
    if (res.success) {
      setShowForm(false);
      router.refresh();
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Clock className="h-4 w-4 text-[#7C818E]" />
          Activity Timeline
        </CardTitle>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowForm(!showForm)}
          className="h-7 text-xs gap-1"
        >
          {showForm ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
          {showForm ? 'Cancel' : 'Log Activity'}
        </Button>
      </CardHeader>
      <CardContent>
        {/* Add Activity Form */}
        {showForm && (
          <form onSubmit={handleAdd} className="mb-4 rounded-lg border border-[#DFE2E8] p-4 bg-[#FAFBFC] space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Type</Label>
                <Select
                  name="activityType"
                  value={formType}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setFormType(e.target.value)}
                >
                  {Object.entries(ACTIVITY_TYPE_CONFIG).filter(([k]) => k !== 'status_change').map(([val, cfg]) => (
                    <option key={val} value={val}>{cfg.label}</option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Title</Label>
                <Input name="title" placeholder="Brief summary..." className="h-9" />
              </div>
            </div>
            {(formType === 'call' || formType === 'meeting') && (
              <div className="space-y-1">
                <Label className="text-xs">Duration (minutes)</Label>
                <Input name="duration" type="number" placeholder="e.g., 15" className="h-9 w-32" />
              </div>
            )}
            <div className="space-y-1">
              <Label className="text-xs">Details</Label>
              <textarea
                name="body"
                rows={3}
                className="flex w-full rounded-md border-[1.5px] border-[#DFE2E8] bg-white px-3 py-2 text-[13px] text-[#1A1D24] focus-visible:outline-none focus-visible:border-[#00B050] focus-visible:shadow-[0_0_0_3px_rgba(0,176,80,0.1)]"
                placeholder="What happened?"
              />
            </div>
            <div className="flex justify-end">
              <Button type="submit" size="sm" disabled={saving}>
                {saving ? 'Saving...' : 'Log Activity'}
              </Button>
            </div>
          </form>
        )}

        {/* Timeline */}
        {activities.length === 0 ? (
          <p className="text-sm text-[#9CA0AB] py-6 text-center">No activities recorded yet.</p>
        ) : (
          <div className="relative">
            {/* Vertical line */}
            <div className="absolute left-[15px] top-2 bottom-2 w-px bg-[#DFE2E8]" />

            <div className="space-y-4">
              {activities.map((act) => {
                const config = ACTIVITY_TYPE_CONFIG[act.activity_type] ?? ACTIVITY_TYPE_CONFIG.note;
                const Icon = config.icon;

                return (
                  <div key={act.id} className="relative flex gap-3 pl-1">
                    {/* Icon dot */}
                    <div
                      className="relative z-10 flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-full border-2 border-white bg-white"
                      style={{ boxShadow: `0 0 0 2px ${config.color}20` }}
                    >
                      <Icon className="h-3.5 w-3.5" style={{ color: config.color }} />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0 pt-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge
                          variant="neutral"
                          className="text-[10px] font-medium"
                          style={{ color: config.color, borderColor: `${config.color}30`, backgroundColor: `${config.color}10` }}
                        >
                          {config.label}
                        </Badge>
                        {act.title && (
                          <span className="text-sm font-medium text-[#1A1D24]">{act.title}</span>
                        )}
                        {act.duration_minutes && (
                          <span className="text-xs text-[#9CA0AB]">{act.duration_minutes} min</span>
                        )}
                      </div>
                      {act.body && (
                        <p className="text-sm text-[#3F424D] mt-1 whitespace-pre-wrap">{act.body}</p>
                      )}
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className="text-xs text-[#9CA0AB]">{formatDate(act.occurred_at)}</span>
                        {act.owner && (
                          <span className="text-xs text-[#7C818E]">by {act.owner.full_name}</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
