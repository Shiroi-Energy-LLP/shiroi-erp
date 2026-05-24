'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import {
  Card,
  CardContent,
  Badge,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  Input,
  useToast,
} from '@repo/ui';
import { CheckCircle, XCircle, CreditCard, ExternalLink } from 'lucide-react';
import {
  approveReferralPayout,
  rejectReferralPayout,
  markReferralPaid,
} from '@/lib/referral-actions';
import type { getReferralPayouts } from '@/lib/referral-queries';
import type { getReferralKpis } from '@/lib/referral-queries';

type Payout = Awaited<ReturnType<typeof getReferralPayouts>>[number];
type Kpis = Awaited<ReturnType<typeof getReferralKpis>>;

interface Props {
  kpis: Kpis;
  pendingPayouts: Payout[];
  approvedPayouts: Payout[];
  paidPayouts: Payout[];
  formatINR: (n: number) => string;
}

// ── KPI strip ──
function KpiStrip({ kpis, formatINR }: { kpis: Kpis; formatINR: (n: number) => string }) {
  return (
    <div className="grid grid-cols-3 gap-4">
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">Pending approvals</p>
          <p className="text-3xl font-bold mt-1">{kpis.pendingCount}</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">This month commission</p>
          <p className="text-3xl font-bold mt-1">{formatINR(kpis.thisMonthCommission)}</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">Lifetime commission paid</p>
          <p className="text-3xl font-bold mt-1">{formatINR(kpis.lifetimeCommission)}</p>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Payout row ──
function PayoutRow({
  payout,
  formatINR,
  onApprove,
  onReject,
  onPay,
}: {
  payout: Payout;
  formatINR: (n: number) => string;
  onApprove?: (id: string) => void;
  onReject?: (id: string) => void;
  onPay?: (id: string) => void;
}) {
  const partner = Array.isArray(payout.channel_partners)
    ? payout.channel_partners[0]
    : payout.channel_partners;
  const lead = Array.isArray(payout.leads) ? payout.leads[0] : payout.leads;

  return (
    <TableRow>
      <TableCell>
        {partner ? (
          <Link href={`/referrals/partners/${partner.id}`} className="font-medium hover:underline flex items-center gap-1">
            {partner.partner_name}
            <ExternalLink className="h-3 w-3 opacity-50" />
          </Link>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
        <p className="text-xs text-muted-foreground">{partner?.contact_person}</p>
      </TableCell>
      <TableCell>
        <span className="font-medium">{lead?.customer_name ?? '—'}</span>
        <p className="text-xs text-muted-foreground">{lead?.city}</p>
      </TableCell>
      <TableCell className="text-right">
        <span className="text-muted-foreground text-sm">{payout.commission_pct}%</span>
        <p className="font-medium">{formatINR(Number(payout.commission_amount))}</p>
      </TableCell>
      <TableCell>
        <Badge
          variant={
            payout.status === 'paid'
              ? 'success'
              : payout.status === 'approved'
                ? 'default'
                : payout.status === 'rejected'
                  ? 'destructive'
                  : 'secondary'
          }
        >
          {payout.status}
        </Badge>
      </TableCell>
      <TableCell>
        <p className="text-xs text-muted-foreground">
          {payout.created_at ? new Date(payout.created_at).toLocaleDateString('en-IN') : '—'}
        </p>
        {payout.paid_at && (
          <p className="text-xs text-muted-foreground">
            Paid {new Date(payout.paid_at).toLocaleDateString('en-IN')}
          </p>
        )}
      </TableCell>
      {(onApprove || onReject || onPay) && (
        <TableCell>
          <div className="flex gap-2">
            {onApprove && (
              <Button size="sm" variant="outline" onClick={() => onApprove(payout.id)}>
                <CheckCircle className="h-3.5 w-3.5 mr-1" /> Approve
              </Button>
            )}
            {onReject && (
              <Button size="sm" variant="outline" onClick={() => onReject(payout.id)}>
                <XCircle className="h-3.5 w-3.5 mr-1" /> Reject
              </Button>
            )}
            {onPay && (
              <Button size="sm" onClick={() => onPay(payout.id)}>
                <CreditCard className="h-3.5 w-3.5 mr-1" /> Mark paid
              </Button>
            )}
          </div>
        </TableCell>
      )}
    </TableRow>
  );
}

// ── Main client component ──
export function ReferralPageClient({ kpis, pendingPayouts, approvedPayouts, paidPayouts, formatINR }: Props) {
  const [isPending, startTransition] = useTransition();
  const [rejectTarget, setRejectTarget] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [payTarget, setPayTarget] = useState<string | null>(null);
  const [payRef, setPayRef] = useState('');
  const { addToast } = useToast();

  function handleApprove(id: string) {
    startTransition(async () => {
      const result = await approveReferralPayout(id);
      if (result.success) {
        addToast({ variant: 'success', title: 'Payout approved' });
      } else {
        addToast({ variant: 'destructive', title: 'Could not approve', description: result.error });
      }
    });
  }

  function handleRejectSubmit() {
    if (!rejectTarget) return;
    startTransition(async () => {
      const result = await rejectReferralPayout(rejectTarget, rejectReason);
      if (result.success) {
        addToast({ variant: 'success', title: 'Payout rejected' });
        setRejectTarget(null);
        setRejectReason('');
      } else {
        addToast({ variant: 'destructive', title: 'Could not reject', description: result.error });
      }
    });
  }

  function handlePaySubmit() {
    if (!payTarget) return;
    startTransition(async () => {
      const result = await markReferralPaid(payTarget, payRef);
      if (result.success) {
        addToast({ variant: 'success', title: 'Payout marked as paid' });
        setPayTarget(null);
        setPayRef('');
      } else {
        addToast({ variant: 'destructive', title: 'Could not mark paid', description: result.error });
      }
    });
  }

  const tableHeader = (showActions: boolean) => (
    <TableHeader>
      <TableRow>
        <TableHead>Partner</TableHead>
        <TableHead>Lead</TableHead>
        <TableHead className="text-right">Commission</TableHead>
        <TableHead>Status</TableHead>
        <TableHead>Date</TableHead>
        {showActions && <TableHead>Actions</TableHead>}
      </TableRow>
    </TableHeader>
  );

  return (
    <div className="space-y-6">
      <KpiStrip kpis={kpis} formatINR={formatINR} />

      <Tabs defaultValue="pending">
        <TabsList>
          <TabsTrigger value="pending">Pending ({pendingPayouts.length})</TabsTrigger>
          <TabsTrigger value="approved">Approved ({approvedPayouts.length})</TabsTrigger>
          <TabsTrigger value="paid">Paid ({paidPayouts.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="pending" className="mt-4">
          <Card>
            <CardContent className="p-0">
              <Table>
                {tableHeader(true)}
                <TableBody>
                  {pendingPayouts.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                        No pending approvals
                      </TableCell>
                    </TableRow>
                  )}
                  {pendingPayouts.map((p) => (
                    <PayoutRow
                      key={p.id}
                      payout={p}
                      formatINR={formatINR}
                      onApprove={handleApprove}
                      onReject={setRejectTarget}
                    />
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="approved" className="mt-4">
          <Card>
            <CardContent className="p-0">
              <Table>
                {tableHeader(true)}
                <TableBody>
                  {approvedPayouts.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                        No approved payouts awaiting payment
                      </TableCell>
                    </TableRow>
                  )}
                  {approvedPayouts.map((p) => (
                    <PayoutRow
                      key={p.id}
                      payout={p}
                      formatINR={formatINR}
                      onPay={setPayTarget}
                    />
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="paid" className="mt-4">
          <Card>
            <CardContent className="p-0">
              <Table>
                {tableHeader(false)}
                <TableBody>
                  {paidPayouts.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                        No paid payouts yet
                      </TableCell>
                    </TableRow>
                  )}
                  {paidPayouts.map((p) => (
                    <PayoutRow key={p.id} payout={p} formatINR={formatINR} />
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Reject dialog */}
      <Dialog open={!!rejectTarget} onOpenChange={(o) => !o && setRejectTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject payout</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <label className="text-sm font-medium">Reason (optional)</label>
            <Input
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="e.g. Lead sourcing in dispute"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectTarget(null)} disabled={isPending}>Cancel</Button>
            <Button variant="destructive" onClick={handleRejectSubmit} disabled={isPending}>
              Reject payout
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pay dialog */}
      <Dialog open={!!payTarget} onOpenChange={(o) => !o && setPayTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark payout as paid</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <label className="text-sm font-medium">Payment reference *</label>
            <Input
              value={payRef}
              onChange={(e) => setPayRef(e.target.value)}
              placeholder="e.g. UTR-12345 / Cheque 001234"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayTarget(null)} disabled={isPending}>Cancel</Button>
            <Button onClick={handlePaySubmit} disabled={isPending || !payRef.trim()}>
              Confirm payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
