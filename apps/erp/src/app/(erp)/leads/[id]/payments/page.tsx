import { notFound } from 'next/navigation';
import { getLead } from '@/lib/leads-queries';
import { createClient } from '@repo/supabase/server';
import { formatINR, formatDate } from '@repo/ui/formatters';
import { Card, CardHeader, CardTitle, CardContent, EmptyState } from '@repo/ui';
import Link from 'next/link';

interface PaymentsTabProps {
  params: Promise<{ id: string }>;
}

export default async function PaymentsTab({ params }: PaymentsTabProps) {
  const { id } = await params;
  const lead = await getLead(id);
  if (!lead) notFound();

  // This tab only shows for won/converted leads
  if (lead.status !== 'won' && lead.status !== 'converted') {
    return (
      <div className="py-12">
        <EmptyState
          title="Not yet awarded"
          description="Payment tracking becomes available once the project is won."
        />
      </div>
    );
  }

  const supabase = await createClient();

  // Find linked project
  const { data: project } = await supabase
    .from('projects')
    .select('id, project_number, status, contracted_value, completion_pct')
    .eq('lead_id', id)
    .single();

  if (!project) {
    return (
      <div className="py-12">
        <EmptyState
          title="Project not yet created"
          description="A project needs to be created from this lead to track payments."
        />
      </div>
    );
  }

  // Get payment milestones from the accepted proposal
  const { data: proposals } = await supabase
    .from('proposals')
    .select('id, proposal_number, total_after_discount, proposal_payment_schedule(*)')
    .eq('lead_id', id)
    .eq('status', 'accepted')
    .order('created_at', { ascending: false })
    .limit(1);

  const proposal = proposals?.[0] ?? null;

  // Get actual payments received
  const { data: payments } = await supabase
    .from('customer_payments')
    .select('id, amount, payment_date, payment_method, receipt_number, notes, is_advance')
    .eq('project_id', project.id)
    .order('payment_date', { ascending: true });

  const milestones = proposal?.proposal_payment_schedule ?? [];
  const totalReceived = (payments ?? []).reduce((sum: number, p: any) => sum + (p.amount ?? 0), 0);
  const totalExpected = proposal?.total_after_discount ?? project.contracted_value;
  const outstanding = totalExpected - totalReceived;

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-xs font-medium text-n-500 uppercase">Project Value</div>
            <div className="text-xl font-bold font-mono text-n-900 mt-1">{formatINR(totalExpected)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-xs font-medium text-n-500 uppercase">Received</div>
            <div className="text-xl font-bold font-mono text-shiroi-green mt-1">{formatINR(totalReceived)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-xs font-medium text-n-500 uppercase">Outstanding</div>
            <div className={`text-xl font-bold font-mono mt-1 ${outstanding > 0 ? 'text-red-600' : 'text-shiroi-green'}`}>
              {formatINR(outstanding)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-xs font-medium text-n-500 uppercase">Project Progress</div>
            <div className="text-xl font-bold text-n-900 mt-1">{project.completion_pct}%</div>
            <Link href={`/projects/${project.id}`} className="text-xs text-shiroi-green hover:underline">
              {project.project_number}
            </Link>
          </CardContent>
        </Card>
      </div>

      {/* Payment milestones */}
      {milestones.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Payment Schedule</CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-n-100 text-left text-xs text-n-500 uppercase">
                  <th className="py-2 pr-4">#</th>
                  <th className="py-2 pr-4">Milestone</th>
                  <th className="py-2 pr-4">Trigger</th>
                  <th className="py-2 pr-4 text-right">Amount</th>
                  <th className="py-2 pr-4 text-right">%</th>
                </tr>
              </thead>
              <tbody>
                {[...milestones]
                  .sort((a: any, b: any) => a.milestone_order - b.milestone_order)
                  .map((m: any) => (
                    <tr key={m.id} className="border-b border-n-50">
                      <td className="py-2 pr-4 text-n-500">{m.milestone_order}</td>
                      <td className="py-2 pr-4 font-medium">{m.milestone_name}</td>
                      <td className="py-2 pr-4 text-n-500 capitalize">{m.due_trigger?.replace(/_/g, ' ') ?? '—'}</td>
                      <td className="py-2 pr-4 text-right font-mono">{formatINR(m.amount)}</td>
                      <td className="py-2 pr-4 text-right">{m.percentage}%</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* Actual payments received */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Payments Received ({(payments ?? []).length})</CardTitle>
        </CardHeader>
        <CardContent>
          {(payments ?? []).length === 0 ? (
            <p className="text-sm text-n-500">No payments received yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-n-100 text-left text-xs text-n-500 uppercase">
                  <th className="py-2 pr-4">Date</th>
                  <th className="py-2 pr-4 text-right">Amount</th>
                  <th className="py-2 pr-4">Method</th>
                  <th className="py-2 pr-4">Receipt #</th>
                  <th className="py-2 pr-4">Notes</th>
                </tr>
              </thead>
              <tbody>
                {(payments ?? []).map((p: any) => (
                  <tr key={p.id} className="border-b border-n-50">
                    <td className="py-2 pr-4">{formatDate(p.payment_date)}</td>
                    <td className="py-2 pr-4 text-right font-mono font-medium">{formatINR(p.amount)}</td>
                    <td className="py-2 pr-4 capitalize">{p.payment_method?.replace(/_/g, ' ') ?? '—'}</td>
                    <td className="py-2 pr-4 font-mono text-n-500">{p.receipt_number ?? '—'}</td>
                    <td className="py-2 pr-4 text-n-500 truncate max-w-[200px]">{p.notes ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
