import { TableSkeleton } from '@repo/ui';

export default function ContactsLoading() {
  return (
    <div className="space-y-6">
      <div className="h-8 w-36 bg-n-150 rounded animate-pulse" />
      <div className="bg-white rounded-lg border border-n-200 shadow-xs">
        <TableSkeleton rows={8} columns={5} />
      </div>
    </div>
  );
}
