'use client';

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { Card, CardHeader, CardTitle, CardContent } from '@repo/ui';

const STATUS_COLORS: Record<string, string> = {
  advance_received: '#3B82F6',
  planning: '#8B5CF6',
  material_procurement: '#F59E0B',
  installation: '#00B050',
  electrical_work: '#06B6D4',
  testing: '#EC4899',
  inspection: '#A855F7',
  commissioned: '#10B981',
  net_metering_pending: '#F97316',
  on_hold: '#EF4444',
};

function formatStatus(status: string): string {
  return status
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
          <p className="text-sm text-[#9CA0AB] py-8 text-center">No active projects.</p>
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
                  formatter={(value: number, name: string) => [value, formatStatus(name)]}
                  contentStyle={{
                    fontSize: '12px',
                    borderRadius: '8px',
                    border: '1px solid #DFE2E8',
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="font-heading text-2xl font-bold text-[#111318]">{totalProjects}</span>
              <span className="text-[10px] text-[#7C818E] uppercase tracking-wider">Projects</span>
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
                  <span className="text-[12px] text-[#3F424D]">{formatStatus(entry.status)}</span>
                </div>
                <span className="text-[12px] font-bold text-[#111318] font-mono">{entry.count}</span>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
