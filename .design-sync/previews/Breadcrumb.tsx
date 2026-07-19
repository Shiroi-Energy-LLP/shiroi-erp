import { Breadcrumb } from '@repo/ui';

export function ProjectPath() {
  return (
    <Breadcrumb
      items={[
        { label: 'Projects', href: '/projects' },
        { label: 'Sunrise Textiles', href: '/projects/sunrise-textiles' },
        { label: 'BOM' },
      ]}
    />
  );
}

export function TwoLevel() {
  return (
    <Breadcrumb
      items={[
        { label: 'Leads', href: '/leads' },
        { label: 'Kumar Residence' },
      ]}
    />
  );
}
