import { Card, CardContent } from '@repo/ui';
import { CreditCard } from 'lucide-react';

export default function PaymentsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-heading font-bold text-[#1A1D24]">Payments</h1>
      <Card>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <CreditCard className="h-12 w-12 text-[#9CA0AB] opacity-50 mb-4" />
            <h2 className="text-lg font-heading font-bold text-[#1A1D24]">No Payments Yet</h2>
            <p className="text-sm text-[#7C818E] max-w-[320px] mt-1">
              Customer payment receipts, vendor payments, and MSME compliance tracking will be managed here.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
