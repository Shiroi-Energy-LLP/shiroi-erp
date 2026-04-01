import { Card, CardContent } from '@repo/ui';
import { BarChart3 } from 'lucide-react';

export default function ProfitabilityPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-heading font-bold text-[#1A1D24]">Profitability</h1>
      <Card>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <BarChart3 className="h-12 w-12 text-[#9CA0AB] opacity-50 mb-4" />
            <h2 className="text-lg font-heading font-bold text-[#1A1D24]">No Profitability Data</h2>
            <p className="text-sm text-[#7C818E] max-w-[320px] mt-1">
              Project-level and company-wide profitability analysis, margin trends, and cost breakdowns will be available here.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
