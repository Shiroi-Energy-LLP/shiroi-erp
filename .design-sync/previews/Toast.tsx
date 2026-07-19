import { Toast, ToastTitle, ToastDescription } from '@repo/ui';

const stack: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 12, width: 380 };

export function Variants() {
  return (
    <div style={stack}>
      <Toast variant="success" onClose={() => {}}>
        <ToastTitle>Proposal sent</ToastTitle>
        <ToastDescription>Quote for Kumar Residence emailed to the customer.</ToastDescription>
      </Toast>
      <Toast variant="warning" onClose={() => {}}>
        <ToastTitle>Payroll export due</ToastTitle>
        <ToastDescription>Due in 3 days for 48 employees.</ToastDescription>
      </Toast>
      <Toast variant="destructive" onClose={() => {}}>
        <ToastTitle>Sync failed</ToastTitle>
        <ToastDescription>2 vendor invoices were rejected. Retry from Vendor Bills.</ToastDescription>
      </Toast>
      <Toast variant="default" onClose={() => {}}>
        <ToastTitle>Draft saved</ToastTitle>
        <ToastDescription>Your changes are saved automatically.</ToastDescription>
      </Toast>
    </div>
  );
}
