/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { 
  LayoutDashboard, 
  Briefcase, 
  CheckSquare, 
  Wrench, 
  Calendar, 
  Receipt, 
  Menu, 
  X, 
  ChevronRight,
  Search,
  Plus,
  Filter
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { mockProjects, mockServices, mockAMCs } from './mockData';
import { Project, ServiceRecord, AMCRecord, ProjectStatus } from './types';
import Dashboard from './components/Dashboard';
import ProjectList from './components/ProjectList';
import ProjectDetail from './components/ProjectDetail';
import TaskList from './components/TaskList';
import ServiceList from './components/ServiceList';
import AMCList from './components/AMCList';
import ExpenseList from './components/ExpenseList';

type View = 'dashboard' | 'projects' | 'tasks' | 'services' | 'amc' | 'expenses';

export default function App() {
  const [currentView, setCurrentView] = useState<View>('dashboard');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [projects, setProjects] = useState<Project[]>(mockProjects);
  const [services, setServices] = useState<ServiceRecord[]>(mockServices);
  const [amcs, setAmcs] = useState<AMCRecord[]>(mockAMCs);

  const activeProject = useMemo(() => 
    projects.find(p => p.id === selectedProjectId), 
    [projects, selectedProjectId]
  );

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'projects', label: 'Projects', icon: Briefcase },
    { id: 'tasks', label: 'Tasks', icon: CheckSquare },
    { id: 'services', label: 'Services', icon: Wrench },
    { id: 'amc', label: 'AMC', icon: Calendar },
    { id: 'expenses', label: 'Expenses', icon: Receipt },
  ];

  const handleProjectClick = (id: string) => {
    setSelectedProjectId(id);
    setCurrentView('projects');
  };

  const renderView = () => {
    if (selectedProjectId && currentView === 'projects') {
      return (
        <ProjectDetail 
          project={activeProject!} 
          allProjects={projects}
          onBack={() => setSelectedProjectId(null)}
          onUpdate={(updated) => setProjects(prev => prev.map(p => p.id === updated.id ? updated : p))}
        />
      );
    }

    switch (currentView) {
      case 'dashboard':
        return <Dashboard projects={projects} services={services} amcs={amcs} onProjectClick={handleProjectClick} />;
      case 'projects':
        return <ProjectList projects={projects} onProjectClick={handleProjectClick} />;
      case 'tasks':
        return <TaskList projects={projects} onUpdateProject={(updated) => setProjects(prev => prev.map(p => p.id === updated.id ? updated : p))} onSelectProject={handleProjectClick} />;
      case 'services':
        return <ServiceList services={services} projects={projects} />;
      case 'amc':
        return <AMCList amcs={amcs} projects={projects} />;
      case 'expenses':
        return <ExpenseList projects={projects} />;
      default:
        return <Dashboard projects={projects} services={services} amcs={amcs} onProjectClick={handleProjectClick} />;
    }
  };

  return (
    <div className="flex h-screen bg-n050 font-sans text-n900 overflow-hidden">
      {/* Sidebar */}
      <motion.aside 
        initial={false}
        animate={{ width: isSidebarOpen ? 240 : 56 }}
        className="bg-shiroi-green-night text-n400 flex flex-col border-r border-n700 z-30"
      >
        <div className="h-[52px] px-4 flex items-center justify-between border-b border-n700">
          {isSidebarOpen && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="font-brand font-bold text-sm text-shiroi-green tracking-widest uppercase flex items-center gap-2"
            >
              <img 
                src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NDcgNjYyIiB3aWR0aD0iNjQ3IiBoZWlnaHQ9IjY2MiIgc3R5bGU9InNoYXBlLXJlbmRlcmluZzpnZW9tZXRyaWNQcmVjaXNpb247dGV4dC1yZW5kZXJpbmc6Z2VvbWV0cmljUHJlY2lzaW9uO2ltYWdlLXJlbmRlcmluZzpvcHRpbWl6ZVF1YWxpdHk7ZmlsbC1ydWxlOmV2ZW5vZGQ7Y2xpcC1ydWxlOmV2ZW5vZGQiPgogIDxnLz4KICA8cGF0aCBzdHlsZT0ib3BhY2l0eToxIiBmaWxsPSIjZjlmYTAwIiBkPSJNMzIwLjUtLjVoN2EyMTY2NCAyMTY2NCAwIDAgMSAyNiAxOTBxLTMwLjAyLS4yNzUtNjAgMWE2NTkzMCA2NTkzMCAwIDAgMSAyNy0xOTEiLz4KICA8cGF0aCBzdHlsZT0ib3BhY2l0eToxIiBmaWxsPSIjZjljODAwIiBkPSJNMzIzLjUgMjYuNWE4Nzg3IDg3ODcgMCAwIDEgMjIgMTU2IDQ4NSA0ODUgMCAwIDEtNDQtMSA3MjIyIDcyMjIgMCAwIDAgMjItMTU1Ii8+CiAgPHBhdGggc3R5bGU9Im9wYWNpdHk6MSIgZmlsbD0iI2ZhZjkwMCIgZD0iTTE4Mi41IDI5LjVhMjkyNDQgMjkyNDQgMCAwIDEgMTA3IDE2MC41IDM5ODUgMzk4NSAwIDAgMS01My41IDI2LjVBMjkxODAgMjkxODAgMCAwIDEgMTc3LjUgMzRhMjEuOCAyMS44IDAgMCAxIDUtNC41bTI4MyAycTMuNTMgMS4yNiA2IDRhNTc5NjIgNTc5NjIgMCAwIDAtNTkuNSAxODIgNDEyMCA0MTIwIDAgMCAwLTU0LjUtMjYuNSA0MzE1MiA0MzE1MiAwIDAgMCAxMDgtMTU5LjUiLz4KICA8cGF0aCBzdHlsZT0ib3BhY2l0eToxIiBmaWxsPSIjZjljODAwIiBkPSJNMTkzLjUgNTguNWEyMzc0OSAyMzc0OSAwIDAgMSA4NiAxMjguNWwtMzkgMTkuNWE0NzcxIDQ3NzEgMCAwIDEtNDctMTQ4bTI2MSAxcS44OTUuMzUyIDEgMS41YTM2NzY1IDM2NzY1IDAgMCAwLTQ3IDE0NS41IDguNCA4LjQgMCAwIDEtNC0uNWwtMzYtMThhMTUyMzMgMTUyMzMgMCAwIDAgODYtMTI4LjUiLz4KICA8cGF0aCBzdHlsZT0ib3BhY2l0eToxIiBmaWxsPSIjZjlmYTAwIiBkPSJNNjYuNSAxMjAuNWE4MzU5IDgzNTkgMCAwIDEgMTY2IDk4LjUgMTI0OSAxMjQ5IDAgMCAwLTM3LjUgNDYuNVExMjguNzkyIDE5NS4yOSA2Mi41IDEyNWEyNSAyNSAwIDAgMCA0LTQuNSIvPgogIDxwYXRoIHN0eWxlPSJvcGFjaXR5OjEiIGZpbGw9IiNmYWY5MDAiIGQ9Ik01ODAuNSAxMjIuNWEzOCAzOCAwIDAgMCA1IDUuNUw0NTIgMjY3LjVhMTM1MCAxMzUwIDAgMCAwLTM3LjUtNDcuNSAxOTkyMCAxOTkyMCAwIDAgMCAxNjYtOTcuNSIvPgogIDxwYXRoIHN0eWxlPSJvcGFjaXR5OjEiIGZpbGw9IiNmOWM4MDAiIGQ9Ik04Ni41IDE0MS41cS4wOS0uODE0IDEtMWExMzUzOSAxMzUzOSAwIDAgMSAxMzQgODAuNSA1OTcgNTk3IDAgMCAwLTI1LjUgMzIuNXEtMS4wNzcgMS40MjYtMi41LjVhMTcyMjkgMTcyMjkgMCAwIDAtMTA3LTExMi41bTQ3MiAyYTIuNDMgMi40MyAwIDAgMSAyIC41QTg1MzQgODUzNCAwIDAgMCA0NTMgMjU2LjVhNjgwIDY4MCAwIDAgMS0yNy41LTM0LjUgNjUwOSA2NTA5IDAgMCAwIDEzMy03OC41Ii8+CiAgPHBhdGggc3R5bGU9Im9wYWNpdHk6MSIgZmlsbD0iI2YyZWY4NyIgZD0iTTMxMi41IDE5OC41cTgxLjk5OC0yLjM4OCAxMjQuNSA2NyAzOC4yIDc3LjI1OS0xMiAxNDctNTUuNzY2IDYzLjkxOC0xMzguNSA0My41LTgxLjczMi0yOS4xNjMtOTIuNS0xMTUuNS0zLjUzNC04MS4xOTIgNjQuNS0xMjQuNSAyNS40OS0xNC4wODIgNTQtMTcuNSIvPgogIDxwYXRoIHN0eWxlPSJvcGFjaXR5OjEiIGZpbGw9IiNmOWY5MDAiIGQ9Ik0zMDEuNSAyMDIuNXExLjMxNC0uMTk3IDIgMWwxMCAxOHE3Ny43MzMtMS4wMyAxMTAuNSA2OSAyNC4wNDMgNjkuMDctMjguNSAxMTkuNWEyMTggMjE4IDAgMCAxIDggMTggMjQuMyAyNC4zIDAgMCAxLTMuNSAzLjUgMTQ5IDE0OSAwIDAgMC0xNy0xMnEtNTYuODU1IDM2LjYyNy0xMTUuNSAyLjUtNzMuOTYzLTUxLjg5OS00MS41LTEzNi41YTIwMSAyMDEgMCAwIDEgMTcuNS0yOCA3MTUgNzE1IDAgMCAwLTctNi41IDQ1MjMyIDQ1MjMyIDAgMCAwIDY1LTQ4LjUiLz4KICA8cGF0aCBzdHlsZT0ib3BhY2l0eToxIiBkPSJNMzAwLjUgMjA5LjVhMjA5IDIwOSAwIDAgMSAxMCAxN3E4NC42ODQtMi41MDQgMTEyLjUgNzcgMTQuMjIxIDYyLjgyNy0zMy41IDEwNS41IDMuNzU2IDUuNTI3IDQgMTEuNWExMDggMTA4IDAgMCAwLTEwLjUtN3EtNjUuOTE5IDQyLjQ2LTEyNy41LTYuNS01MS42NDUtNDguODM3LTI2LjUtMTE1LjUgOC4wNzctMTkuNDI3IDIyLjUtMzQuNWE0NyA0NyAwIDAgMS03LTYgMjQ4NyAyNDg3IDAgMCAwIDU2LTQxLjUiLz4KICA8cGF0aCBzdHlsZT0ib3BhY2l0eToxIiBmaWxsPSIjZjlmYWY5IiBkPSJNMjk5LjUgMjEzLjVhMjE4NSAyMTg1IDAgMCAxIDMyIDU1IDEwMCAxMDAgMCAwIDEt1TAgNi41cS0yLjI2IDEuMjU2LTEuNSAzLjVsNDAuNSA1MC41YTIwMiAyMDIgMCAwIDAtMTUgNmw0NCA3OWExMzA1IDEzMDUgMCAwIDEtNjgtNTZsMTUtMTEtNTQtNDBhMTcyIDE3MiAwIDAgMSAxOC0xM2wtNTItNDNhMzA1MyAzMDUzIDAgMCAwIDUxLTM3LjUiLz4KICA8cGF0aCBzdHlsZT0ib3BhY2l0eToxIiBmaWxsPSIjMDBmYWY5IiBkPSJNMzg3LjUgNDAyLjVxNDcuMDAyLTQ2LjUxIDI1LjUtMTA5LTI5LjE3NS02MS40NzgtOTcuNS02MGE0NCA0NCAwIDAgMC0xLTJxNzcuNDkzLTMuNjM1IDEwNC41IDY5IDE1LjY4MSA2MS40MzctMzAgMTA1LTEuNTU4LTEuMTE2LTEuNS0zIi8+CiAgPHBhdGggc3R5bGU9Im9wYWNpdHk6MSIgZmlsbD0iI2Y5ZmFmOSIgZD0iTTMxNS41IDIzMy41cTY4LjMyNS0xLjQ3OCA5Ny41IDYwIDIxLjUwMiA2Mi40OS0yNS41IDEwOS0xLjM1Mi0xLjE4NS0yLTMgNDQuMzUyLTQ0Ljk5MyAyMy41LTEwNS0yNi45NDItNTcuMTE5LTkwLjUtNTctMi4yMTEtMS40MDUtMy00Ii8+CiAgPHBhdGggc3R5bGU9Im9wYWNpdHk6MSIgZmlsbD0iIzAwZmFmOSIgZD0iTTMxOC41IDIzNy41cTYzLjU1OC0uMTE5IDkwLjUgNTcgMjAuODUyIDYwLjAwNy0yMy41IDEwNWE1NDczIDU0NzMgMCAwIDEtMzUtNjIuNSAxMTUgMTE1IDAgMCAxIDE2LTZsLTQzLTUzYTE2MCAxNjAgMCAwIDAgMTItOC41IDYyODMgNjI4MyAwIDAgMS0xNy0zMiIvPgogIDxwYXRoIHN0eWxlPSJvcGFjaXR5OjEiIGZpbGw9IiNmOWZhMDAiIGQ9Ik0tLjUgMjU4LjV2LTJhMzkuNSAzOS41IDAgMCAxIDIuNS01cTk1LjEwMyA5LjM1IDE5MC41IDE3YTE3MzkgMTczOSAwIDAgMS0xMi41IDU3cS0uNTgyIDEuMzkyLTIgMmE1NjI4NSA1NjI4NSAwIDAgMS0xNzguNS02OW02NDctMXY1YTI5MDgzIDI5MDgzIDAgMCAwLTE3OSA2NyAxMTcxIDExNzEgMCAwIDEtMTQtNTlxOTQuMDItNy4xNjggMTg4LTE1IDIuOTMyLjMzNiA1IDIiLz4KICA8cGF0aCBzdHlsZT0ib3BhY2l0eToxIiBmaWxsPSIjZjljODAwIiBkPSJNMjguNSAyNjIuNWE2MDQ2IDYwNDYgMCAwIDEgMTU1IDEzIDY2NiA2NjYgMCAwIDEtOS41IDQzIDEyNzk5IDEyNzk5IDAgMCAwLTE0NS41LTU2Ii8+CiAgPHBhdGggc3R5bGU9Im9wYWNpdHk6MSIgZmlsbD0iI2Y5ZmFmOSIgZD0ibTI1NS41IDI2MS41IDMgMnEtNDEuMjI2IDQ1Ljg5LTE5LjUgMTA0IDI2LjEwNyA1Mi4zMzIgODUgNTUgMjcuMzU3LS43MDUgNTAuNS0xNWwzIDJxLTUwLjIxMyAzMS44OTYtMTAzIDMuNS01MS44ODgtMzMuNTMtNDYuNS05NS41IDQuNTkxLTMyLjY4IDI3LjUtNTYiLz4KICA8cGF0aCBzdHlsZT0ib3BhY2l0eToxIiBmaWxsPSIjZjljODAwIiBkPSJNNjE1LjUgMjY0LjVhOC40IDguNCAwIDAgMSA0IC41IDc4ODUgNzg4NSAwIDAgMS0xNDggNTQuNSAxMTc1IDExNzUgMCAwIDAtOS00MnE3Ni43MjUtNi4yNjggMTUzLTEzIi8+CiAgPHBhdGggc3R5bGU9Im9wYWNpdHk6MSIgZmlsbD0iI2Y5ZmEwMCIgZD0iTS0uNSA0MDQuNXYtNmE5NjUwIDk2NTAgMCAwIDAgMTc5LTY3IDEyNjQgMTI2NCAwIDAgMSAxNCA1OSAyOTg4NCAyOTg4NCAwIDAgMC0xOTEgMTYgMzEgMzEgMCAwIDAtMi0yIi8+CiAgPHBhdGggc3R5bGU9Im9wYWNpdHk6MSIgZmlsbD0iI2ZhZjkwMCIgZD0iTTY0Ni41IDQwMi41djFxLTEuMjA4IDIuMjQ2LTIgNWwtMy41IDFhMjE3NDMgMjE3NDMgMCAwIDAtMTg3LjUtMTcgMTgwNiAxODA2IDAgMCAxIDEyLjUtNTggMy42NSAzLjY1IDAgMCAxIDEuNS0xIDIwMDYzIDIwMDYzIDAgMCAwIDE3OSA2OSIvPgogIDxwYXRoIHN0eWxlPSJvcGFjaXR5OjEiIGZpbGw9IiNmOWM4MDAiIGQ9Ik0xNzEuNSAzNDEuNWgzYTE5ODcgMTk4NyAwIDAgMCA5IDQzIDMxNDEzIDMxNDEzIDAgMCAxLTE1NSAxMS41IDM0MjI4IDM0MjI4IDAgMCAwIDE0My01NC41bTMwMCAyYTc2NTEgNzY1MSAwIDAgMSAxNDUgNTUuNSA2NTA5IDY1MDkgMCAwIDEtMTUzLTEzIDYuMyA2LjMgMCAwIDEtMS0zIDEzODggMTM4OCAwIDAgMSA5LTM5LjUiLz4KICA8cGF0aCBzdHlsZT0ib3BhY2l0eToxIiBmaWxsPSIjYzNmNDQ1IiBkPSJNMjU4LjUgMjYzLjVhNzcxIDc3MSAwIDAgMSAzNiAzMCAyNjcgMjY3IDAgMCAxLTE4IDEzLjVsNTQgNDBhMTgwIDE4MCAwIDAgMS0xNSAxMCAzMDYyOSAzMDYyOSAwIDAgMSA1OSA1MC41cS0yMy4xNDMgMTQuMjk1LTUwLjUgMTUtNTguODkzLTIuNjY4LTg1LTU1LTIxLjcyNi01OC4xMSAxOS41LTEwNCIvPgogIDxwYXRoIHN0eWxlPSJvcGFjaXR5OjEiIGZpbGw9IiNjMmY0NDciIGQ9Ik0yNTUuNSAyNjEuNXEtMjIuOTA5IDIzLjMyLTI3LjUgNTYtNS4zODggNjEuOTcgNDYuNSA5NS41IDUyLjc4NyAyOC4zOTYgMTAzLTMuNWExMC41IDEwLjUgMCAwIDEgMyAyLjVxLTUxLjUzMiAzMi4xMDYtMTA2IDUtNTkuMDE1LTM3Ljc5OC00OC41LTEwNy41IDYuMzc1LTI5LjI2NiAyNy41LTUwIDEuNTMzLjUzMyAyIDIiLz4KICA8cGF0aCBzdHlsZT0ib3BhY2l0eToxIiBmaWxsPSIjZmFmOTAwIiBkPSJNMTkyLjUgMzk0LjVxMi4yNzYuMDE2IDMuNSAyYTExMzMgMTEzMyAwIDAgMCAzNS41IDQ0LjUgNzA4OSA3MDg5IDAgMCAxLTE2NyA5NyAxNC41IDE0LjUgMCAwIDAtNC01IDEyODE2IDEyODE2IDAgMCAwIDEzMi0xMzguNW0yNTggMWE4NzY5IDg3NjkgMCAwIDEgMTMyIDE0MC41IDE3LjggMTcuOCAwIDAgMS00LjUgNS41QTQwOTc0IDQwOTc0IDAgMCAwIDQxMy41IDQ0MmE4MTYgODE2IDAgMCAwIDM3LTQ2LjUiLz4KICA8cGF0aCBzdHlsZT0ib3BhY2l0eToxIiBmaWxsPSIjZjljODAwIiBkPSJNMTkyLjUgNDA0LjVhNDcwIDQ3MCAwIDAgMSAyOCAzNC41QTI2NjE4IDI2NjE4IDAgMCAxIDg3IDUxNy41cS0xLTEgMC0yYTU0OTcgNTQ5NyAwIDAgMCAxMDUuNS0xMTFtMjU4IDJxMy44MzQgMS41NjUgNi41IDVBNzc2OCA3NzY4IDAgMCAwIDU1OC41IDUyMGE0NjI3IDQ2MjcgMCAwIDEtMTM0LTc5LjUgMjc1NzEgMjc1NzEgMCAwIDEgMjYtMzQiLz4KICA8cGF0aCBzdHlsZT0ib3BhY2l0eToxIiBmaWxsPSIjZmFmOTAwIiBkPSJtMjMzLjUgNDQzLjUgNTUgMjYuNWEyNzU1OSAyNzU1OSAwIDAgMS0xMDggMTU5LjUgMTcuNSAxNy41IDAgMCAxLTYtMyA5NzM2IDk3MzYgMCAwIDAgNTktMTgzbTE3NiAxYTE5NzE1IDE5NzE1IDAgMCAxIDU5IDE4My41IDYxIDYxIDAgMCAwLTYuNSAzLjUgMjU2NTMgMjU2NTMgMCAwIDEtMTA1LjUtMTYwIDE5NzYgMTk3NiAwIDAgMSA1My0yNyIvPgogIDxwYXRoIHN0eWxlPSJvcGFjaXR5OjEiIGZpbGw9IiNmOWM4MDAiIGQ9Ik0yMzcuNSA0NTQuNWEzOCAzOCAwIDAgMSA4IDIuNSA3MjAgNzIwIDAgMCAxIDMyIDE2LjVsLTg2LjUgMTI5YTEyNTkxIDEyNTkxIDAgMCAxIDQ2LjUtMTQ4bTE2NyAwcTIuMTQ2LjU3MiAyLjUgMyAyMi45OTUgNzMuMDE2IDQ1IDE0NkwzNjYuNSA0NzRhMTAxNSAxMDE1IDAgMCAwIDM4LTE5LjUiLz4KICA8cGF0aCBzdHlsZT0ib3BhY2l0eToxIiBmaWxsPSIjZjlmYTAwIiBkPSJNMzI0LjUgNjYxLjVoLTdhMTg0OTcgMTg0OTcgMCAwIDAtMjYtMTg5LjUgNjIxIDYyMSAwIDAgMSA2MSAuNSAzMjI3NyAzMjI3NyAwIDAgMC0yOCAxODkiLz4KICA8cGF0aCBzdHlsZT0ib3BhY2l0eToxIiBmaWxsPSIjZjljODAwIiBkPSJNMzAwLjUgNDc4LjVoNDNhNTI3MSA1MjcxIDAgMCAxLTIyLjUgMTU0IDEyMTcwIDEyMTcwIDAgMCAxLTIwLjUtMTU0Ii8+Cjwvc3ZnPgo=" 
                alt="Shiroi Energy Logo" 
                className="w-6 h-6 object-contain"
              />
              Shiroi Energy
            </motion.div>
          )}
          <button 
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="p-1.5 hover:bg-n800 rounded-lg transition-colors text-n400 hover:text-white"
          >
            {isSidebarOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>

        <nav className="flex-1 px-2 py-4 space-y-1">
          {isSidebarOpen && (
            <div className="px-3 mb-2">
              <p className="text-[9px] font-bold text-n600 uppercase tracking-[0.2em]">Operations</p>
            </div>
          )}
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                setCurrentView(item.id as View);
                setSelectedProjectId(null);
              }}
              className={`w-full flex items-center gap-3 p-2.5 rounded-sm transition-all duration-200 relative group ${
                currentView === item.id && !selectedProjectId
                  ? 'bg-shiroi-green/15 text-shiroi-green font-semibold'
                  : 'hover:bg-n800 hover:text-n100'
              }`}
            >
              {currentView === item.id && !selectedProjectId && (
                <div className="absolute left-0 top-1 bottom-1 w-[3px] bg-shiroi-green rounded-r-sm" />
              )}
              <item.icon size={18} className={currentView === item.id && !selectedProjectId ? 'text-shiroi-green' : 'text-n500 group-hover:text-n300'} />
              {isSidebarOpen && <span className="text-[13px]">{item.label}</span>}
            </button>
          ))}
        </nav>

        <div className="p-4 border-t border-n700">
          <div className={`flex items-center gap-3 ${isSidebarOpen ? 'px-1' : 'justify-center'}`}>
            <div className="w-8 h-8 rounded-full bg-shiroi-green-forest flex items-center justify-center text-shiroi-green font-bold text-xs border border-shiroi-green/30">
              M
            </div>
            {isSidebarOpen && (
              <div className="overflow-hidden">
                <p className="text-xs font-semibold text-n100 truncate">Manivel</p>
                <p className="text-[10px] text-n500 truncate uppercase tracking-wider">Admin</p>
              </div>
            )}
          </div>
        </div>
      </motion.aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="h-[52px] bg-white border-b border-n200 flex items-center justify-between px-6 z-20 shadow-sm">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-display font-bold text-n900 uppercase tracking-tight">
              {selectedProjectId ? 'Project Details' : currentView}
            </h2>
            {selectedProjectId && ( activeProject && (
              <>
                <ChevronRight size={14} className="text-n300" />
                <span className="text-xs text-n500 font-medium">{activeProject.name}</span>
              </>
            ))}
          </div>
          
          <div className="flex items-center gap-4">
            <div className="relative hidden md:block">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-n400" size={14} />
              <input 
                type="text" 
                placeholder="Search..." 
                className="pl-9 pr-4 py-1.5 bg-n050 border-1.5 border-n200 rounded-sm text-xs w-64 focus:ring-2 focus:ring-shiroi-green/20 focus:border-shiroi-green outline-none transition-all"
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2 text-[9px] font-mono text-n400">⌘K</div>
            </div>
            <button className="btn-primary text-xs uppercase tracking-wider">
              <Plus size={16} />
              New Project
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-6">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentView + (selectedProjectId || '')}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="h-full"
            >
              {renderView()}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
