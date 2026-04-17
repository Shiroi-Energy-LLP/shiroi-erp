import React, { useState, useMemo } from 'react';
import { Search, Filter, CheckCircle2, Clock, AlertCircle, Calendar, User, Briefcase, Plus, Edit2, Trash2, X, Activity } from 'lucide-react';
import { Project, ExecutionTask, DailyLog } from '../types';
import { EXECUTION_MILESTONES } from '../constants';

interface TaskListProps {
  projects: Project[];
  onUpdateProject: (project: Project) => void;
  onSelectProject: (projectId: string) => void;
}

export default function TaskList({ projects, onUpdateProject, onSelectProject }: TaskListProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [projectFilter, setProjectFilter] = useState('All');
  const [engineerFilter, setEngineerFilter] = useState('All');
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<any>(null);
  const [newTask, setNewTask] = useState<any>({
    title: '',
    projectId: '',
    category: EXECUTION_MILESTONES[0],
    assignedTo: '',
    assignedDate: '',
    actionDate: '',
    doneBy: '',
    remarks: '',
    status: 'Open'
  });

  const [selectedTaskForLogs, setSelectedTaskForLogs] = useState<string | null>(null);
  const [newLog, setNewLog] = useState({ activity: '', doneBy: '', remarks: '' });

  const allTasks = useMemo(() => {
    const tasks: any[] = [];
    projects.forEach(project => {
      if (project.execution) {
        project.execution.forEach(task => {
          tasks.push({
            ...task,
            projectName: project.name,
            projectId: project.id
          });
        });
      }
    });
    return tasks;
  }, [projects]);

  const engineers = useMemo(() => {
    const names = new Set<string>();
    allTasks.forEach(t => { if (t.assignedTo) names.add(t.assignedTo); });
    return ['All', ...Array.from(names)];
  }, [allTasks]);

  const filteredTasks = useMemo(() => {
    return allTasks.filter(t => {
      const matchesSearch = (t.title || '').toLowerCase().includes(searchTerm.toLowerCase()) || 
                           (t.projectName || '').toLowerCase().includes(searchTerm.toLowerCase());
      const matchesStatus = statusFilter === 'All' || t.status === statusFilter;
      const matchesProject = projectFilter === 'All' || t.projectId === projectFilter;
      const matchesEngineer = engineerFilter === 'All' || t.assignedTo === engineerFilter;
      return matchesSearch && matchesStatus && matchesProject && matchesEngineer;
    });
  }, [allTasks, searchTerm, statusFilter, projectFilter, engineerFilter]);

  const handleSaveTask = () => {
    const taskData = editingTask || newTask;
    const project = projects.find(p => p.id === taskData.projectId);
    if (!project) return;

    const execution = [...(project.execution || [])];
    if (editingTask) {
      const index = execution.findIndex(t => t.id === editingTask.id);
      if (index !== -1) {
        execution[index] = {
          ...execution[index],
          title: editingTask.title,
          category: editingTask.category,
          assignedTo: editingTask.assignedTo,
          assignedDate: editingTask.assignedDate,
          actionDate: editingTask.actionDate,
          doneBy: editingTask.doneBy,
          remarks: editingTask.remarks,
          status: editingTask.status
        };
      }
    } else {
      execution.push({
        id: Math.random().toString(36).substr(2, 9),
        title: newTask.title,
        category: newTask.category,
        assignedTo: newTask.assignedTo,
        assignedDate: newTask.assignedDate,
        actionDate: newTask.actionDate,
        doneBy: newTask.doneBy,
        remarks: newTask.remarks,
        status: newTask.status,
        dailyLogs: []
      });
    }

    onUpdateProject({ ...project, execution });
    setIsModalOpen(false);
    setEditingTask(null);
    setNewTask({ title: '', projectId: '', category: EXECUTION_MILESTONES[0], assignedTo: '', assignedDate: '', actionDate: '', doneBy: '', remarks: '', status: 'Open' });
  };

  const addDailyLog = (projectId: string, taskId: string) => {
    if (!newLog.activity) return;
    const project = projects.find(p => p.id === projectId);
    if (!project) return;

    const execution = [...(project.execution || [])];
    const taskIndex = execution.findIndex(t => t.id === taskId);
    if (taskIndex === -1) return;

    const task = execution[taskIndex];
    const logs = task.dailyLogs || [];
    const log: DailyLog = {
      id: Math.random().toString(36).substr(2, 9),
      date: new Date().toISOString().split('T')[0],
      ...newLog
    };

    execution[taskIndex] = { ...task, dailyLogs: [...logs, log] };
    onUpdateProject({ ...project, execution });
    setNewLog({ activity: '', doneBy: '', remarks: '' });
  };

  const handleDeleteTask = (taskId: string, projectId: string) => {
    const project = projects.find(p => p.id === projectId);
    if (!project) return;
    const execution = (project.execution || []).filter(t => t.id !== taskId);
    onUpdateProject({ ...project, execution });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row gap-4 justify-between items-start md:items-center bg-white p-5 rounded-2xl border border-n200 shadow-sm">
        <div className="flex flex-wrap gap-3 flex-1">
          <div className="relative w-full md:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-n400" size={16} />
            <input 
              type="text" 
              placeholder="Search tasks or projects..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-n050 border border-n200 rounded-xl text-xs focus:ring-2 focus:ring-shiroi-green transition-all outline-none"
            />
          </div>
          
          <select 
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
            className="px-3 py-2 bg-n050 border border-n200 rounded-xl text-xs font-medium text-n700 focus:ring-2 focus:ring-shiroi-green outline-none"
          >
            <option value="All">All Projects</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>

          <select 
            value={engineerFilter}
            onChange={(e) => setEngineerFilter(e.target.value)}
            className="px-3 py-2 bg-n050 border border-n200 rounded-xl text-xs font-medium text-n700 focus:ring-2 focus:ring-shiroi-green outline-none"
          >
            {engineers.map(e => <option key={e} value={e}>{e === 'All' ? 'All Engineers' : e}</option>)}
          </select>

          <select 
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 bg-n050 border border-n200 rounded-xl text-xs font-medium text-n700 focus:ring-2 focus:ring-shiroi-green outline-none"
          >
            <option value="All">All Status</option>
            <option value="Open">Open</option>
            <option value="In Progress">In Progress</option>
            <option value="Closed">Closed</option>
          </select>
        </div>

        <button 
          onClick={() => {
            setEditingTask(null);
            setNewTask({ title: '', projectId: projects[0]?.id || '', category: EXECUTION_MILESTONES[0], assignedTo: '', assignedDate: '', actionDate: '', doneBy: '', remarks: '', status: 'Open' });
            setIsModalOpen(true);
          }}
          className="btn-primary shadow-lg shadow-shiroi-green/20"
        >
          <Plus size={16} /> Add Task
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-n200 shadow-sm overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-n050 border-b border-n200">
              <th className="px-5 py-3 text-[10px] font-bold text-n500 uppercase tracking-wider font-display">Category</th>
              <th className="px-5 py-3 text-[10px] font-bold text-n500 uppercase tracking-wider font-display">Task Name</th>
              <th className="px-5 py-3 text-[10px] font-bold text-n500 uppercase tracking-wider font-display">Project</th>
              <th className="px-5 py-3 text-[10px] font-bold text-n500 uppercase tracking-wider font-display">Asg To</th>
              <th className="px-5 py-3 text-[10px] font-bold text-n500 uppercase tracking-wider font-display">Asg Date</th>
              <th className="px-5 py-3 text-[10px] font-bold text-n500 uppercase tracking-wider font-display">Action Date</th>
              <th className="px-5 py-3 text-[10px] font-bold text-n500 uppercase tracking-wider font-display">Done By</th>
              <th className="px-5 py-3 text-[10px] font-bold text-n500 uppercase tracking-wider font-display">Remarks</th>
              <th className="px-5 py-3 text-[10px] font-bold text-n500 uppercase tracking-wider font-display">Status</th>
              <th className="px-5 py-3 text-[10px] font-bold text-n500 uppercase tracking-wider font-display text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-n100">
            {filteredTasks.map((task) => (
              <React.Fragment key={task.id}>
                <tr className="hover:bg-n050 transition-colors border-b border-n100 last:border-0">
                  <td className="px-5 py-4">
                    <span className="text-[10px] font-bold text-n500 uppercase font-brand">{task.category}</span>
                  </td>
                  <td className="px-5 py-4">
                    <span className="text-xs font-bold text-n900">{task.title}</span>
                  </td>
                  <td className="px-5 py-4">
                    <button 
                      onClick={() => onSelectProject(task.projectId)}
                      className="flex items-center gap-1.5 hover:text-shiroi-green transition-colors group"
                    >
                      <Briefcase size={12} className="text-n400 group-hover:text-shiroi-green" />
                      <span className="text-xs text-n600 font-medium underline decoration-n200 underline-offset-2">{task.projectName}</span>
                    </button>
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-1.5">
                      <User size={12} className="text-n400" />
                      <span className="text-xs text-n600">{task.assignedTo || 'Unassigned'}</span>
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-1.5 text-[10px] text-n500">
                      <Calendar size={12} />
                      <span>{task.assignedDate || '-'}</span>
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-1.5 text-[10px] text-n500">
                      <Clock size={12} />
                      <span>{task.actionDate || '-'}</span>
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    <span className="text-xs text-n600">{task.doneBy || '-'}</span>
                  </td>
                  <td className="px-5 py-4">
                    <span className="text-[10px] text-n500 italic">{task.remarks || '-'}</span>
                  </td>
                  <td className="px-5 py-4">
                    <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider border ${
                      task.status === 'Closed' ? 'bg-shiroi-green text-white border-shiroi-green' : 
                      task.status === 'In Progress' ? 'bg-n100 text-shiroi-green border-n200' : 
                      'bg-n050 text-n600 border-n100'
                    }`}>
                      {task.status}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button 
                        onClick={() => setSelectedTaskForLogs(selectedTaskForLogs === task.id ? null : task.id)}
                        className={`p-1.5 rounded-lg transition-all ${selectedTaskForLogs === task.id ? 'bg-n100 text-shiroi-green' : 'text-n400 hover:text-shiroi-green'}`}
                        title="Daily Logs"
                      >
                        <Activity size={14} />
                      </button>
                      <button 
                        onClick={() => {
                          setEditingTask({ ...task });
                          setIsModalOpen(true);
                        }}
                        className="p-1.5 hover:bg-n100 rounded-lg text-n400 hover:text-shiroi-green transition-all"
                      >
                        <Edit2 size={14} />
                      </button>
                      <button 
                        onClick={() => handleDeleteTask(task.id, task.projectId)}
                        className="p-1.5 hover:bg-n100 rounded-lg text-n400 hover:text-red-500 transition-all"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
                {selectedTaskForLogs === task.id && (
                  <tr className="bg-n050/50">
                    <td colSpan={10} className="px-8 py-4">
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <h4 className="text-[10px] font-bold text-n500 uppercase tracking-wider flex items-center gap-2 font-display">
                            <Activity size={12} />
                            Daily Activity Logs - {task.title}
                          </h4>
                        </div>
                        
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                          <input 
                            type="text" 
                            placeholder="Activity description..."
                            value={newLog.activity}
                            onChange={(e) => setNewLog({...newLog, activity: e.target.value})}
                            className="px-3 py-1.5 bg-white border border-n200 rounded-lg text-xs focus:ring-2 focus:ring-shiroi-green focus:outline-none"
                          />
                          <input 
                            type="text" 
                            placeholder="Done by..."
                            value={newLog.doneBy}
                            onChange={(e) => setNewLog({...newLog, doneBy: e.target.value})}
                            className="px-3 py-1.5 bg-white border border-n200 rounded-lg text-xs focus:ring-2 focus:ring-shiroi-green focus:outline-none"
                          />
                          <input 
                            type="text" 
                            placeholder="Remarks..."
                            value={newLog.remarks}
                            onChange={(e) => setNewLog({...newLog, remarks: e.target.value})}
                            className="px-3 py-1.5 bg-white border border-n200 rounded-lg text-xs focus:ring-2 focus:ring-shiroi-green focus:outline-none"
                          />
                          <button 
                            onClick={() => addDailyLog(task.projectId, task.id)}
                            className="px-3 py-1.5 bg-n900 text-white rounded-lg text-xs font-bold hover:bg-n800 transition-all"
                          >
                            Add Log
                          </button>
                        </div>

                        {task.dailyLogs && task.dailyLogs.length > 0 ? (
                          <div className="bg-white rounded-xl border border-n200 overflow-hidden">
                            <table className="w-full text-left border-collapse">
                              <thead className="bg-n050 border-b border-n200">
                                <tr>
                                  <th className="px-3 py-2 text-[9px] font-bold text-n400 uppercase font-display">Date</th>
                                  <th className="px-3 py-2 text-[9px] font-bold text-n400 uppercase font-display">Activity</th>
                                  <th className="px-3 py-2 text-[9px] font-bold text-n400 uppercase font-display">Done By</th>
                                  <th className="px-3 py-2 text-[9px] font-bold text-n400 uppercase font-display">Remarks</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-n100">
                                {task.dailyLogs.map((log: any) => (
                                  <tr key={log.id}>
                                    <td className="px-3 py-2 text-[10px] text-n500">{log.date}</td>
                                    <td className="px-3 py-2 text-[10px] text-n700 font-medium">{log.activity}</td>
                                    <td className="px-3 py-2 text-[10px] text-n600">{log.doneBy}</td>
                                    <td className="px-3 py-2 text-[10px] text-n500 italic">{log.remarks}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <p className="text-[10px] text-n400 italic">No daily logs recorded yet.</p>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {/* Task Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-n900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-n200 w-full max-w-lg overflow-hidden">
            <div className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="text-base font-bold text-n800 font-display">{editingTask ? 'Edit Task' : 'Add New Task'}</h4>
                <button onClick={() => setIsModalOpen(false)} className="p-1 hover:bg-n100 rounded-lg text-n400">
                  <X size={20} />
                </button>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-n400 uppercase">Category</label>
                  <select 
                    value={editingTask ? editingTask.category : newTask.category}
                    onChange={(e) => editingTask ? setEditingTask({...editingTask, category: e.target.value}) : setNewTask({...newTask, category: e.target.value})}
                    className="w-full px-4 py-2 bg-n050 border border-n200 rounded-xl text-sm focus:ring-2 focus:ring-shiroi-green focus:outline-none"
                  >
                    {EXECUTION_MILESTONES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-n400 uppercase">Task Name</label>
                  <input 
                    type="text" 
                    value={editingTask ? editingTask.title : newTask.title}
                    onChange={(e) => editingTask ? setEditingTask({...editingTask, title: e.target.value}) : setNewTask({...newTask, title: e.target.value})}
                    placeholder="Enter task name..."
                    className="w-full px-4 py-2 bg-n050 border border-n200 rounded-xl text-sm focus:ring-2 focus:ring-shiroi-green focus:outline-none"
                  />
                </div>

                {!editingTask && (
                  <div className="space-y-1.5 md:col-span-2">
                    <label className="text-[10px] font-bold text-n400 uppercase">Project</label>
                    <select 
                      value={newTask.projectId}
                      onChange={(e) => setNewTask({...newTask, projectId: e.target.value})}
                      className="w-full px-4 py-2 bg-n050 border border-n200 rounded-xl text-sm focus:ring-2 focus:ring-shiroi-green focus:outline-none"
                    >
                      {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
                )}

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-n400 uppercase">Assigned To</label>
                  <input 
                    type="text" 
                    value={editingTask ? editingTask.assignedTo : newTask.assignedTo}
                    onChange={(e) => editingTask ? setEditingTask({...editingTask, assignedTo: e.target.value}) : setNewTask({...newTask, assignedTo: e.target.value})}
                    placeholder="Engineer name..."
                    className="w-full px-4 py-2 bg-n050 border border-n200 rounded-xl text-sm focus:ring-2 focus:ring-shiroi-green focus:outline-none"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-n400 uppercase">Assigned Date</label>
                  <input 
                    type="date" 
                    value={editingTask ? editingTask.assignedDate : newTask.assignedDate}
                    onChange={(e) => editingTask ? setEditingTask({...editingTask, assignedDate: e.target.value}) : setNewTask({...newTask, assignedDate: e.target.value})}
                    className="w-full px-4 py-2 bg-n050 border border-n200 rounded-xl text-sm focus:ring-2 focus:ring-shiroi-green focus:outline-none"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-n400 uppercase">Action Date</label>
                  <input 
                    type="date" 
                    value={editingTask ? editingTask.actionDate : newTask.actionDate}
                    onChange={(e) => editingTask ? setEditingTask({...editingTask, actionDate: e.target.value}) : setNewTask({...newTask, actionDate: e.target.value})}
                    className="w-full px-4 py-2 bg-n050 border border-n200 rounded-xl text-sm focus:ring-2 focus:ring-shiroi-green focus:outline-none"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-n400 uppercase">Done By</label>
                  <input 
                    type="text" 
                    value={editingTask ? editingTask.doneBy : newTask.doneBy}
                    onChange={(e) => editingTask ? setEditingTask({...editingTask, doneBy: e.target.value}) : setNewTask({...newTask, doneBy: e.target.value})}
                    placeholder="Done by..."
                    className="w-full px-4 py-2 bg-n050 border border-n200 rounded-xl text-sm focus:ring-2 focus:ring-shiroi-green focus:outline-none"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-n400 uppercase">Status</label>
                  <select 
                    value={editingTask ? editingTask.status : newTask.status}
                    onChange={(e) => editingTask ? setEditingTask({...editingTask, status: e.target.value}) : setNewTask({...newTask, status: e.target.value})}
                    className="w-full px-4 py-2 bg-n050 border border-n200 rounded-xl text-sm focus:ring-2 focus:ring-shiroi-green focus:outline-none"
                  >
                    <option value="Open">Open</option>
                    <option value="In Progress">In Progress</option>
                    <option value="Closed">Closed</option>
                  </select>
                </div>

                <div className="space-y-1.5 md:col-span-2">
                  <label className="text-[10px] font-bold text-n400 uppercase">Remarks / Notes</label>
                  <textarea 
                    value={editingTask ? editingTask.remarks : newTask.remarks}
                    onChange={(e) => editingTask ? setEditingTask({...editingTask, remarks: e.target.value}) : setNewTask({...newTask, remarks: e.target.value})}
                    placeholder="Add notes or remarks..."
                    rows={3}
                    className="w-full px-4 py-2 bg-n050 border border-n200 rounded-xl text-sm focus:ring-2 focus:ring-shiroi-green focus:outline-none resize-none"
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-4">
                <button onClick={() => setIsModalOpen(false)} className="btn-ghost flex-1">
                  Cancel
                </button>
                <button onClick={handleSaveTask} className="btn-primary flex-1 shadow-lg shadow-shiroi-green/20">
                  {editingTask ? 'Update Task' : 'Save Task'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
