'use client';

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { Card, CardHeader, CardTitle, CardContent } from '@repo/ui';

const STATUS_COLORS: Record<string, string> = {
  order_received: '#1D4ED8',
  yet_to_start: '#525252',
  in_progress: '#EA580C',
  completed: '#00B050',
  holding_shiroi: '#B45309',
  holding_client: '#991B1B',
  waiting_net_metering: '#7C3AED',
  meter_client_scope: '#6D28D9',
};

const STATUS_LABELS: Record<string, string> = {
  order_received: 'Order Received',
  yet_to_start: 'Yet to Start',
  in_progress: 'In Progress',
  completed: 'Completed',
  holding_shiroi: 'Holding from Shiroi',
  holding_client: 'Holding from Client',
  waiting_net_metering: 'Waiting for Net Metering',
  meter_client_scope: 'Meter - Client Scope',
};

function formatStatus(status: string): string {
  return STATUS_LABELS[status] ?? status
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

interface DonutChartProps {
  data: Array<{ status: string; count: number }>;
}

export function PMDonutChart({ data }: DonutChartProps) {
  const totalProjects = data.reduce((sum, d) => sum + d.count, 0);

  if (data.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Projects by Status</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-n-400 py-8 text-center">No active projects.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Projects by Status</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-6">
          <div className="relative h-[200px] w-[200px] flex-shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={90}
                  dataKey="count"
                  nameKey="status"
                  strokeWidth={2}
                  stroke="#fff"
                >
                  {data.map((entry) => (
                    <Cell
                      key={entry.status}
                      fill={STATUS_COLORS[entry.status] ?? '#9CA3AF'}
                    />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value: unknown, name: unknown) => [String(value), formatStatus(String(name))]}
                  contentStyle={{
                    fontSize: '12px',
                    borderRadius: '8px',
                    border: '1px solid #DFE2E8',
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="font-heading text-2xl font-bold text-n-950">{totalProjects}</span>
              <span className="text-[10px] text-n-500 uppercase tracking-wider">Projects</span>
            </div>
          </div>

          <div className="flex flex-col gap-1.5 flex-1">
            {data.map((entry) => (
              <div key={entry.status} className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div
                    className="h-2.5 w-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: STATUS_COLORS[entry.status] ?? '#9CA3AF' }}
                  />
                  <span className="text-[12px] text-n-700">{formatStatus(entry.status)}</span>
                </div>
                <span className="text-[12px] font-bold text-n-950 font-mono">{entry.count}</span>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
