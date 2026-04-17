'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ProjectCombobox } from '@/components/forms/project-combobox';

interface ProjectOpt {
  id: string;
  customer_name: string;
  project_number: string | null;
}

interface ProjectFilterComboboxProps {
  projects: ProjectOpt[];
}

export function ProjectFilterCombobox({ projects }: ProjectFilterComboboxProps) {
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
    router.push(`/om/plant-monitoring?${p.toString()}`);
  }

  return (
    <ProjectCombobox
      projects={projects}
      value={value}
      onChange={handleChange}
      placeholder="Filter by project…"
      className="w-48"
      inputClassName="h-8 text-xs"
    />
  );
}
