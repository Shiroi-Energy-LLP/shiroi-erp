import { LeadForm } from '@/components/leads/lead-form';

export default function NewLeadPage() {
  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-[#1A1D24]">Create New Lead</h1>
      <LeadForm />
    </div>
  );
}
