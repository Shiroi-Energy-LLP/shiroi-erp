import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@repo/supabase/server';
import { getExpense } from '@/lib/expenses-queries';
import { getActiveCategories } from '@/lib/expense-categories-queries';
import { StatusBadge } from '@/components/expenses/status-badge';
import { ScopeBadge } from '@/components/expenses/scope-badge';
import { StatusTimeline } from '@/components/expenses/status-timeline';
import { DocumentsList } from '@/components/expenses/documents-list';
import { VerifyButton } from '@/components/expenses/verify-button';
import { ApproveButton } from '@/components/expenses/approve-button';
import { RejectDialog } from '@/components/expenses/reject-dialog';
import { RevertButton } from '@/components/expenses/revert-button';
import { DeleteExpenseButton } from '@/components/expenses/delete-expense-button';
import { EditExpenseDialog } from '@/components/expenses/edit-expense-dialog';
import { formatINR } from '@repo/ui/formatters';

export const dynamic = 'force-dynamic';

export default async function ExpenseDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const expense = await getExpense(id);
  if (!expense) notFound();

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  let callerRole: string | null = null;
  let callerEmployeeId: string | null = null;
  if (auth.user) {
    const [{ data: p }, { data: e }] = await Promise.all([
      supabase.from('profiles').select('role').eq('id', auth.user.id).maybeSingle(),
      supabase.from('employees').select('id').eq('profile_id', auth.user.id).maybeSingle(),
    ]);
    callerRole = p?.role ?? null;
    callerEmployeeId = e?.id ?? null;
  }

  const activeCategories = await getActiveCategories();

  const isSubmitter = callerEmployeeId === expense.submitted_by;
  const isPM = callerRole === 'project_manager';
  const isFounder = callerRole === 'founder';
  const projectLinked = expense.project_id !== null;

  const canEdit =
    (isSubmitter && expense.status === 'submitted')
    || (isPM && projectLinked && expense.status === 'submitted')
    || isFounder;

  const canDelete =
    (isSubmitter && expense.status === 'submitted')
    || isFounder;

  const canVerify = projectLinked && expense.status === 'submitted' && (isPM || isFounder);
  const canApprove = isFounder && (
    (projectLinked && expense.status === 'verified')
    || (!projectLinked && expense.status === 'submitted')
  );
  const canReject =
    ['submitted', 'verified'].includes(expense.status)
    && (
      isFounder
      || (isPM && projectLinked && expense.status === 'submitted')
    );

  const canRevert = isFounder && (expense.status === 'approved' || expense.status === 'rejected');

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <Link href="/expenses" className="text-sm text-blue-600 hover:underline">← Back to expenses</Link>

      <div className="flex items-baseline gap-3 mt-2 flex-wrap">
        <h1 className="text-2xl font-mono">{expense.voucher_number}</h1>
        <ScopeBadge projectLinked={projectLinked} />
        <StatusBadge status={expense.status} />
        <div className="ml-auto text-3xl font-mono font-semibold">{formatINR(expense.amount)}</div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
        <div className="space-y-2 p-4 border rounded bg-white">
          <h2 className="font-semibold">Details</h2>
          <Row label="Project">
            {expense.project_id
              ? <Link className="text-blue-600 hover:underline" href={`/projects/${expense.project_id}`}>{expense.project_number ?? '(project)'}{expense.customer_name ? ` · ${expense.customer_name}` : ''}</Link>
              : <em className="text-gray-500">General expense — no project</em>}
          </Row>
          <Row label="Submitter">{expense.submitter_name ?? '—'}</Row>
          <Row label="Category">{expense.category_label ?? '—'}</Row>
          <Row label="Expense date">{expense.expense_date ?? '—'}</Row>
          <Row label="Description"><span className="whitespace-pre-wrap">{expense.description ?? '—'}</span></Row>
        </div>

        <div className="p-4 border rounded bg-white">
          <h2 className="font-semibold mb-2">Timeline</h2>
          <StatusTimeline
            projectLinked={projectLinked}
            status={expense.status}
            submittedAt={expense.submitted_at}
            submitterName={expense.submitter_name}
            verifiedAt={expense.verified_at}
            verifiedByName={expense.verified_by_name}
            approvedAt={expense.approved_at}
            approvedByName={expense.approved_by_name}
            rejectedAt={expense.rejected_at}
            rejectedByName={expense.rejected_by_name}
            rejectedReason={expense.rejected_reason}
          />
        </div>
      </div>

      <div className="mt-4 p-4 border rounded bg-white">
        <h2 className="font-semibold mb-2">Documents</h2>
        <DocumentsList docs={expense.documents} />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {canEdit && (
          <EditExpenseDialog
            id={expense.id}
            initial={{
              description: expense.description,
              amount: expense.amount,
              expense_date: expense.expense_date,
              category_id: expense.category_id,
            }}
            categories={activeCategories.map((c) => ({ id: c.id, label: c.label }))}
          />
        )}
        {canVerify && <VerifyButton id={expense.id} />}
        {canApprove && <ApproveButton id={expense.id} />}
        {canReject && <RejectDialog id={expense.id} />}
        {canRevert && expense.status === 'approved' && (
          <RevertButton id={expense.id} target={projectLinked ? 'verified' : 'submitted'} />
        )}
        {canRevert && expense.status === 'rejected' && <RevertButton id={expense.id} target="submitted" />}
        {canDelete && <DeleteExpenseButton id={expense.id} />}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[120px,1fr] text-sm gap-2">
      <div className="text-gray-500">{label}</div>
      <div>{children}</div>
    </div>
  );
}
