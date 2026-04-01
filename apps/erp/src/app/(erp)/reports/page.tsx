import { Card, CardContent } from '@repo/ui';
import { FileBarChart } from 'lucide-react';

export default function ReportsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-heading font-bold text-[#1A1D24]">Reports</h1>
      <Card>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <FileBarChart className="h-12 w-12 text-[#9CA0AB] opacity-50 mb-4" />
            <h2 className="text-lg font-heading font-bold text-[#1A1D24]">No Reports Yet</h2>
            <p className="text-sm text-[#7C818E] max-w-[320px] mt-1">
              Daily site reports, project progress summaries, and site inspection records will be listed here.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
