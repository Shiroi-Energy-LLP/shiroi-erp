import { Card, CardContent, Eyebrow } from '@repo/ui';
import { FileCheck } from 'lucide-react';

export default function LiaisonPage() {
  return (
    <div className="space-y-6">
      <div>
        <Eyebrow className="mb-1">LIAISON</Eyebrow>
        <h1 className="text-2xl font-heading font-bold text-[#1A1D24]">Liaison</h1>
      </div>
      <Card>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <FileCheck className="h-12 w-12 text-[#9CA0AB] opacity-50 mb-4" />
            <h2 className="text-lg font-heading font-bold text-[#1A1D24]">No Liaison Tasks</h2>
            <p className="text-sm text-[#7C818E] max-w-[320px] mt-1">
              CEIG clearances, net metering applications, TNEB submissions, and subsidy tracking will be managed here.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
