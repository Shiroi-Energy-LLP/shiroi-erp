import React, { useState, useMemo } from 'react';
import { 
  Search, 
  Filter, 
  ChevronRight, 
  MoreVertical, 
  MapPin, 
  Calendar, 
  Zap,
  CheckCircle2,
  Clock,
  AlertCircle
} from 'lucide-react';
import { Project, ProjectStatus } from '../types';

interface ProjectListProps {
  projects: Project[];
  onProjectClick: (id: string) => void;
}

export default function ProjectList({ projects, onProjectClick }: ProjectListProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<ProjectStatus | 'All'>('All');
  const [locationFilter, setLocationFilter] = useState('All');

  const filteredProjects = useMemo(() => {
    return projects.filter(p => {
      const matchesSearch = p.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                           p.clientId.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesStatus = statusFilter === 'All' || p.status === statusFilter;
      const matchesLocation = locationFilter === 'All' || p.location === locationFilter;
      return matchesSearch && matchesStatus && matchesLocation;
    });
  }, [projects, searchTerm, statusFilter, locationFilter]);

  const locations = useMemo(() => ['All', ...new Set(projects.map(p => p.location))], [projects]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row gap-3 justify-between items-start md:items-center bg-white p-3 rounded-xl border border-n200 shadow-sm">
        <div className="relative w-full md:w-80">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-n400" size={14} />
          <input 
            type="text" 
            placeholder="Search..." 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 bg-n050 border border-n200 rounded-lg text-[11px] focus:ring-2 focus:ring-shiroi-green transition-all outline-none"
          />
        </div>
        
        <div className="flex gap-2 w-full md:w-auto overflow-x-auto pb-2 md:pb-0">
          <select 
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="px-2.5 py-1.5 bg-n050 border border-n200 rounded-lg text-[11px] font-medium text-n700 focus:ring-2 focus:ring-shiroi-green outline-none"
          >
            <option value="All">All Status</option>
            <option value="Confirmed">Confirmed</option>
            <option value="In Progress">In Progress</option>
            <option value="Completed">Completed</option>
            <option value="On Hold">On Hold</option>
          </select>

          <select 
            value={locationFilter}
            onChange={(e) => setLocationFilter(e.target.value)}
            className="px-2.5 py-1.5 bg-n050 border border-n200 rounded-lg text-[11px] font-medium text-n700 focus:ring-2 focus:ring-shiroi-green outline-none"
          >
            {locations.map(loc => (
              <option key={loc} value={loc}>{loc}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-n200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-n050 border-b border-n200">
                <th className="px-4 py-2 text-[9px] font-bold text-n500 uppercase tracking-wider font-display">Client ID</th>
                <th className="px-4 py-2 text-[9px] font-bold text-n500 uppercase tracking-wider font-display">Project Name</th>
                <th className="px-4 py-2 text-[9px] font-bold text-n500 uppercase tracking-wider font-display">System Size</th>
                <th className="px-4 py-2 text-[9px] font-bold text-n500 uppercase tracking-wider font-display">Location</th>
                <th className="px-4 py-2 text-[9px] font-bold text-n500 uppercase tracking-wider font-display">Status</th>
                <th className="px-4 py-2 text-[9px] font-bold text-n500 uppercase tracking-wider font-display">% Complete</th>
                <th className="px-4 py-2 text-[9px] font-bold text-n500 uppercase tracking-wider font-display">Timeline</th>
                <th className="px-4 py-2 text-[9px] font-bold text-n500 uppercase tracking-wider font-display"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-n100">
              {filteredProjects.map((project) => (
                <tr 
                  key={project.id} 
                  onClick={() => onProjectClick(project.id)}
                  className="hover:bg-n050 transition-colors cursor-pointer group border-b border-n100 last:border-0"
                >
                  <td className="px-4 py-2.5">
                    <span className="text-[10px] font-bold text-n900 bg-n100 px-1.5 py-0.5 rounded-md font-brand">#{project.clientId}</span>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-col">
                      <span className="text-xs font-bold text-n800 group-hover:text-shiroi-green transition-colors">{project.name}</span>
                      <span className="text-[10px] text-n400 mt-0.5">{project.remarks}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <Zap size={12} className="text-solar-yellow" />
                      <span className="text-xs font-semibold text-n700">{project.systemSize} kWp</span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <MapPin size={12} className="text-n400" />
                      <span className="text-xs text-n600">{project.location}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <StatusBadge status={project.status} />
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1 bg-n100 rounded-full overflow-hidden min-w-[50px]">
                        <div 
                          className="h-full bg-shiroi-green rounded-full" 
                          style={{ width: `${project.percentComplete}%` }}
                        />
                      </div>
                      <span className="text-[10px] font-bold text-n700">{project.percentComplete}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1.5 text-[10px] text-n500">
                      <Calendar size={12} />
                      <span>{project.startDate}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button className="p-1.5 hover:bg-n200 rounded-lg transition-colors text-n400">
                      <ChevronRight size={16} />
                    </button>
                  </td>
                </tr>
              ))}
              {filteredProjects.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-6 py-20 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-16 h-16 bg-n100 rounded-full flex items-center justify-center text-n400">
                        <Search size={32} />
                      </div>
                      <p className="text-n500 font-medium">No projects found matching your filters</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}

function StatusBadge({ status }: { status: ProjectStatus }) {
  const styles = {
    'Confirmed': 'bg-n100 text-steel border-n200',
    'In Progress': 'bg-n100 text-shiroi-green border-n200',
    'Completed': 'bg-shiroi-green text-white border-shiroi-green',
    'On Hold': 'bg-red-50 text-red-600 border-red-100'
  };

  const icons = {
    'Confirmed': <Clock size={14} />,
    'In Progress': <Zap size={14} />,
    'Completed': <CheckCircle2 size={14} />,
    'On Hold': <AlertCircle size={14} />
  };

  return (
    <span className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold border ${styles[status]}`}>
      {icons[status]}
      {status}
    </span>
  );
}
