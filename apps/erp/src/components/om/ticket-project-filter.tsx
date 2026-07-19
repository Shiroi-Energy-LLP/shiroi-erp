'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ProjectCombobox } from '@/components/forms/project-combobox';

interface ProjectOpt {
  id: string;
  customer_name: string;
  project_number: string | null;
  project_name?: string | null;
}

interface TicketProjectFilterProps {
  projects: ProjectOpt[];
}

/**
 * URL-aware project autosearch filter for /om/tickets. Pushes `?project=<id>`
 * (and resets pagination) so the server-side getAllTickets honours the deep-link.
 */
export function TicketProjectFilter({ projects }: TicketProjectFilterProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const value = searchParams.get('project') ?? '';

  function handleChange(id: string) {
    const p = new URLSearchParams(searchParams.toString());
    if (id) {
      p.set('project', id);
    } else {
      p.delete('project');
    }
    p.delete('page'); // reset pagination on filter change
    const qs = p.toString();
    router.push(`/om/tickets${qs ? `?${qs}` : ''}`);
  }

  return (
    <ProjectCombobox
      projects={projects}
      value={value}
      onChange={handleChange}
      placeholder="Filter by project…"
      className="w-44"
      inputClassName="h-8 text-xs"
    />
  );
}
