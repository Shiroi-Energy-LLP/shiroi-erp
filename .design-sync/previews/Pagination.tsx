import { Pagination } from '@repo/ui';

export function MidRange() {
  return (
    <div style={{ maxWidth: 640, border: '1px solid #E5DFD3', borderRadius: 12, background: '#fff' }}>
      <Pagination
        currentPage={3}
        totalPages={8}
        pageSize={20}
        totalItems={156}
        basePath="/projects"
        entityName="projects"
      />
    </div>
  );
}

export function FirstPage() {
  return (
    <div style={{ maxWidth: 640, border: '1px solid #E5DFD3', borderRadius: 12, background: '#fff' }}>
      <Pagination
        currentPage={1}
        totalPages={5}
        pageSize={25}
        totalItems={118}
        basePath="/leads"
        entityName="leads"
      />
    </div>
  );
}
