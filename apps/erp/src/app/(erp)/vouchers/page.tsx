import { redirect } from 'next/navigation';

export default function VouchersPage() {
  redirect('/expenses?status=submitted');
}
