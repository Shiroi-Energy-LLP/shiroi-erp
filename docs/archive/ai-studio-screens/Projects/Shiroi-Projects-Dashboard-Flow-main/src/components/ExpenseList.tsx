import React, { useState, useMemo } from 'react';
import { Search, Filter, CheckCircle2, Clock, AlertCircle, Calendar, User, Briefcase, Plus, Trash2, Receipt, DollarSign, FileText } from 'lucide-react';
import { Expense, Project } from '../types';

interface ExpenseListProps {
  projects: Project[];
}

export default function ExpenseList({ projects }: ExpenseListProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');

  const allExpenses = useMemo(() => {
    const expenses: any[] = [];
    projects.forEach(project => {
      if (project.expenses) {
        project.expenses.forEach(exp => {
          expenses.push({
            ...exp,
            projectName: project.name,
            projectId: project.id
          });
        });
      } else {
        // Mock some expenses
        const mockExps = [
          { id: `e1-${project.id}`, category: 'Travel & Allowance', description: 'Site visit travel', engineerName: 'Engineer A', voucherNo: 'V001', amount: 1200, status: 'Approved', projectName: project.name },
          { id: `e2-${project.id}`, category: 'Food & Accommodation', description: 'Lunch for team', engineerName: 'Engineer B', voucherNo: 'V002', amount: 800, status: 'Pending Verification', projectName: project.name }
        ];
        expenses.push(...mockExps);
      }
    });
    return expenses;
  }, [projects]);

  const filteredExpenses = useMemo(() => {
    return allExpenses.filter(e => {
      const matchesSearch = e.description.toLowerCase().includes(searchTerm.toLowerCase()) || 
                           e.projectName.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesCategory = categoryFilter === 'All' || e.category === categoryFilter;
      return matchesSearch && matchesCategory;
    });
  }, [allExpenses, searchTerm, categoryFilter]);

  const totalAmount = useMemo(() => filteredExpenses.reduce((acc, e) => acc + e.amount, 0), [filteredExpenses]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-4 rounded-xl border border-n200 shadow-sm flex items-center gap-3">
          <div className="bg-shiroi-green/10 text-shiroi-green p-2 rounded-lg">
            <Receipt size={20} />
          </div>
          <div>
            <p className="text-[10px] font-bold text-n400 uppercase tracking-wider font-display">Total Expenses</p>
            <p className="text-xl font-bold text-n900">₹{totalAmount.toLocaleString()}</p>
          </div>
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-4 justify-between items-start md:items-center bg-white p-5 rounded-xl border border-n200 shadow-sm">
        <div className="relative w-full md:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-n400" size={16} />
          <input 
            type="text" 
            placeholder="Search expenses..." 
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
            <option value="Travel & Allowance">Travel & Allowance</option>
            <option value="Food & Accommodation">Food & Accommodation</option>
            <option value="Local Expenses">Local Expenses</option>
            <option value="Material Purchase">Material Purchase</option>
            <option value="Transport">Transport</option>
          </select>
          <button className="btn-primary text-xs uppercase tracking-wider">
            <Plus size={16} /> Add Expense
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-n200 shadow-sm overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-n050 border-b border-n200">
              <th className="px-5 py-3 text-[10px] font-bold text-n500 uppercase tracking-wider font-display">Project</th>
              <th className="px-5 py-3 text-[10px] font-bold text-n500 uppercase tracking-wider font-display">Category</th>
              <th className="px-5 py-3 text-[10px] font-bold text-n500 uppercase tracking-wider font-display">Description</th>
              <th className="px-5 py-3 text-[10px] font-bold text-n500 uppercase tracking-wider font-display">Engineer</th>
              <th className="px-5 py-3 text-[10px] font-bold text-n500 uppercase tracking-wider font-display">Amount</th>
              <th className="px-5 py-3 text-[10px] font-bold text-n500 uppercase tracking-wider font-display">Status</th>
              <th className="px-5 py-3 text-[10px] font-bold text-n500 uppercase tracking-wider font-display"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-n100">
            {filteredExpenses.map((exp) => (
              <tr key={exp.id} className="hover:bg-n050 transition-colors border-b border-n100 last:border-0">
                <td className="px-5 py-4">
                  <span className="text-xs font-bold text-n900">{exp.projectName}</span>
                </td>
                <td className="px-5 py-4">
                  <span className="text-[9px] font-bold text-n400 uppercase tracking-wider">{exp.category}</span>
                </td>
                <td className="px-5 py-4">
                  <div className="flex flex-col">
                    <span className="text-xs text-n600">{exp.description}</span>
                    <span className="text-[9px] text-n400 uppercase font-bold tracking-wider">Voucher: {exp.voucherNo}</span>
                  </div>
                </td>
                <td className="px-5 py-4">
                  <div className="flex items-center gap-1.5">
                    <User size={12} className="text-n400" />
                    <span className="text-xs text-n600">{exp.engineerName}</span>
                  </div>
                </td>
                <td className="px-5 py-4">
                  <span className="text-xs font-bold text-n900">₹{exp.amount.toLocaleString()}</span>
                </td>
                <td className="px-5 py-4">
                  <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider border ${
                    exp.status === 'Approved' ? 'bg-shiroi-green/10 text-shiroi-green border-shiroi-green/20' : 
                    exp.status === 'Pending Verification' ? 'bg-solar-yellow/10 text-solar-yellow border-solar-yellow/20' : 
                    'bg-n100 text-n600 border-n200'
                  }`}>
                    {exp.status}
                  </span>
                </td>
                <td className="px-5 py-4 text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    <button className="text-n300 hover:text-steel transition-colors">
                      <FileText size={14} />
                    </button>
                    <button className="text-n300 hover:text-red-500 transition-colors">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
