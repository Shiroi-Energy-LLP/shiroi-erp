import { getUserProfile } from '@/lib/auth';
import { getPurchaseDashboardData } from '@/lib/purchase-queries';
import { KpiCard } from '@/components/kpi-card';
import { MyTasks } from '@/components/my-tasks';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  Badge,
} from '@repo/ui';
import { formatINR, formatDate } from '@repo/ui/formatters';
import { ShoppingCart, Shield, AlertTriangle } from 'lucide-react';

function formatStatus(status: string): string {
  return status
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export async function PurchaseDashboard() {
  const profile = await getUserProfile();
  if (!profile) return null;

  const data = await getPurchaseDashboardData(profile.id);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-heading font-bold text-[#1A1D24]">Purchase Dashboard</h1>

      {/* KPI Cards */}
      <div className="grid grid-cols-4 gap-4">
        <KpiCard
          label="Pending POs"
          value={data.pendingPOCount}
          icon="ShoppingCart"
          subNote="Awaiting approval"
        />
        <KpiCard
          label="Active POs"
          value={data.activePOCount}
          icon="Package"
        />
        <KpiCard
          label="Pending Deliveries"
          value={data.pendingDeliveries}
          icon="Truck"
        />
        <KpiCard
          label="MSME Alerts"
          value={data.msmeAlertCount}
          icon="Shield"
          subNote={data.msmeAlertCount > 0 ? 'Day 40+ outstanding' : undefined}
        />
      </div>

      {/* MSME Alert Banner */}
      {data.msmeAlertCount > 0 && (
        <Card className="border-[#F59E0B] bg-[#FFFBEB]">
          <CardContent className="py-3 px-4 flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-[#D97706] flex-shrink-0" />
            <div>
              <span className="text-sm font-semibold text-[#92400E]">
                MSME Payment Alert:
              </span>{' '}
              <span className="text-sm text-[#92400E]">
                {data.msmeAlertCount} vendor payment{data.msmeAlertCount > 1 ? 's' : ''} approaching
                the 45-day legal deadline.
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main content */}
      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 space-y-6">
          {/* PO Pipeline */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
              <CardTitle className="text-base">Recent Purchase Orders</CardTitle>
              <Badge variant="neutral">{data.recentPOs.length}</Badge>
            </CardHeader>
            <CardContent className="p-0">
              {data.recentPOs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-[#9CA0AB]">
                  <ShoppingCart className="h-8 w-8 mb-2" />
                  <p className="text-sm">No purchase orders found.</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>PO Number</TableHead>
                      <TableHead>Vendor</TableHead>
                      <TableHead>Project</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.recentPOs.map((po) => (
                      <TableRow key={po.id}>
                        <TableCell className="font-medium text-[#1A1D24]">
                          {po.po_number}
                        </TableCell>
                        <TableCell>{po.vendors?.company_name ?? '--'}</TableCell>
                        <TableCell>{po.projects?.project_number ?? '--'}</TableCell>
                        <TableCell>
                          <Badge variant={po.status === 'approved' ? 'success' : 'pending'}>
                            {formatStatus(po.status)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatINR(po.total_amount)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {data.employeeId && <MyTasks employeeId={data.employeeId} />}
        </div>

        {/* Right column: MSME Alerts detail */}
        <div className="space-y-6">
          {data.msmeAlertPOs.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Shield className="h-4 w-4 text-[#D97706]" />
                  MSME Due Payments
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {data.msmeAlertPOs.map((po) => {
                    const daysSince = po.actual_delivery_date
                      ? Math.floor(
                          (Date.now() - new Date(po.actual_delivery_date).getTime()) /
                            (1000 * 60 * 60 * 24),
                        )
                      : 0;
                    return (
                      <div
                        key={po.id}
                        className="flex flex-col rounded-md border border-[#DFE2E8] px-3 py-2"
                      >
                        <span className="text-sm font-medium text-[#1A1D24]">
                          {po.vendors?.company_name}
                        </span>
                        <span className="text-xs text-[#7C818E]">{po.po_number}</span>
                        <div className="flex items-center justify-between mt-1">
                          <span className="text-xs text-[#7C818E]">
                            {formatINR(po.amount_outstanding)} outstanding
                          </span>
                          <Badge variant={daysSince >= 45 ? 'error' : 'warning'}>
                            Day {daysSince}
                          </Badge>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
