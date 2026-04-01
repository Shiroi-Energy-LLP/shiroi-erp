import { Card, CardContent } from '@repo/ui';
import { Palette } from 'lucide-react';

export default function DesignWorkspacePage({
  params,
}: {
  params: { leadId: string };
}) {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-heading font-bold text-[#1A1D24]">Design Workspace</h1>
      <div className="grid grid-cols-2 gap-6">
        <Card>
          <CardContent>
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Palette className="h-12 w-12 text-[#9CA0AB] opacity-50 mb-4" />
              <h2 className="text-lg font-heading font-bold text-[#1A1D24]">Site Survey Data</h2>
              <p className="text-sm text-[#7C818E] max-w-[320px] mt-1">
                Site measurements, photos, and roof details will appear in this panel.
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Palette className="h-12 w-12 text-[#9CA0AB] opacity-50 mb-4" />
              <h2 className="text-lg font-heading font-bold text-[#1A1D24]">Proposal Builder</h2>
              <p className="text-sm text-[#7C818E] max-w-[320px] mt-1">
                BOM selection, system sizing, and margin calculation tools will be here.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
