'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Input, Select, Button } from '@repo/ui';
import { ProjectCombobox } from '@/components/forms/project-combobox';
import type { ActivityStageOption } from '@/lib/project-activities-constants';

interface GlobalActivitiesFiltersProps {
  projects: { id: string; project_number: string | null; customer_name: string }[];
  stages: ActivityStageOption[];
}

export function GlobalActivitiesFilters({ projects, stages }: GlobalActivitiesFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function setParam(key: string, value: string) {
    const sp = new URLSearchParams(searchParams.toString());
    if (value) sp.set(key, value);
    else sp.delete(key);
    sp.delete('page'); // filters reset pagination
    const qs = sp.toString();
    router.replace(qs ? `/activities?${qs}` : '/activities');
  }

  const hasAny = ['project', 'from', 'to', 'stage'].some((k) => !!searchParams.get(k));

  return (
    <div className="flex items-end gap-2 flex-wrap">
      <div className="w-[260px]">
        <label className="block text-[10px] text-n-500 mb-0.5">Project</label>
        <ProjectCombobox
          projects={projects}
          value={searchParams.get('project') ?? ''}
          onChange={(id) => setParam('project', id)}
          inputClassName="h-8 text-xs"
        />
      </div>
      <div>
        <label className="block text-[10px] text-n-500 mb-0.5">From</label>
        <Input type="date" className="h-8 text-xs" value={searchParams.get('from') ?? ''}
          onChange={(e) => setParam('from', e.target.value)} />
      </div>
      <div>
        <label className="block text-[10px] text-n-500 mb-0.5">To</label>
        <Input type="date" className="h-8 text-xs" value={searchParams.get('to') ?? ''}
          onChange={(e) => setParam('to', e.target.value)} />
      </div>
      <div>
        <label className="block text-[10px] text-n-500 mb-0.5">Stage</label>
        <Select className="h-8 text-xs w-[180px]" value={searchParams.get('stage') ?? ''}
          onChange={(e) => setParam('stage', e.target.value)}>
          <option value="">All stages</option>
          {stages.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </Select>
      </div>
      {hasAny && (
        <Button size="sm" variant="ghost" className="text-xs h-8" onClick={() => router.replace('/activities')}>
          Clear filters
        </Button>
      )}
    </div>
  );
}
