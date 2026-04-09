// Project status helpers — shared between server and client code
// NOT a server action file (no 'use server')

// Simplified 8-stage project flow (migration 031).
// Linear order for "Advance" button: Order Received → Yet to Start →
// In Progress → Waiting Net Metering → Completed. Holding and client-
// scope stages are off the critical path (set manually, no "next").
const STATUS_ORDER: string[] = [
  'order_received',
  'yet_to_start',
  'in_progress',
  'waiting_net_metering',
  'completed',
];

const STATUS_LABELS: Record<string, string> = {
  order_received: 'Order Received',
  yet_to_start: 'Yet to Start',
  in_progress: 'In Progress',
  completed: 'Completed',
  holding_shiroi: 'Holding from Shiroi',
  holding_client: 'Holding from Client',
  waiting_net_metering: 'Waiting for Net Metering',
  meter_client_scope: 'Meter - Client Scope',
};

export function getNextStatus(currentStatus: string): string | null {
  const idx = STATUS_ORDER.indexOf(currentStatus);
  if (idx === -1 || idx >= STATUS_ORDER.length - 1) return null;
  return STATUS_ORDER[idx + 1] ?? null;
}

export function getStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
