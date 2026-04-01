/**
 * Check if a task is overdue (due_date is in the past).
 * Uses IST timezone for comparison.
 */
export function isTaskOverdue(dueDate: string | null): boolean {
  if (!dueDate) return false;
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  return dueDate < todayStr;
}

/**
 * Format entity type for display.
 */
export function formatEntityType(entityType: string): string {
  const labels: Record<string, string> = {
    project: 'Project',
    lead: 'Lead',
    om_ticket: 'Service Ticket',
    procurement: 'Procurement',
    hr: 'HR',
  };
  return labels[entityType] ?? entityType;
}

/**
 * Get priority badge variant.
 */
export function priorityVariant(priority: string): 'error' | 'warning' | 'info' {
  switch (priority) {
    case 'high':
    case 'critical':
      return 'error';
    case 'medium':
      return 'warning';
    default:
      return 'info';
  }
}
