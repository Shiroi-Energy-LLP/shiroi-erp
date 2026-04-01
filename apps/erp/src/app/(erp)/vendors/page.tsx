import { Card, CardContent } from '@repo/ui';
import { Building2 } from 'lucide-react';

export default function VendorsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-heading font-bold text-[#1A1D24]">Vendors</h1>
      <Card>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Building2 className="h-12 w-12 text-[#9CA0AB] opacity-50 mb-4" />
            <h2 className="text-lg font-heading font-bold text-[#1A1D24]">No Vendors Yet</h2>
            <p className="text-sm text-[#7C818E] max-w-[320px] mt-1">
              Vendor directory with MSME status, payment history, and performance ratings will be managed here.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
