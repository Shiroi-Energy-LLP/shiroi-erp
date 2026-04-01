'use client';

import { useRouter } from 'next/navigation';
import { Check } from 'lucide-react';

interface ProjectStepperProps {
  projectId: string;
  activeStep: number;
  completedSteps: number[];
}

const STEPS = [
  { number: 1, label: 'Details' },
  { number: 2, label: 'Survey' },
  { number: 3, label: 'BOM' },
  { number: 4, label: 'BOQ' },
  { number: 5, label: 'Delivery' },
  { number: 6, label: 'Execution' },
  { number: 7, label: 'QC' },
  { number: 8, label: 'Liaison' },
  { number: 9, label: 'Commission' },
  { number: 10, label: 'Free AMC' },
] as const;

export function ProjectStepper({ projectId, activeStep, completedSteps }: ProjectStepperProps) {
  const router = useRouter();

  function handleStepClick(stepNumber: number) {
    router.push(`/projects/${projectId}/stepper?step=${stepNumber}`);
  }

  return (
    <div className="overflow-x-auto pb-2">
      <div className="flex items-start min-w-[720px]">
        {STEPS.map((step, index) => {
          const isCompleted = completedSteps.includes(step.number);
          const isActive = step.number === activeStep;
          const isLast = index === STEPS.length - 1;

          // Connector is green if the current step is completed
          const connectorGreen = isCompleted;

          return (
            <div key={step.number} className="flex items-start flex-1">
              {/* Step circle + label */}
              <div className="flex flex-col items-center">
                <button
                  type="button"
                  onClick={() => handleStepClick(step.number)}
                  className={`
                    w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold
                    transition-all duration-200 cursor-pointer shrink-0
                    ${isCompleted
                      ? 'bg-[#00B050] text-white'
                      : isActive
                        ? 'bg-white border-2 border-[#00B050] text-[#00B050] shadow-[0_0_0_4px_rgba(0,176,80,0.15)]'
                        : 'bg-[#DFE2E8] text-[#7C818E] hover:bg-[#BFC3CC]'
                    }
                  `}
                  aria-label={`Step ${step.number}: ${step.label}`}
                  aria-current={isActive ? 'step' : undefined}
                >
                  {isCompleted ? (
                    <Check className="w-4 h-4" strokeWidth={3} />
                  ) : (
                    step.number
                  )}
                </button>
                <span
                  className={`
                    mt-1.5 text-center leading-tight whitespace-nowrap
                    ${isActive || isCompleted
                      ? 'text-[#1A1D24] font-medium'
                      : 'text-[#7C818E]'
                    }
                  `}
                  style={{ fontSize: '11px' }}
                >
                  {step.label}
                </span>
              </div>

              {/* Connector line */}
              {!isLast && (
                <div className="flex-1 flex items-center pt-4 px-1">
                  <div
                    className={`h-0.5 w-full ${connectorGreen ? 'bg-[#00B050]' : 'bg-[#DFE2E8]'}`}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
