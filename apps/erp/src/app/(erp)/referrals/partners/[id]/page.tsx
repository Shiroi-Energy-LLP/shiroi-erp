import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getPartnerReferralDetail } from '@/lib/referral-queries';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Badge,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  Eyebrow,
  formatINR,
} from '@repo/ui';
import { SensitiveField } from '@/components/hr/sensitive-field';
import { ArrowLeft, Building2 } from 'lucide-react';

interface Props {
  params: { id: string };
}

export default async function PartnerReferralDetailPage({ params }: Props) {
  const detail = await getPartnerReferralDetail(params.id);
  if (!detail) notFound();

  const { partner, payouts } = detail;

  const statusColors: Record<string, 'success' | 'default' | 'destructive' | 'secondary'> = {
    paid: 'success',
    approved: 'default',
    rejected: 'destructive',
    pending: 'secondary',
  };

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link href="/referrals" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to Referrals
      </Link>

      {/* Header */}
      <div className="flex items-center gap-3">
        <Building2 className="h-6 w-6 text-muted-foreground" />
        <div>
          <Eyebrow>Partner profile</Eyebrow>
          <h1 className="text-2xl font-semibold tracking-tight">{partner.partner_name}</h1>
        </div>
        <Badge variant={partner.is_active ? 'success' : 'secondary'} className="ml-auto">
          {partner.is_active ? 'Active' : 'Inactive'}
        </Badge>
      </div>

      {/* Stats + bank details grid */}
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Lifetime stats</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Total referrals</span>
              <span className="font-medium">{partner.lifetime_referrals ?? 0}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Commission earned</span>
              <span className="font-medium">{formatINR(Number(partner.lifetime_commission ?? 0))}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Default commission</span>
              <span className="font-medium">{partner.default_commission_pct ?? 1}%</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Bank details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Contact</span>
              <span className="font-medium">{partner.contact_person}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Phone</span>
              <span className="font-medium">{partner.phone}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Account</span>
              {/* Sensitive: masked partial; founder/HR can click eye to reveal & copy */}
              <SensitiveField value={partner.bank_account_number} maskPartial />
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">IFSC</span>
              <span className="font-medium">{partner.bank_ifsc ?? '—'}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* All referral payouts */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">All referrals ({payouts.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Lead</TableHead>
                <TableHead className="text-right">Base amount</TableHead>
                <TableHead className="text-right">Commission</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Payment ref</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payouts.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    No referrals yet
                  </TableCell>
                </TableRow>
              )}
              {payouts.map((p) => {
                const lead = Array.isArray(p.leads) ? p.leads[0] : p.leads;
                return (
                  <TableRow key={p.id}>
                    <TableCell>
                      <span className="font-medium">{lead?.customer_name ?? '—'}</span>
                      <p className="text-xs text-muted-foreground">{lead?.city}</p>
                    </TableCell>
                    <TableCell className="text-right">{formatINR(Number(p.base_amount))}</TableCell>
                    <TableCell className="text-right font-medium">{formatINR(Number(p.commission_amount))}</TableCell>
                    <TableCell>
                      <Badge variant={statusColors[p.status] ?? 'secondary'}>{p.status}</Badge>
                    </TableCell>
                    <TableCell>
                      <p className="text-xs text-muted-foreground">
                        {p.created_at ? new Date(p.created_at).toLocaleDateString('en-IN') : '—'}
                      </p>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {p.payment_reference ?? '—'}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export const dynamic = 'force-dynamic';
