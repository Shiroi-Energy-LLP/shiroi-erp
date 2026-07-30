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

interface AmcProjectFilterProps {
  projects: ProjectOpt[];
}

/**
 * URL-aware project autosearch filter for /om/amc — replaces the plain
 * <select> of every project, which was unusable once the list grew.
 * Pushes `?project=<id>` so the server-side getAllAmcData honours deep links.
 */
export function AmcProjectFilter({ projects }: AmcProjectFilterProps) {
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
    const qs = p.toString();
    router.push(`/om/amc${qs ? `?${qs}` : ''}`);
  }

  return (
    <ProjectCombobox
      projects={projects}
      value={value}
      onChange={handleChange}
      placeholder="Filter by project…"
      className="w-52"
      inputClassName="h-8 text-xs"
    />
  );
}
