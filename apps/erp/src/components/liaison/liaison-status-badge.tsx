'use client';

const TNEB_STAGE_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  pending:                { bg: '#F1F3F5', text: '#3F424D', label: 'Pending' },
  applied:                { bg: '#EFF6FF', text: '#1E40AF', label: 'Applied' },
  tneb_verified:          { bg: '#E0E7FF', text: '#3730A3', label: 'Verified' },
  tneb_inspected:         { bg: '#EDE9FE', text: '#5B21B6', label: 'Inspected' },
  tneb_estimated:         { bg: '#FEF3C7', text: '#92400E', label: 'Estimated' },
  installation_completed: { bg: '#CCFBF1', text: '#0F766E', label: 'Installation Done' },
  service_effected:       { bg: '#DCFCE7', text: '#166534', label: 'Service Effected' },
  rejected:               { bg: '#FEE2E2', text: '#991B1B', label: 'Rejected' },
  objection_raised:       { bg: '#FFEDD5', text: '#9A3412', label: 'Objection Raised' },
};

const CEIG_STAGE_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  not_applicable:       { bg: '#F1F3F5', text: '#6B7280', label: 'N/A' },
  pending:              { bg: '#FEF3C7', text: '#92400E', label: 'CEIG Pending' },
  applied:              { bg: '#EFF6FF', text: '#1E40AF', label: 'CEIG Applied' },
  inspection_scheduled: { bg: '#EDE9FE', text: '#5B21B6', label: 'Inspection Sched.' },
  approved:             { bg: '#DCFCE7', text: '#166534', label: 'CEIG Approved' },
  rejected:             { bg: '#FEE2E2', text: '#991B1B', label: 'CEIG Rejected' },
  reapplied:            { bg: '#FFF7ED', text: '#9A3412', label: 'Reapplied' },
};

interface BadgeProps {
  status: string;
  className?: string;
}

export function TnebStageBadge({ status, className = '' }: BadgeProps) {
  const style = TNEB_STAGE_STYLES[status] ?? { bg: '#F1F3F5', text: '#3F424D', label: status.replace(/_/g, ' ') };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 text-[10px] font-semibold uppercase tracking-wider h-5 ${className}`}
      style={{ backgroundColor: style.bg, color: style.text }}
    >
      {style.label}
    </span>
  );
}

export function CeigStageBadge({ status, className = '' }: BadgeProps) {
  const style = CEIG_STAGE_STYLES[status] ?? { bg: '#F1F3F5', text: '#3F424D', label: status.replace(/_/g, ' ') };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 text-[10px] font-semibold uppercase tracking-wider h-5 ${className}`}
      style={{ backgroundColor: style.bg, color: style.text }}
    >
      {style.label}
    </span>
  );
}

export function AwaitingClientBadge({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 text-[10px] font-semibold uppercase tracking-wider h-5 ${className}`}
      style={{ backgroundColor: '#FFF7ED', color: '#9A3412' }}
    >
      Awaiting Client
    </span>
  );
}
