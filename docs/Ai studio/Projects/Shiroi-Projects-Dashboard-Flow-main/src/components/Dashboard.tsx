import React, { useMemo } from 'react';
import { 
  Users, 
  Sun, 
  CheckCircle2, 
  Clock, 
  TrendingUp, 
  DollarSign, 
  AlertCircle,
  ArrowUpRight,
  ArrowDownRight
} from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { motion } from 'motion/react';
import { Project, ServiceRecord, AMCRecord } from '../types';

interface DashboardProps {
  projects: Project[];
  services: ServiceRecord[];
  amcs: AMCRecord[];
  onProjectClick: (id: string) => void;
}

export default function Dashboard({ projects, services, amcs, onProjectClick }: DashboardProps) {
  const stats = useMemo(() => {
    const totalSystemSize = projects.reduce((acc, p) => acc + p.systemSize, 0);
    const uniqueClients = new Set(projects.map(p => p.clientId)).size;
    const openTasks = projects.reduce((acc, p) => acc + (p.execution?.filter(t => t.status !== 'Closed').length || 0), 0);
    const closedTasks = projects.reduce((acc, p) => acc + (p.execution?.filter(t => t.status === 'Closed').length || 0), 0);
    const openServices = services.filter(s => s.status !== 'Closed').length;
    const closedServices = services.filter(s => s.status === 'Closed').length;
    
    const currentMonth = new Date().getMonth();
    const currentYear = new Date().getFullYear();
    const amcsThisMonth = amcs.filter(a => {
      const date = new Date(a.actionDate);
      return date.getMonth() === currentMonth && date.getFullYear() === currentYear;
    }).length;

    const totalSales = projects.reduce((acc, p) => acc + p.budget, 0);
    const totalRevenue = projects.reduce((acc, p) => acc + (p.budget * (p.percentComplete / 100)), 0);
    const totalActualBudget = projects.reduce((acc, p) => acc + (p.actualBudget || 0), 0);
    const avgProfitRs = projects.length ? (totalSales - totalActualBudget) / projects.length : 0;
    const avgProfitPct = totalSales ? ((totalSales - totalActualBudget) / totalSales) * 100 : 0;

    return {
      totalSystemSize,
      uniqueClients,
      openTasks,
      closedTasks,
      openServices,
      closedServices,
      amcsThisMonth,
      totalSales,
      totalRevenue,
      avgProfitRs,
      avgProfitPct
    };
  }, [projects, services, amcs]);

  const statusData = useMemo(() => {
    const counts: Record<string, number> = {};
    projects.forEach(p => {
      counts[p.status] = (counts[p.status] || 0) + 1;
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [projects]);

  const COLORS = ['#00B050', '#FFC300', '#9ECC3B', '#00BFD8', '#4F81BD'];

  return (
    <div className="space-y-8 pb-12">
      {/* Top Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard 
          title="Total System Size" 
          value={`${stats.totalSystemSize} kWp`} 
          icon={Sun} 
          color="bg-shiroi-green" 
          trend="+12% from last month"
          isUp={true}
        />
        <StatCard 
          title="Total Clients" 
          value={stats.uniqueClients.toString()} 
          icon={Users} 
          color="bg-steel" 
          trend="+3 new this month"
          isUp={true}
        />
        <StatCard 
          title="Total Sales" 
          value={`₹${(stats.totalSales / 100000).toFixed(2)}L`} 
          icon={DollarSign} 
          color="bg-lime" 
          trend="+8% growth"
          isUp={true}
        />
        <StatCard 
          title="Avg. Profit" 
          value={`${stats.avgProfitPct.toFixed(1)}%`} 
          icon={TrendingUp} 
          color="bg-solar-yellow" 
          trend={`₹${(stats.avgProfitRs / 1000).toFixed(1)}k per project`}
          isUp={true}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Project Status Chart */}
        <div className="lg:col-span-2 bg-white p-6 rounded-xl border border-n200 shadow-sm">
          <h3 className="text-base font-display font-bold mb-5 flex items-center gap-2 text-n900">
            <Briefcase className="text-shiroi-green" size={18} />
            Project Status Overview
          </h3>
          <div className="h-[250px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={statusData}
                  cx="50%"
                  cy="50%"
                  innerRadius={80}
                  outerRadius={120}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {statusData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip 
                  contentStyle={{ borderRadius: '10px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', fontFamily: 'Inter, sans-serif' }}
                />
                <Legend verticalAlign="bottom" height={36} wrapperStyle={{ fontFamily: 'Inter, sans-serif', fontSize: '12px' }}/>
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Operational Stats */}
        <div className="space-y-6">
          <div className="bg-white p-5 rounded-xl border border-n200 shadow-sm">
            <h3 className="text-[10px] font-bold text-n500 uppercase tracking-wider mb-4 font-display">Operations</h3>
            <div className="space-y-4">
              <OpStat label="Open Tasks" value={stats.openTasks} total={stats.openTasks + stats.closedTasks} color="bg-shiroi-green" />
              <OpStat label="Open Services" value={stats.openServices} total={stats.openServices + stats.closedServices} color="bg-steel" />
              <OpStat label="AMC This Month" value={stats.amcsThisMonth} total={amcs.length} color="bg-lime" />
            </div>
          </div>

          <div className="bg-shiroi-green-night text-white p-5 rounded-xl shadow-xl shadow-n900/20 border border-n700">
            <h3 className="text-[10px] font-bold text-n400 uppercase tracking-wider mb-4 font-display">Today's Tasks</h3>
            <div className="space-y-3">
              {projects.slice(0, 3).map((p, i) => (
                <div key={p.id} className="flex items-start gap-2.5 group cursor-pointer" onClick={() => onProjectClick(p.id)}>
                  <div className="w-1.5 h-1.5 rounded-full bg-shiroi-green mt-1.5 group-hover:scale-150 transition-transform" />
                  <div>
                    <p className="text-xs font-medium group-hover:text-shiroi-green transition-colors">{p.name}</p>
                    <p className="text-[10px] text-n500">{p.location} • {p.status}</p>
                  </div>
                </div>
              ))}
              {projects.length === 0 && <p className="text-[10px] text-n500 italic">No tasks for today</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ title, value, icon: Icon, color, trend, isUp }: any) {
  return (
    <div className="bg-white p-5 rounded-xl border border-n200 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between mb-3">
        <div className={`${color} p-2 rounded-lg text-white shadow-lg`}>
          <Icon size={20} />
        </div>
        <div className={`flex items-center gap-1 text-[10px] font-bold ${isUp ? 'text-shiroi-green' : 'text-red-600'}`}>
          {isUp ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
          {trend.split(' ')[0]}
        </div>
      </div>
      <p className="text-n500 text-xs font-medium mb-0.5">{title}</p>
      <h4 className="text-xl font-display font-bold text-n900 tracking-tight">{value}</h4>
      <p className="text-[9px] text-n400 mt-1 font-medium uppercase tracking-wider">{trend.split(' ').slice(1).join(' ')}</p>
    </div>
  );
}

function OpStat({ label, value, total, color }: any) {
  const percentage = total > 0 ? (value / total) * 100 : 0;
  return (
    <div>
      <div className="flex justify-between items-end mb-1">
        <span className="text-[10px] font-semibold text-n700 uppercase tracking-tight">{label}</span>
        <span className="text-sm font-bold text-n900">{value}</span>
      </div>
      <div className="h-1 bg-n100 rounded-full overflow-hidden">
        <motion.div 
          initial={{ width: 0 }}
          animate={{ width: `${percentage}%` }}
          className={`h-full ${color}`}
        />
      </div>
    </div>
  );
}

import { Briefcase } from 'lucide-react';
