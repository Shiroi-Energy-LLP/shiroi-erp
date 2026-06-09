import { LeadForm } from '@/components/leads/lead-form';
import { listChannelPartnersForPicker } from '@/lib/partners-queries';
import { getCompanyOptions } from '@/lib/contacts-queries';

export default async function NewLeadPage() {
  const [partners, companies] = await Promise.all([
    listChannelPartnersForPicker(),
    getCompanyOptions(),
  ]);

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-[#1A1D24]">Create New Lead</h1>
      <LeadForm partners={partners} companies={companies} />
    </div>
  );
}
