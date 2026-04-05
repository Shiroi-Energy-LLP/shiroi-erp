import { Card, CardContent, Eyebrow } from '@repo/ui';
import { BookOpen } from 'lucide-react';

export default function PriceBookPage() {
  return (
    <div className="space-y-6">
      <div>
        <Eyebrow className="mb-1">PRICE BOOK</Eyebrow>
        <h1 className="text-2xl font-heading font-bold text-[#1A1D24]">Price Book</h1>
      </div>
      <Card>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <BookOpen className="h-12 w-12 text-[#9CA0AB] opacity-50 mb-4" />
            <h2 className="text-lg font-heading font-bold text-[#1A1D24]">No Price Book Entries</h2>
            <p className="text-sm text-[#7C818E] max-w-[320px] mt-1">
              Standard material pricing, vendor rate cards, and BOM cost templates will be maintained here.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
