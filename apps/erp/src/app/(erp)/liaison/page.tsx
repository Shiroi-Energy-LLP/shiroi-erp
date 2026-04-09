import Link from 'next/link';
import { createClient } from '@repo/supabase/server';
import { Card, CardContent, Eyebrow } from '@repo/ui';
import { FileCheck, Globe, Zap, CheckCircle2, ArrowRight } from 'lucide-react';

export default async function LiaisonPage() {
  const op = '[LiaisonPage]';

  let total = 0;
  let pendingCeig = 0;
  let pendingNetMeter = 0;
  let ceigApproved = 0;

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('net_metering_applications')
      .select('ceig_status, net_meter_installed');

    if (error) {
      console.error(`${op} Query failed:`, { code: error.code, message: error.message });
      throw error;
    }

    const rows = data ?? [];
    total = rows.length;
    pendingCeig = rows.filter(
      (d) => d.ceig_status === 'pending' || d.ceig_status === 'applied'
    ).length;
    pendingNetMeter = rows.filter((d) => !d.net_meter_installed).length;
    ceigApproved = rows.filter((d) => d.ceig_status === 'approved').length;
  } catch (err) {
    console.error(`${op} Failed to load summary:`, {
      error: err instanceof Error ? err.message : String(err),
      timestamp: new Date().toISOString(),
    });
  }

  const cards = [
    {
      label: 'Total Applications',
      value: total,
      icon: FileCheck,
      bgColor: 'bg-blue-100',
      iconColor: 'text-blue-600',
    },
    {
      label: 'Pending CEIG',
      value: pendingCeig,
      icon: Globe,
      bgColor: 'bg-orange-100',
      iconColor: 'text-orange-600',
    },
    {
      label: 'Pending Net Meter',
      value: pendingNetMeter,
      icon: Zap,
      bgColor: 'bg-yellow-100',
      iconColor: 'text-yellow-600',
    },
    {
      label: 'CEIG Approved',
      value: ceigApproved,
      icon: CheckCircle2,
      bgColor: 'bg-green-100',
      iconColor: 'text-green-600',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Eyebrow className="mb-1">LIAISON</Eyebrow>
        <h1 className="text-2xl font-heading font-bold text-[#1A1D24]">Liaison</h1>
        <p className="text-sm text-[#7C818E] mt-1">
          CEIG clearances, net metering applications, and TNEB submissions.
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <Card key={card.label}>
              <CardContent className="flex items-center gap-4 p-5">
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${card.bgColor}`}>
                  <Icon className={`h-5 w-5 ${card.iconColor}`} />
                </div>
                <div>
                  <p className="text-sm text-[#7C818E]">{card.label}</p>
                  <p className="text-2xl font-heading font-bold text-[#1A1D24]">{card.value}</p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Navigation link card */}
      <Link href="/liaison/net-metering" className="block group">
        <Card className="transition-shadow hover:shadow-md">
          <CardContent className="flex items-center justify-between p-5">
            <div className="flex items-center gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#00B050]/10">
                <Globe className="h-5 w-5 text-[#00B050]" />
              </div>
              <div>
                <h2 className="text-base font-heading font-bold text-[#1A1D24]">
                  Net Metering Applications
                </h2>
                <p className="text-sm text-[#7C818E]">
                  View and manage all DISCOM applications, CEIG clearances, and net meter installations.
                </p>
              </div>
            </div>
            <ArrowRight className="h-5 w-5 text-[#9CA0AB] group-hover:text-[#00B050] transition-colors" />
          </CardContent>
        </Card>
      </Link>
    </div>
  );
}
