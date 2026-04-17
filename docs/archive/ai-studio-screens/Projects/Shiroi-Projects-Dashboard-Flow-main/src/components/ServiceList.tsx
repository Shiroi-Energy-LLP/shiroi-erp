import React, { useState, useMemo } from 'react';
import { Search, Filter, CheckCircle2, Clock, AlertCircle, Calendar, User, Briefcase, Plus, Trash2 } from 'lucide-react';
import { ServiceRecord, Project } from '../types';

interface ServiceListProps {
  services: ServiceRecord[];
  projects: Project[];
}

export default function ServiceList({ services, projects }: ServiceListProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');

  const filteredServices = useMemo(() => {
    return services.filter(s => {
      const matchesSearch = s.description.toLowerCase().includes(searchTerm.toLowerCase()) || 
                           s.projectName.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesStatus = statusFilter === 'All' || s.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [services, searchTerm, statusFilter]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row gap-4 justify-between items-start md:items-center bg-white p-5 rounded-xl border border-n200 shadow-sm">
        <div className="relative w-full md:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-n400" size={16} />
          <input 
            type="text" 
            placeholder="Search service records..." 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-n050 border border-n200 rounded-sm text-xs focus:ring-2 focus:ring-shiroi-green/20 focus:border-shiroi-green outline-none transition-all"
          />
        </div>
        
        <div className="flex gap-2">
          <select 
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 bg-n050 border border-n200 rounded-sm text-xs font-medium text-n700 focus:ring-2 focus:ring-shiroi-green/20 focus:border-shiroi-green outline-none"
          >
            <option value="All">All Status</option>
            <option value="Open">Open</option>
            <option value="In Progress">In Progress</option>
            <option value="Closed">Closed</option>
          </select>
          <button className="btn-primary text-xs uppercase tracking-wider">
            <Plus size={16} /> Add Service
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-n200 shadow-sm overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-n050 border-b border-n200">
              <th className="px-5 py-3 text-[10px] font-bold text-n500 uppercase tracking-wider font-display">Project Name</th>
              <th className="px-5 py-3 text-[10px] font-bold text-n500 uppercase tracking-wider font-display">Description</th>
              <th className="px-5 py-3 text-[10px] font-bold text-n500 uppercase tracking-wider font-display">Assigned To</th>
              <th className="px-5 py-3 text-[10px] font-bold text-n500 uppercase tracking-wider font-display">Amount</th>
              <th className="px-5 py-3 text-[10px] font-bold text-n500 uppercase tracking-wider font-display">Status</th>
              <th className="px-5 py-3 text-[10px] font-bold text-n500 uppercase tracking-wider font-display"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-n100">
            {filteredServices.map((service) => (
              <tr key={service.id} className="hover:bg-n050 transition-colors border-b border-n100 last:border-0">
                <td className="px-5 py-4">
                  <span className="text-xs font-bold text-n900">{service.projectName}</span>
                </td>
                <td className="px-5 py-4">
                  <div className="flex flex-col">
                    <span className="text-xs text-n600">{service.description}</span>
                    <span className="text-[9px] text-n400 uppercase font-bold tracking-wider">Created: {service.createDate}</span>
                  </div>
                </td>
                <td className="px-5 py-4">
                  <div className="flex flex-col">
                    <span className="text-xs text-n600 font-medium">{service.assignedTo || 'Unassigned'}</span>
                    <span className="text-[9px] text-n400 uppercase font-bold tracking-wider">Action: {service.actionDate}</span>
                  </div>
                </td>
                <td className="px-5 py-4">
                  <span className="text-xs font-bold text-n900">₹{service.amount.toLocaleString()}</span>
                </td>
                <td className="px-5 py-4">
                  <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider border ${
                    service.status === 'Closed' ? 'bg-shiroi-green/10 text-shiroi-green border-shiroi-green/20' : 
                    service.status === 'In Progress' ? 'bg-solar-yellow/10 text-solar-yellow border-solar-yellow/20' : 
                    'bg-red-50 text-red-600 border-red-100'
                  }`}>
                    {service.status}
                  </span>
                </td>
                <td className="px-5 py-4 text-right">
                  <button className="text-n300 hover:text-red-500 transition-colors">
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
