import { getLeadsForProposal } from '@/lib/proposals-queries';
import { ProposalWizard } from '@/components/proposals/proposal-wizard';

export default async function NewProposalPage() {
  const leads = await getLeadsForProposal();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-n-950">New Proposal</h1>
      <ProposalWizard leads={leads} />
    </div>
  );
}
