import { PaymentsNav } from '@/components/payments/payments-nav';

interface PaymentsLayoutProps {
  children: React.ReactNode;
}

export default function PaymentsLayout({ children }: PaymentsLayoutProps) {
  return (
    <div className="space-y-4">
      <PaymentsNav />
      {children}
    </div>
  );
}
