// Project status helpers — shared between server and client code
// NOT a server action file (no 'use server')

const STATUS_ORDER: string[] = [
  'advance_received',
  'planning',
  'material_procurement',
  'installation',
  'electrical_work',
  'testing',
  'commissioned',
  'net_metering_pending',
  'completed',
];

export function getNextStatus(currentStatus: string): string | null {
  const idx = STATUS_ORDER.indexOf(currentStatus);
  if (idx === -1 || idx >= STATUS_ORDER.length - 1) return null;
  return STATUS_ORDER[idx + 1] ?? null;
}

export function getStatusLabel(status: string): string {
  return status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
