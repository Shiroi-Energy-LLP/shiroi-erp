import { Card, CardContent } from '@repo/ui';

export default function Loading() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-8 w-64 bg-n-100 rounded" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {[0, 1, 2].map((i) => (
          <Card key={i}>
            <CardContent className="py-3">
              <div className="h-3 w-24 bg-n-100 rounded" />
              <div className="h-7 w-16 bg-n-100 rounded mt-2" />
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardContent className="py-3">
          <div className="h-8 w-full bg-n-100 rounded" />
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4 space-y-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="h-6 w-full bg-n-50 rounded" />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
