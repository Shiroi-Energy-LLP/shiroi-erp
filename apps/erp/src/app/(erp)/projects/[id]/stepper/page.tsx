import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { getProject } from '@/lib/projects-queries';
import { ProjectStepper } from '@/components/projects/project-stepper';
import { StepDetails } from '@/components/projects/stepper-steps/step-details';
import { StepSurvey } from '@/components/projects/stepper-steps/step-survey';
import { StepBom } from '@/components/projects/stepper-steps/step-bom';
import { StepBoq } from '@/components/projects/stepper-steps/step-boq';
import { StepDelivery } from '@/components/projects/stepper-steps/step-delivery';
import { StepExecution } from '@/components/projects/stepper-steps/step-execution';
import { StepQc } from '@/components/projects/stepper-steps/step-qc';
import { StepLiaison } from '@/components/projects/stepper-steps/step-liaison';
import { StepCommissioning } from '@/components/projects/stepper-steps/step-commissioning';
import { StepAmc } from '@/components/projects/stepper-steps/step-amc';

interface StepperPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ step?: string }>;
}

function StepLoadingFallback() {
  return (
    <div className="space-y-4">
      <div className="h-6 w-48 bg-[#F2F4F7] rounded animate-pulse" />
      <div className="h-32 bg-[#F2F4F7] rounded-lg animate-pulse" />
    </div>
  );
}

export default async function ProjectStepperPage({ params, searchParams }: StepperPageProps) {
  await requireRole(['founder', 'project_manager']);

  const { id } = await params;
  const { step } = await searchParams;

  const project = await getProject(id);
  if (!project) {
    notFound();
  }

  const activeStep = Math.min(Math.max(parseInt(step ?? '1', 10) || 1, 1), 10);

  // Determine completed steps based on project state
  const completedSteps = deriveCompletedSteps(project);

  return (
    <div className="space-y-6">
      {/* Stepper navigation */}
      <div className="bg-white rounded-lg border border-[#DFE2E8] p-5">
        <ProjectStepper
          projectId={id}
          activeStep={activeStep}
          completedSteps={completedSteps}
        />
      </div>

      {/* Step content */}
      <Suspense fallback={<StepLoadingFallback />}>
        <StepContent projectId={id} step={activeStep} />
      </Suspense>
    </div>
  );
}

function StepContent({ projectId, step }: { projectId: string; step: number }) {
  switch (step) {
    case 1:
      return <StepDetails projectId={projectId} />;
    case 2:
      return <StepSurvey projectId={projectId} />;
    case 3:
      return <StepBom projectId={projectId} />;
    case 4:
      return <StepBoq projectId={projectId} />;
    case 5:
      return <StepDelivery projectId={projectId} />;
    case 6:
      return <StepExecution projectId={projectId} />;
    case 7:
      return <StepQc projectId={projectId} />;
    case 8:
      return <StepLiaison projectId={projectId} />;
    case 9:
      return <StepCommissioning projectId={projectId} />;
    case 10:
      return <StepAmc projectId={projectId} />;
    default:
      return <StepDetails projectId={projectId} />;
  }
}

interface ProjectForStepper {
  status: string;
  completion_pct: number;
  commissioned_date: string | null;
  project_milestones?: Array<{
    status: string;
    completion_pct: number;
  }>;
}

function deriveCompletedSteps(project: ProjectForStepper): number[] {
  const completed: number[] = [];
  const pct = project.completion_pct;

  // Step 1 (Details) is always complete once a project exists
  completed.push(1);

  // Step 2 (Survey) — complete if project has progressed past initial stage
  if (pct > 0 || project.status !== 'advance_received') {
    completed.push(2);
  }

  // Steps 3-6 based on progress percentage thresholds
  if (pct >= 10) completed.push(3); // BOM
  if (pct >= 15) completed.push(4); // BOQ
  if (pct >= 25) completed.push(5); // Delivery
  if (pct >= 60) completed.push(6); // Execution
  if (pct >= 80) completed.push(7); // QC
  if (pct >= 90) completed.push(8); // Liaison

  // Step 9 (Commissioning) — complete if commissioned
  if (project.commissioned_date || project.status === 'commissioned' || project.status === 'completed') {
    completed.push(9);
  }

  // Step 10 (AMC) — complete if project is fully completed
  if (project.status === 'completed') {
    completed.push(10);
  }

  return completed;
}
