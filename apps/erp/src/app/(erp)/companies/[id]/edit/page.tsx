import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getCompany } from '@/lib/contacts-queries';
import { CompanyForm } from '@/components/contacts/company-form';

export default async function EditCompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const company = await getCompany(id);
  if (!company) notFound();

  return (
    <div className="space-y-6">
      <Link href={`/companies/${id}`} className="text-sm text-[#00B050] hover:underline">&larr; Back to Company</Link>
      <CompanyForm company={company as any} />
    </div>
  );
}
