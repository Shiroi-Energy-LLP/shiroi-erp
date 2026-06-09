export function formatCustomerProject(input: {
  companyName: string | null | undefined;
  customerName: string | null | undefined;
  projectName: string | null | undefined;
}): string {
  const base = (input.companyName?.trim() || input.customerName?.trim() || '');
  const project = input.projectName?.trim() || '';
  if (base && project) return `${base} — ${project}`;
  return base || project;
}
