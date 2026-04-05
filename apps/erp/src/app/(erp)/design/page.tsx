import { Card, CardContent, Eyebrow } from '@repo/ui';
import { Palette } from 'lucide-react';

export default function DesignPage() {
  return (
    <div className="space-y-6">
      <div>
        <Eyebrow className="mb-1">DESIGN QUEUE</Eyebrow>
        <h1 className="text-2xl font-heading font-bold text-[#1A1D24]">Design Queue</h1>
      </div>
      <Card>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Palette className="h-12 w-12 text-[#9CA0AB] opacity-50 mb-4" />
            <h2 className="text-lg font-heading font-bold text-[#1A1D24]">No Designs in Queue</h2>
            <p className="text-sm text-[#7C818E] max-w-[320px] mt-1">
              Leads awaiting system design will appear here. Complete site surveys are required before design can begin.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
