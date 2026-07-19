import { Skeleton } from '@repo/ui';

export function CardLoading() {
  return (
    <div style={{ maxWidth: 340, border: '1px solid #E5DFD3', borderRadius: 12, padding: 20, background: '#fff' }}>
      <Skeleton className="h-4 w-40" />
      <div style={{ height: 10 }} />
      <Skeleton className="h-3 w-full" />
      <div style={{ height: 8 }} />
      <Skeleton className="h-3 w-3/4" />
      <div style={{ height: 16 }} />
      <Skeleton className="h-9 w-28" />
    </div>
  );
}

export function ListLoading() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 360 }}>
      {[0, 1, 2].map((i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Skeleton className="h-10 w-10 rounded-full" />
          <div style={{ flex: 1 }}>
            <Skeleton className="h-3.5 w-1/2" />
            <div style={{ height: 6 }} />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}
