import { Card, CardContent } from '@repo/ui';
import { FileText } from 'lucide-react';

export default function InvoicesPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-heading font-bold text-[#1A1D24]">Invoices</h1>
      <Card>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <FileText className="h-12 w-12 text-[#9CA0AB] opacity-50 mb-4" />
            <h2 className="text-lg font-heading font-bold text-[#1A1D24]">No Invoices Yet</h2>
            <p className="text-sm text-[#7C818E] max-w-[320px] mt-1">
              Project invoices, payment tracking, escalation levels, and overdue management will be handled here.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
