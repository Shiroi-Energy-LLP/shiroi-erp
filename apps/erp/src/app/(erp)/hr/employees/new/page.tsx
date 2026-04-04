import { getUserProfile } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { CreateEmployeeForm } from '@/components/hr/create-employee-form';

export default async function NewEmployeePage() {
  const profile = await getUserProfile();
  if (!profile) redirect('/login');

  // Only founder and hr_manager can create employee accounts
  if (profile.role !== 'founder' && profile.role !== 'hr_manager') {
    redirect('/dashboard');
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-[#1A1D24]">New Employee</h1>
      <CreateEmployeeForm />
    </div>
  );
}
