import { CompanyForm } from '@/components/contacts/company-form';

export default function NewCompanyPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-n-950">New Company</h1>
      <CompanyForm />
    </div>
  );
}
