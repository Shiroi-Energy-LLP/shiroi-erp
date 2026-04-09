import { notFound } from 'next/navigation';
import { getProjectHeader } from '@/lib/projects-queries';
import { ProjectHeader } from '@/components/projects/detail/project-header';
import {
  ProjectStepper,
  deriveCompletedStages,
} from '@/components/projects/detail/project-stepper';

interface ProjectDetailLayoutProps {
  params: Promise<{ id: string }>;
  children: React.ReactNode;
}

export default async function ProjectDetailLayout({ params, children }: ProjectDetailLayoutProps) {
  const { id } = await params;
  const project = await getProjectHeader(id);

  if (!project) {
    notFound();
  }

  const completedStages = deriveCompletedStages(project);

  return (
    <div className="space-y-4">
      <ProjectHeader project={project} />
      <ProjectStepper projectId={id} completedStages={completedStages} />
      {children}
    </div>
  );
}
