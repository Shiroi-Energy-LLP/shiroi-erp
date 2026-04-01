import { notFound } from 'next/navigation';
import { getProject, getProjectChangeOrders } from '@/lib/projects-queries';
import { formatINR, toIST, formatDate } from '@repo/ui/formatters';
import Decimal from 'decimal.js';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Badge,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@repo/ui';

interface ChangeOrdersPageProps {
  params: Promise<{ id: string }>;
}

export default async function ChangeOrdersPage({ params }: ChangeOrdersPageProps) {
  const { id } = await params;
  const [project, changeOrders] = await Promise.all([
    getProject(id),
    getProjectChangeOrders(id),
  ]);

  if (!project) {
    notFound();
  }

  // Calculate total additional value using decimal.js
  const totalAdditionalValue = changeOrders.reduce(
    (sum, co) => sum.add(new Decimal(co.additional_value)),
    new Decimal(0),
  ).toNumber();

  return (
    <div className="space-y-6">
      {/* Summary */}
      {changeOrders.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Change Order Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-8">
              <div>
                <div className="text-xs text-muted-foreground">Original Value</div>
                <div className="text-lg font-mono font-medium">{formatINR(project.contracted_value)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Change Orders</div>
                <div className="text-lg font-mono font-medium text-[#9A3412]">
                  {totalAdditionalValue >= 0 ? '+' : ''}{formatINR(totalAdditionalValue)}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Revised Total</div>
                <div className="text-lg font-mono font-bold">
                  {formatINR(new Decimal(project.contracted_value).add(new Decimal(totalAdditionalValue)).toNumber())}
                </div>
              </div>
              <div className="text-sm text-muted-foreground">
                {changeOrders.length} change order{changeOrders.length !== 1 ? 's' : ''}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Change Orders Table */}
      {changeOrders.length > 0 ? (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>CO #</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Additional Value</TableHead>
                  <TableHead className="text-right">Revised Total</TableHead>
                  <TableHead>Internal Approval</TableHead>
                  <TableHead>Customer Acceptance</TableHead>
                  <TableHead>Prepared By</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {changeOrders.map((co) => {
                  const isInternallyApproved = !!co.approved_by_internal;
                  const isCustomerAccepted = !!co.customer_accepted_at;
                  const isOTPVerified = co.customer_otp_verified;

                  return (
                    <TableRow key={co.id}>
                      <TableCell className="font-mono text-sm font-medium">
                        {co.change_order_number}
                      </TableCell>
                      <TableCell className="text-sm max-w-xs">
                        {co.description}
                        {co.notes && (
                          <div className="text-xs text-muted-foreground mt-0.5">{co.notes}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        <span className={co.additional_value >= 0 ? 'text-[#065F46]' : 'text-[#991B1B]'}>
                          {co.additional_value >= 0 ? '+' : ''}{formatINR(co.additional_value)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-mono font-medium">
                        {formatINR(co.revised_total)}
                      </TableCell>
                      <TableCell>
                        {isInternallyApproved ? (
                          <div>
                            <Badge variant="success">Approved</Badge>
                            <div className="text-xs text-muted-foreground mt-0.5">
                              {co.approver?.full_name ?? '—'}
                            </div>
                          </div>
                        ) : (
                          <Badge variant="pending">Pending</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {isCustomerAccepted ? (
                          <div>
                            <Badge variant="success">Accepted</Badge>
                            {isOTPVerified && (
                              <div className="text-xs text-[#065F46] mt-0.5">OTP Verified</div>
                            )}
                          </div>
                        ) : (
                          <Badge variant="pending">Pending</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {co.preparer?.full_name ?? '—'}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {toIST(co.created_at)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No change orders for this project.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
