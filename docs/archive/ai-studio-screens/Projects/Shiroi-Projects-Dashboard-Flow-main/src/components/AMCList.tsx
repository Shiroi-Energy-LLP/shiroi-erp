import React, { useState, useMemo } from 'react';
import { Search, Filter, CheckCircle2, Clock, AlertCircle, Calendar, User, Briefcase, Plus, Trash2, FileText } from 'lucide-react';
import { AMCRecord, Project } from '../types';

interface AMCListProps {
  amcs: AMCRecord[];
  projects: Project[];
}

export default function AMCList({ amcs, projects }: AMCListProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');

  const filteredAMCs = useMemo(() => {
    return amcs.filter(a => {
      const matchesSearch = a.projectName.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesCategory = categoryFilter === 'All' || a.category === categoryFilter;
      return matchesSearch && matchesCategory;
    });
  }, [amcs, searchTerm, categoryFilter]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row gap-4 justify-between items-start md:items-center bg-white p-5 rounded-xl border border-n200 shadow-sm">
        <div className="relative w-full md:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-n400" size={16} />
          <input 
            type="text" 
            placeholder="Search AMC records..." 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-n050 border border-n200 rounded-sm text-xs focus:ring-2 focus:ring-shiroi-green/20 focus:border-shiroi-green outline-none transition-all"
          />
        </div>
        
        <div className="flex gap-2">
          <select 
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="px-3 py-2 bg-n050 border border-n200 rounded-sm text-xs font-medium text-n700 focus:ring-2 focus:ring-shiroi-green/20 focus:border-shiroi-green outline-none"
          >
            <option value="All">All Categories</option>
            <option value="Free AMC">Free AMC</option>
            <option value="Paid AMC">Paid AMC</option>
          </select>
          <button className="btn-primary text-xs uppercase tracking-wider">
            <Plus size={16} /> Add AMC Record
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-n200 shadow-sm overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-n050 border-b border-n200">
              <th className="px-5 py-3 text-[10px] font-bold text-n500 uppercase tracking-wider font-display">Project Name</th>
              <th className="px-5 py-3 text-[10px] font-bold text-n500 uppercase tracking-wider font-display">Type</th>
              <th className="px-5 py-3 text-[10px] font-bold text-n500 uppercase tracking-wider font-display">Category</th>
              <th className="px-5 py-3 text-[10px] font-bold text-n500 uppercase tracking-wider font-display">Assigned To</th>
              <th className="px-5 py-3 text-[10px] font-bold text-n500 uppercase tracking-wider font-display">Action Date</th>
              <th className="px-5 py-3 text-[10px] font-bold text-n500 uppercase tracking-wider font-display">Report</th>
              <th className="px-5 py-3 text-[10px] font-bold text-n500 uppercase tracking-wider font-display"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-n100">
            {filteredAMCs.map((amc) => (
              <tr key={amc.id} className="hover:bg-n050 transition-colors border-b border-n100 last:border-0">
                <td className="px-5 py-4">
                  <span className="text-xs font-bold text-n900">{amc.projectName}</span>
                </td>
                <td className="px-5 py-4">
                  <span className="text-xs text-n600">{amc.type}</span>
                </td>
                <td className="px-5 py-4">
                  <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider border ${
                    amc.category === 'Free AMC' ? 'bg-steel/10 text-steel border-steel/20' : 'bg-shiroi-green/10 text-shiroi-green border-shiroi-green/20'
                  }`}>
                    {amc.category}
                  </span>
                </td>
                <td className="px-5 py-4">
                  <div className="flex items-center gap-1.5">
                    <User size={12} className="text-n400" />
                    <span className="text-xs text-n600">{amc.assignedTo}</span>
                  </div>
                </td>
                <td className="px-5 py-4">
                  <div className="flex items-center gap-1.5 text-[10px] text-n500">
                    <Calendar size={12} />
                    <span>{amc.actionDate}</span>
                  </div>
                </td>
                <td className="px-5 py-4">
                  <button className="flex items-center gap-1 text-[10px] font-bold text-shiroi-green hover:text-shiroi-green-dark transition-colors uppercase tracking-wider">
                    <FileText size={12} /> View Report
                  </button>
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
