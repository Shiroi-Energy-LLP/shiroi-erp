import { Card, CardContent } from '@repo/ui';
import { ClipboardList } from 'lucide-react';

export default function TasksPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-heading font-bold text-[#1A1D24]">Tasks</h1>
      <Card>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <ClipboardList className="h-12 w-12 text-[#9CA0AB] opacity-50 mb-4" />
            <h2 className="text-lg font-heading font-bold text-[#1A1D24]">No Tasks Yet</h2>
            <p className="text-sm text-[#7C818E] max-w-[320px] mt-1">
              Cross-project task management with filtering by entity type, priority, and assignment will be available here.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
