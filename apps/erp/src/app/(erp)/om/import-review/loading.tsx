import { Card, CardContent } from '@repo/ui';

export default function ImportReviewLoading() {
  return (
    <div className="space-y-4">
      <div className="h-12 bg-n-100 rounded animate-pulse" />
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i}><CardContent className="py-3"><div className="h-12 bg-n-100 rounded animate-pulse" /></CardContent></Card>
        ))}
      </div>
      <div className="h-8 bg-n-100 rounded animate-pulse" />
      <div className="h-12 bg-n-100 rounded animate-pulse" />
      <div className="space-y-2">
        {[1, 2, 3, 4, 5].map((i) => (
          <Card key={i}><CardContent className="p-3"><div className="h-16 bg-n-100 rounded animate-pulse" /></CardContent></Card>
        ))}
      </div>
    </div>
  );
}
