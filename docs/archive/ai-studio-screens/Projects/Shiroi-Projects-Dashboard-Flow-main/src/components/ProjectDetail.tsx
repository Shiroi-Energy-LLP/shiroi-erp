import React, { useState } from 'react';
import { 
  ArrowLeft, 
  ChevronRight, 
  CheckCircle2, 
  Circle, 
  Save, 
  Download, 
  Plus, 
  Trash2, 
  Send,
  MapPin,
  Phone,
  Mail,
  User,
  Zap,
  DollarSign,
  Calendar,
  Layers,
  ShieldCheck,
  FileText,
  Truck,
  ClipboardCheck,
  Settings,
  Activity,
  Camera,
  Clock,
  Image as ImageIcon,
  FileDown,
  PenTool,
  Edit2,
  ExternalLink,
  Check,
  Printer,
  X,
  BarChart3,
  Upload
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import SignatureCanvas from 'react-signature-canvas';
import { Project, BOIItem, ExecutionTask, BOIStatus, SiteSurvey, Delivery, DailyLog, Expense, Milestone, Liasonning, AMCScheduleItem } from '../types';
import { BOI_CATEGORIES, BOI_STATUSES, EXECUTION_MILESTONES } from '../constants';

interface ProjectDetailProps {
  project: Project;
  allProjects: Project[];
  onBack: () => void;
  onUpdate: (project: Project) => void;
}

const STEPS = [
  'Project Details',
  'Final Site Survey',
  'Create Bill of Items',
  'BOQ Budget Analysis',
  'Delivery Note',
  'Execution',
  'Quality Check',
  'Liasonning Process',
  'System Commissioning',
  'Free AMC'
];

export default function ProjectDetail({ project, allProjects, onBack, onUpdate }: ProjectDetailProps) {
  const [currentStep, setCurrentStep] = useState(0);

  const renderStepContent = () => {
    switch (currentStep) {
      case 0: return <ProjectDetailsTab project={project} onUpdate={onUpdate} />;
      case 1: return <SiteSurveyTab project={project} allProjects={allProjects} onUpdate={onUpdate} />;
      case 2: return <BOITab project={project} onUpdate={onUpdate} />;
      case 3: return <BudgetAnalysisTab project={project} onUpdate={onUpdate} />;
      case 4: return <DeliveryNoteTab project={project} onUpdate={onUpdate} />;
      case 5: return <ExecutionTab project={project} onUpdate={onUpdate} />;
      case 6: return <QualityCheckTab project={project} onUpdate={onUpdate} />;
      case 7: return <LiasonningTab project={project} onUpdate={onUpdate} />;
      case 8: return <CommissioningTab project={project} onUpdate={onUpdate} />;
      case 9: return <AMCTab project={project} onUpdate={onUpdate} />;
      default: return null;
    }
  };

  return (
    <div className="space-y-8 pb-20">
      <div className="flex items-center justify-between">
        <button 
          onClick={onBack}
          className="flex items-center gap-2 text-n500 hover:text-n900 transition-colors font-brand font-bold"
        >
          <ArrowLeft size={20} />
          Back to Projects
        </button>
        <div className="flex gap-3">
          <button className="px-4 py-2 bg-white border border-n200 rounded-lg text-sm font-bold text-n700 hover:bg-n050 transition-colors flex items-center gap-2 font-sans">
            <Download size={18} />
            Export PDF
          </button>
          <button className="px-4 py-2 bg-shiroi-green text-white rounded-lg text-sm font-bold hover:bg-shiroi-green/90 transition-colors flex items-center gap-2 shadow-lg shadow-shiroi-green/20 font-sans">
            <Save size={18} />
            Save Changes
          </button>
        </div>
      </div>

      {/* Stepper */}
      <div className="bg-white p-3 rounded-xl border border-n200 shadow-sm overflow-x-auto">
        <div className="flex items-center min-w-max px-1">
          {STEPS.map((step, index) => (
            <React.Fragment key={step}>
              <div 
                onClick={() => setCurrentStep(index)}
                className={`flex flex-col items-center gap-1 cursor-pointer transition-all ${
                  currentStep === index ? 'scale-105' : 'opacity-60 hover:opacity-100'
                }`}
              >
                <div className={`w-6 h-6 rounded-full flex items-center justify-center border-2 transition-all ${
                  currentStep === index 
                    ? 'bg-shiroi-green border-shiroi-green text-white shadow-lg shadow-shiroi-green/30' 
                    : index < currentStep 
                      ? 'bg-green-500 border-green-500 text-white' 
                      : 'bg-white border-n200 text-n400'
                }`}>
                  {index < currentStep ? <CheckCircle2 size={12} /> : <span className="text-[10px] font-brand font-bold">{index + 1}</span>}
                </div>
                <span className={`text-[8px] font-brand font-bold uppercase tracking-tight text-center max-w-[60px] ${
                  currentStep === index ? 'text-shiroi-green' : 'text-n400'
                }`}>
                  {step}
                </span>
              </div>
              {index < STEPS.length - 1 && (
                <div className={`flex-1 h-0.5 min-w-[20px] mx-1 rounded-full ${
                  index < currentStep ? 'bg-green-500' : 'bg-n100'
                }`} />
              )}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Content Area */}
      <AnimatePresence mode="wait">
        <motion.div
          key={currentStep}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.2 }}
        >
          {renderStepContent()}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

// --- Tab Components ---

function ProjectDetailsTab({ project, onUpdate }: { project: Project; onUpdate: (p: Project) => void }) {
  const [isEditingClient, setIsEditingClient] = useState(false);
  const [isEditingTech, setIsEditingTech] = useState(false);
  const [isEditingFinancial, setIsEditingFinancial] = useState(false);
  const [editedProject, setEditedProject] = useState(project);

  const handleSave = () => {
    onUpdate(editedProject);
    setIsEditingClient(false);
    setIsEditingTech(false);
    setIsEditingFinancial(false);
  };

  const boiTotal = (project.boi || []).reduce((acc, item) => acc + (item.rate * item.quantity * (1 + (item.gst || 0) / 100)), 0);
  const expenseTotal = (project.expenses || []).reduce((acc, exp) => acc + exp.amount, 0);
  const actualBudget = boiTotal + expenseTotal;
  const actualMargin = project.budget > 0 ? ((project.budget - actualBudget) / project.budget) * 100 : 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Client Information */}
      <div className="bg-white p-6 rounded-2xl border border-n200 shadow-sm space-y-6">
        <div className="flex items-center justify-between border-b border-n100 pb-3">
          <h3 className="text-base font-brand font-bold flex items-center gap-2">
            <User className="text-shiroi-green" size={18} />
            Client Information
          </h3>
          <div className="flex gap-2">
            {isEditingClient ? (
              <>
                <button onClick={handleSave} className="p-1.5 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-all">
                  <Check size={14} />
                </button>
                <button onClick={() => { setIsEditingClient(false); setEditedProject(project); }} className="p-1.5 bg-n200 text-n600 rounded-lg hover:bg-n300 transition-all">
                  <X size={14} />
                </button>
              </>
            ) : (
              <button onClick={() => setIsEditingClient(true)} className="p-1.5 hover:bg-n100 rounded-lg text-n400 hover:text-shiroi-green transition-all">
                <Edit2 size={14} />
              </button>
            )}
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {isEditingClient ? (
            <>
              <EditField label="Contact Name" value={editedProject.contactName} onChange={(v) => setEditedProject({ ...editedProject, contactName: v })} />
              <EditField label="Contact Number" value={editedProject.contactNumber} onChange={(v) => setEditedProject({ ...editedProject, contactNumber: v })} />
              <EditField label="Email Address" value={editedProject.email} onChange={(v) => setEditedProject({ ...editedProject, email: v })} />
              <EditField label="Location" value={editedProject.location} onChange={(v) => setEditedProject({ ...editedProject, location: v })} />
              <div className="md:col-span-2">
                <EditField label="Complete Address" value={editedProject.address} onChange={(v) => setEditedProject({ ...editedProject, address: v })} isTextArea />
              </div>
              <div className="md:col-span-2">
                <EditField label="Google Maps Link" value={editedProject.mapLink} onChange={(v) => setEditedProject({ ...editedProject, mapLink: v })} />
              </div>
            </>
          ) : (
            <>
              <InfoField label="Contact Name" value={project.contactName} icon={User} />
              <InfoField label="Contact Number" value={project.contactNumber} icon={Phone} />
              <InfoField label="Email Address" value={project.email} icon={Mail} />
              <InfoField label="Location" value={project.location} icon={MapPin} />
              <div className="md:col-span-2">
                <InfoField label="Complete Address" value={project.address} icon={MapPin} />
              </div>
              <div className="md:col-span-2">
                <a href={project.mapLink} target="_blank" rel="noreferrer" className="text-blue-500 text-xs font-bold hover:underline flex items-center gap-1">
                  <MapPin size={12} /> View on Google Maps
                </a>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Technical Specifications */}
      <div className="bg-white p-6 rounded-2xl border border-n200 shadow-sm space-y-6">
        <div className="flex items-center justify-between border-b border-n100 pb-3">
          <h3 className="text-base font-brand font-bold flex items-center gap-2">
            <Zap className="text-shiroi-green" size={18} />
            Technical Specifications
          </h3>
          <div className="flex gap-2">
            {isEditingTech ? (
              <>
                <button onClick={handleSave} className="p-1.5 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-all">
                  <Check size={14} />
                </button>
                <button onClick={() => { setIsEditingTech(false); setEditedProject(project); }} className="p-1.5 bg-n200 text-n600 rounded-lg hover:bg-n300 transition-all">
                  <X size={14} />
                </button>
              </>
            ) : (
              <button onClick={() => setIsEditingTech(true)} className="p-1.5 hover:bg-n100 rounded-lg text-n400 hover:text-shiroi-green transition-all">
                <Edit2 size={14} />
              </button>
            )}
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {isEditingTech ? (
            <>
              <EditField label="System Size (kWp)" value={editedProject.systemSize.toString()} onChange={(v) => setEditedProject({ ...editedProject, systemSize: Number(v) })} type="number" />
              <EditField label="System Type" value={editedProject.systemType} onChange={(v) => setEditedProject({ ...editedProject, systemType: v as any })} isSelect options={['On Grid', 'Off Grid', 'Hybrid']} />
              <EditField label="Mounting Type" value={editedProject.mountingType} onChange={(v) => setEditedProject({ ...editedProject, mountingType: v as any })} isSelect options={['Low Raise', 'Elevated', 'Asbestos Shed', 'Metal Shed']} />
              <EditField label="Mounting Structure" value={editedProject.mountingStructure} onChange={(v) => setEditedProject({ ...editedProject, mountingStructure: v as any })} isSelect options={['GI', 'MS', 'Mini Rails', 'Long Rails', 'Customized']} />
              <EditField label="Inverter Make" value={editedProject.inverterMake || ''} onChange={(v) => setEditedProject({ ...editedProject, inverterMake: v })} />
              <EditField label="Panel Make" value={editedProject.panelMake || ''} onChange={(v) => setEditedProject({ ...editedProject, panelMake: v })} />
              <EditField label="Cable Make" value={editedProject.cableMake || ''} onChange={(v) => setEditedProject({ ...editedProject, cableMake: v })} />
              <EditField label="Scope of LA" value={editedProject.scopeLA} onChange={(v) => setEditedProject({ ...editedProject, scopeLA: v as any })} isSelect options={['Shiroi', 'Client']} />
              <div className="md:col-span-2">
                <EditField label="Remarks" value={editedProject.techRemarks || ''} onChange={(v) => setEditedProject({ ...editedProject, techRemarks: v })} isTextArea />
              </div>
            </>
          ) : (
            <>
              <InfoField label="System Size" value={`${project.systemSize} kWp`} icon={Zap} />
              <InfoField label="System Type" value={project.systemType} icon={Layers} />
              <InfoField label="Mounting Type" value={project.mountingType} icon={Layers} />
              <InfoField label="Mounting Structure" value={project.mountingStructure} icon={Layers} />
              <InfoField label="Inverter Make" value={project.inverterMake} icon={Settings} />
              <InfoField label="Panel Make" value={project.panelMake} icon={Layers} />
              <InfoField label="Cable Make" value={project.cableMake} icon={Zap} />
              <InfoField label="Scope of LA" value={project.scopeLA} icon={ShieldCheck} />
              <div className="md:col-span-2">
                <InfoField label="Remarks" value={project.techRemarks} icon={FileText} />
              </div>
            </>
          )}
        </div>
      </div>

      {/* Financial Overview */}
      <div className="lg:col-span-2 bg-white p-6 rounded-2xl border border-n200 shadow-sm space-y-6">
        <div className="flex items-center justify-between border-b border-n100 pb-3">
          <h3 className="text-base font-brand font-bold flex items-center gap-2">
            <DollarSign className="text-shiroi-green" size={18} />
            Financial Overview
          </h3>
          <div className="flex gap-2">
            {isEditingFinancial ? (
              <>
                <button onClick={handleSave} className="p-1.5 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-all">
                  <Check size={14} />
                </button>
                <button onClick={() => { setIsEditingFinancial(false); setEditedProject(project); }} className="p-1.5 bg-n200 text-n600 rounded-lg hover:bg-n300 transition-all">
                  <X size={14} />
                </button>
              </>
            ) : (
              <button onClick={() => setIsEditingFinancial(true)} className="p-1.5 hover:bg-n100 rounded-lg text-n400 hover:text-shiroi-green transition-all">
                <Edit2 size={14} />
              </button>
            )}
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
          <div className="p-4 bg-n050 rounded-xl border border-n100">
            <p className="text-[9px] font-brand font-bold text-n400 uppercase tracking-wider mb-1">Budget (Project Cost)</p>
            {isEditingFinancial ? (
              <input 
                type="number" 
                value={editedProject.budget} 
                onChange={(e) => setEditedProject({ ...editedProject, budget: Number(e.target.value) })}
                className="w-full bg-white border border-n200 rounded-lg px-2 py-1 text-sm font-bold focus:ring-2 focus:ring-shiroi-green outline-none"
              />
            ) : (
              <p className="text-lg font-brand font-bold text-n900">₹{project.budget.toLocaleString()}</p>
            )}
          </div>
          <div className="p-4 bg-n050 rounded-xl border border-n100">
            <p className="text-[9px] font-brand font-bold text-n400 uppercase tracking-wider mb-1">Considered Margin (%)</p>
            {isEditingFinancial ? (
              <input 
                type="number" 
                value={editedProject.consideredMargin} 
                onChange={(e) => setEditedProject({ ...editedProject, consideredMargin: Number(e.target.value) })}
                className="w-full bg-white border border-n200 rounded-lg px-2 py-1 text-sm font-bold focus:ring-2 focus:ring-shiroi-green outline-none"
              />
            ) : (
              <p className="text-lg font-brand font-bold text-n900">{project.consideredMargin}%</p>
            )}
          </div>
          <div className="p-4 bg-shiroi-green/5 rounded-xl border border-shiroi-green/10">
            <p className="text-[9px] font-brand font-bold text-shiroi-green uppercase tracking-wider mb-1">Actual Budget (Cost)</p>
            <p className="text-lg font-brand font-bold text-shiroi-green">₹{actualBudget.toLocaleString()}</p>
            <p className="text-[8px] text-shiroi-green/60 mt-1 font-medium">Auto-calculated from BOI + Expenses</p>
          </div>
          <div className="p-4 bg-green-50 rounded-xl border border-green-100">
            <p className="text-[9px] font-brand font-bold text-green-400 uppercase tracking-wider mb-1">Actual Margin (%)</p>
            <p className="text-lg font-brand font-bold text-green-900">{actualMargin.toFixed(2)}%</p>
            <p className="text-[8px] text-green-400 mt-1 font-medium">Auto-calculated from Cost vs Budget</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function EditField({ label, value, onChange, type = 'text', isTextArea = false, isSelect = false, options = [] }: any) {
  return (
    <div className="space-y-1.5">
      <label className="text-[10px] font-brand font-bold text-n400 uppercase tracking-wider">{label}</label>
      {isSelect ? (
        <select 
          value={value} 
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-3 py-2 bg-n050 border border-n200 rounded-lg text-xs font-semibold text-n700 focus:ring-2 focus:ring-shiroi-green focus:outline-none font-sans"
        >
          {options.map((opt: string) => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      ) : isTextArea ? (
        <textarea 
          value={value} 
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          className="w-full px-3 py-2 bg-n050 border border-n200 rounded-lg text-xs font-semibold text-n700 focus:ring-2 focus:ring-shiroi-green focus:outline-none resize-none font-sans"
        />
      ) : (
        <input 
          type={type} 
          value={value} 
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-3 py-2 bg-n050 border border-n200 rounded-lg text-xs font-semibold text-n700 focus:ring-2 focus:ring-shiroi-green focus:outline-none font-sans"
        />
      )}
    </div>
  );
}

function InfoField({ label, value, icon: Icon }: any) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-brand font-bold text-n400 uppercase tracking-wider flex items-center gap-1">
        <Icon size={12} /> {label}
      </p>
      <p className="text-sm font-semibold text-n700 font-sans">{value || 'Not specified'}</p>
    </div>
  );
}

function SiteSurveyTab({ project, allProjects, onUpdate }: { project: Project; allProjects: Project[]; onUpdate: (p: Project) => void }) {
  const [showSurveyForm, setShowSurveyForm] = useState(false);
  const [viewPdf, setViewPdf] = useState(false);

  const handleSurveySubmit = (surveyData: any) => {
    onUpdate({
      ...project,
      survey: {
        ...surveyData,
        submitted: true,
        submittedAt: new Date().toISOString()
      }
    });
    setShowSurveyForm(false);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-brand font-bold text-n900">Final Site Survey</h3>
        {!project.survey?.submitted && (
          <button 
            onClick={() => setShowSurveyForm(true)}
            className="p-2 bg-shiroi-green text-white rounded-full shadow-lg shadow-shiroi-green/30 hover:bg-shiroi-green/90 transition-all hover:scale-110 active:scale-95"
            title="Create New Survey"
          >
            <ClipboardCheck size={16} />
          </button>
        )}
      </div>

      <div className="bg-white p-4 rounded-2xl border border-n200 shadow-sm text-center space-y-2">
        {!project.survey?.submitted ? (
          <>
            <div className="w-10 h-10 bg-shiroi-green/10 text-shiroi-green rounded-full flex items-center justify-center mx-auto mb-1">
              <MapPin size={20} />
            </div>
            <h3 className="text-base font-brand font-bold text-n900">Solar Site Survey</h3>
            <p className="text-[10px] text-n500 max-w-md mx-auto font-sans">
              Conduct a detailed site survey to finalize mounting feasibility, shadow analysis, and equipment locations.
            </p>
            
            <div className="flex flex-wrap justify-center gap-2 pt-1">
              <button 
                onClick={() => setShowSurveyForm(true)}
                className="px-4 py-2 bg-shiroi-green text-white rounded-lg text-[10px] font-bold flex items-center gap-1.5 hover:bg-shiroi-green/90 transition-all shadow-lg shadow-shiroi-green/20 font-sans"
              >
                <Plus size={14} /> Create New Survey
              </button>
            </div>
          </>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between bg-green-50 p-2 rounded-xl border border-green-100">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 bg-green-500 text-white rounded-full flex items-center justify-center">
                  <CheckCircle2 size={14} />
                </div>
                <div className="text-left">
                  <h4 className="text-[10px] font-brand font-bold text-green-900">Survey Completed</h4>
                  <p className="text-[8px] text-green-600 font-medium uppercase tracking-tighter font-sans">Submitted on {new Date(project.survey.submittedAt!).toLocaleDateString()}</p>
                </div>
              </div>
              <div className="flex gap-1">
                <button 
                  onClick={() => setViewPdf(true)}
                  className="px-2.5 py-1 bg-n900 text-white rounded-lg text-[9px] font-bold flex items-center gap-1 hover:bg-n800 transition-all font-sans"
                >
                  <FileText size={10} /> View PDF
                </button>
                <button 
                  onClick={() => setViewPdf(true)}
                  className="p-1.5 bg-white border border-n200 text-n600 rounded-lg hover:bg-n050 transition-all"
                  title="Download PDF"
                >
                  <FileDown size={10} />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-left">
              <SummaryStat label="Roof Type" value={project.survey.roofType} />
              <SummaryStat label="Shadow Analysis" value={project.survey.shadowAnalysis ? 'Completed' : 'Pending'} />
              <SummaryStat label="Inverter Location" value={project.survey.inverterLocationFinalized ? 'Finalized' : 'Pending'} />
              <SummaryStat label="Mounting Feasibility" value={project.survey.mountingFeasibility ? 'Yes' : 'No'} />
            </div>
          </div>
        )}
      </div>

      {/* Survey Form Modal */}
      <AnimatePresence>
        {showSurveyForm && (
          <SurveyFormModal 
            project={project} 
            allProjects={allProjects}
            onClose={() => setShowSurveyForm(false)} 
            onSubmit={handleSurveySubmit} 
          />
        )}
        {viewPdf && (
          <PdfPreviewModal 
            title="Site Survey Report" 
            onClose={() => setViewPdf(false)} 
          >
            <div className="space-y-4 p-5 max-w-4xl mx-auto bg-white">
              <div className="flex justify-between items-start border-b-2 border-slate-900 pb-3">
                <div>
                  <h1 className="text-lg font-black uppercase tracking-tighter">Solar Site Survey Report</h1>
                  <p className="text-slate-500 font-bold text-[9px] uppercase tracking-widest mt-0.5">Shiroi Energy Private Limited</p>
                </div>
                <div className="text-right">
                  <p className="text-[8px] font-bold text-slate-400 uppercase">Project ID</p>
                  <p className="text-xs font-bold text-slate-900">{project.id}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-2">
                  <h2 className="text-[9px] font-black uppercase tracking-widest text-orange-500">Project Details</h2>
                  <PdfField label="Project Name" value={project.survey?.projectName || project.name} />
                  <PdfField label="Client Name" value={project.contactName} />
                  <PdfField label="System Size" value={`${project.survey?.systemSize || project.systemSize} kWp`} />
                  <PdfField label="Location" value={project.survey?.location?.address || project.location} />
                </div>
                <div className="space-y-2">
                  <h2 className="text-[9px] font-black uppercase tracking-widest text-orange-500">Survey Details</h2>
                  <PdfField label="Survey Date" value={new Date(project.survey?.submittedAt || '').toLocaleDateString()} />
                  <PdfField label="Roof Type" value={project.survey?.roofType || 'N/A'} />
                  <PdfField label="Shadow Analysis" value={project.survey?.shadowAnalysis ? 'Done' : 'Not Done'} />
                  {project.survey?.shadowSource && <PdfField label="Shadow Source" value={project.survey.shadowSource} />}
                </div>
              </div>

              <div className="space-y-2">
                <h2 className="text-[9px] font-black uppercase tracking-widest text-orange-500">Technical Feasibility & Equipment</h2>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  <PdfCheck label="Mounting Feasibility" checked={project.survey?.mountingFeasibility} />
                  <PdfCheck label="Inverter Location" checked={project.survey?.inverterLocationFinalized} />
                  <PdfCheck label="DC Cable Routing" checked={project.survey?.dcCableRoutingFinalized} />
                  <PdfCheck label="Earthing Pit" checked={project.survey?.earthingPitLocationFinalized} />
                  <PdfCheck label="LA Location" checked={project.survey?.laLocationFinalized} />
                  <PdfCheck label="Termination Point" checked={project.survey?.terminationPointFinalized} />
                  <PdfCheck label="Spare Feeder" checked={project.survey?.spareFeederAvailable} />
                  <PdfCheck label="DG/EB Interconnect" checked={project.survey?.dgEbInterconnection} />
                  <PdfCheck label="AC Cable Routing" checked={project.survey?.acCableRoutingFinalized} />
                </div>
              </div>

              {project.survey?.spareFeederRating && (
                <div className="space-y-1">
                  <PdfField label="Spare Feeder Rating" value={project.survey.spareFeederRating} />
                </div>
              )}

              {project.survey?.deviations && project.survey?.deviationDetails?.general && (
                <div className="space-y-1">
                  <h2 className="text-[9px] font-black uppercase tracking-widest text-orange-500">Deviations</h2>
                  <p className="text-[10px] font-bold text-slate-700">{project.survey.deviationDetails.general}</p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-8 pt-6 border-t border-slate-100">
                <div className="space-y-2">
                  <p className="text-[8px] font-bold text-slate-400 uppercase">Client Signature</p>
                  <div className="h-16 border border-slate-200 rounded-lg flex items-center justify-center italic text-slate-300">
                    {project.survey?.clientSignature ? <img src={project.survey.clientSignature} className="max-h-full" /> : 'Digitally Signed'}
                  </div>
                </div>
                <div className="space-y-2">
                  <p className="text-[8px] font-bold text-slate-400 uppercase">Engineer Signature</p>
                  <div className="h-16 border border-slate-200 rounded-lg flex items-center justify-center italic text-slate-300">
                    {project.survey?.engineerSignature ? <img src={project.survey.engineerSignature} className="max-h-full" /> : 'Digitally Signed'}
                  </div>
                </div>
              </div>
            </div>
          </PdfPreviewModal>
        )}
      </AnimatePresence>
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-brand font-bold text-n400 uppercase tracking-wider">{label}</p>
      <p className="text-sm font-bold text-n700 font-sans">{value}</p>
    </div>
  );
}

function PdfField({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-n100 pb-2">
      <p className="text-[9px] font-brand font-bold text-n400 uppercase tracking-wider mb-0.5">{label}</p>
      <p className="text-sm font-bold text-n900 font-sans">{value}</p>
    </div>
  );
}

function PdfCheck({ label, checked }: { label: string; checked: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <div className={`w-4 h-4 rounded border flex items-center justify-center ${checked ? 'bg-shiroi-green border-shiroi-green text-white' : 'border-n300'}`}>
        {checked && <Check size={10} strokeWidth={4} />}
      </div>
      <span className="text-xs font-bold text-n700 font-sans">{label}</span>
    </div>
  );
}

function PhotoUpload({ label, value, onChange }: { label: string; value?: string; onChange: (v: string) => void }) {
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        onChange(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className="space-y-1.5">
      <label className="text-[9px] font-brand font-bold text-n400 uppercase tracking-wider flex items-center gap-1.5">
        <Camera size={10} /> {label}
      </label>
      <div className="flex items-center gap-2">
        {value ? (
          <div className="relative w-16 h-16 rounded-lg overflow-hidden border border-n200 group">
            <img src={value} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
            <button 
              onClick={() => onChange('')}
              className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ) : (
          <label className="w-16 h-16 rounded-lg border-2 border-dashed border-n200 flex flex-col items-center justify-center text-n400 hover:border-shiroi-green hover:text-shiroi-green cursor-pointer transition-all">
            <Plus size={16} />
            <span className="text-[7px] font-brand font-bold uppercase mt-0.5">Upload</span>
            <input type="file" className="hidden" accept="image/*" onChange={handleFileChange} />
          </label>
        )}
      </div>
    </div>
  );
}

function SectionTitle({ title }: { title: string }) {
  return (
    <h4 className="text-[10px] font-brand font-black uppercase tracking-[0.2em] text-n900 border-l-4 border-shiroi-green pl-3 py-0.5 mb-4">
      {title}
    </h4>
  );
}

function SurveyFormModal({ project, allProjects, onClose, onSubmit }: any) {
  const [formData, setFormData] = useState(project.survey || {
    date: new Date().toISOString().split('T')[0],
    location: { lat: 0, lng: 0, address: '' },
    roofType: 'RCC',
    mountingFeasibility: true,
    shadowAnalysis: false,
    shadowSource: '',
    mountingProcedureExplained: false,
    fixingArrangementDiscussed: false,
    inverterLocationFinalized: false,
    dcCableRoutingFinalized: false,
    earthingPitLocationFinalized: false,
    laLocationFinalized: false,
    terminationPointFinalized: false,
    spareFeederAvailable: false,
    dgEbInterconnection: false,
    spareFeederRating: '',
    deviations: false,
    deviationDetails: {
      general: '',
      additionalPanels: '',
      additionalInverter: '',
      routingChanges: '',
      cableSizeChanges: '',
      otherRequests: ''
    }
  });

  const [selectedProjectId, setSelectedProjectId] = useState(project.id);
  const confirmedProjects = allProjects.filter((p: any) => p.status !== 'Lead');

  const handleProjectChange = (id: string) => {
    const selected = allProjects.find((p: any) => p.id === id);
    if (selected) {
      setSelectedProjectId(id);
      setFormData({
        ...formData,
        projectName: selected.name,
        systemSize: selected.systemSize
      });
    }
  };

  const clientSigRef = React.useRef<any>(null);
  const engineerSigRef = React.useRef<any>(null);

  const captureLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition((position) => {
        setFormData({
          ...formData,
          location: {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            address: `Lat: ${position.coords.latitude.toFixed(6)}, Lng: ${position.coords.longitude.toFixed(6)}`
          }
        });
      });
    }
  };

  const clearClientSig = () => clientSigRef.current?.clear();
  const clearEngineerSig = () => engineerSigRef.current?.clear();

  const handleFormSubmit = () => {
    const clientSig = clientSigRef.current?.isEmpty() ? null : clientSigRef.current?.getTrimmedCanvas().toDataURL('image/png');
    const engineerSig = engineerSigRef.current?.isEmpty() ? null : engineerSigRef.current?.getTrimmedCanvas().toDataURL('image/png');

    onSubmit({
      ...formData,
      clientSignature: clientSig,
      engineerSignature: engineerSig
    });
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="bg-white w-full max-w-5xl max-h-[95vh] overflow-hidden rounded-3xl shadow-2xl flex flex-col"
      >
        <div className="p-3 border-b border-slate-100 flex items-center justify-between bg-slate-50">
          <div>
            <h3 className="text-sm font-bold text-slate-900">Solar Site Survey Form</h3>
            <p className="text-[9px] font-bold text-orange-500 uppercase tracking-widest mt-0.5">{project.name} | {project.systemSize} kWp</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-white rounded-xl text-slate-400 transition-all">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {/* 1. Project Details */}
          <div className="space-y-3">
            <SectionTitle title="1. Project Details" />
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div className="space-y-1">
                <label className="text-[8px] font-bold text-slate-400 uppercase tracking-wider">Project Name</label>
                <select 
                  value={selectedProjectId}
                  onChange={(e) => handleProjectChange(e.target.value)}
                  className="w-full px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-[10px] font-bold text-slate-700 focus:ring-2 focus:ring-orange-500 outline-none"
                >
                  {confirmedProjects.map((p: any) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[8px] font-bold text-slate-400 uppercase tracking-wider">System Size (kWp)</label>
                <div className="px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-[10px] font-bold text-slate-700">
                  {allProjects.find((p: any) => p.id === selectedProjectId)?.systemSize || project.systemSize}
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-[8px] font-bold text-slate-400 uppercase tracking-wider">Survey Date</label>
                <input 
                  type="date" 
                  value={formData.date}
                  onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                  className="w-full px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-[10px] font-bold text-slate-700 focus:ring-2 focus:ring-orange-500 outline-none"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[8px] font-bold text-slate-400 uppercase tracking-wider">Survey Location</label>
                <div className="flex gap-1.5">
                  <input 
                    type="text" 
                    readOnly
                    value={formData.location.address}
                    placeholder="Capture GPS..."
                    className="flex-1 px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-[9px] font-bold text-slate-700 outline-none"
                  />
                  <button 
                    onClick={captureLocation}
                    className="p-1.5 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-all"
                  >
                    <MapPin size={14} />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* 2. Mounting & Site Feasibility */}
          <div className="space-y-3">
            <SectionTitle title="2. Mounting & Site Feasibility" />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              <div className="space-y-3">
                <CheckboxInput label="Mounting Feasibility Checked" checked={formData.mountingFeasibility} onChange={(v) => setFormData({ ...formData, mountingFeasibility: v })} />
                <div className="space-y-1.5">
                  <label className="text-[8px] font-bold text-slate-400 uppercase tracking-wider">Type of Roof</label>
                  <div className="grid grid-cols-2 gap-1">
                    {['RCC', 'Metal', 'Tile', 'Ground Mount'].map(type => (
                      <button 
                        key={type}
                        onClick={() => setFormData({ ...formData, roofType: type })}
                        className={`px-1.5 py-1 rounded-lg text-[9px] font-bold border transition-all ${
                          formData.roofType === type ? 'bg-shiroi-green border-shiroi-green text-white' : 'bg-white border-n200 text-n600 hover:border-shiroi-green'
                        }`}
                      >
                        {type}
                      </button>
                    ))}
                  </div>
                </div>
                <CheckboxInput label="Shadow Analysis Done" checked={formData.shadowAnalysis} onChange={(v) => setFormData({ ...formData, shadowAnalysis: v })} />
                {formData.shadowAnalysis && (
                  <div className="space-y-1">
                    <label className="text-[8px] font-bold text-n400 uppercase tracking-wider">Specify Source of Shadow</label>
                    <input 
                      type="text" 
                      value={formData.shadowSource}
                      onChange={(e) => setFormData({ ...formData, shadowSource: e.target.value })}
                      className="w-full px-2 py-1.5 bg-white border border-n200 rounded-lg text-[10px] font-bold text-n700 focus:ring-2 focus:ring-shiroi-green outline-none"
                    />
                  </div>
                )}
              </div>
              <div className="md:col-span-2 grid grid-cols-2 gap-3">
                <PhotoUpload label="Roof Condition Photo" value={formData.photos?.[0]} onChange={(v) => setFormData({ ...formData, photos: [v] })} />
                <PhotoUpload label="Shadow Area Photo" value={formData.photos?.[1]} onChange={(v) => {
                  const newPhotos = [...(formData.photos || [])];
                  newPhotos[1] = v;
                  setFormData({ ...formData, photos: newPhotos });
                }} />
              </div>
            </div>
          </div>

          {/* 3. Client Discussion & Approvals */}
          <div className="space-y-3">
            <SectionTitle title="3. Client Discussion & Approvals" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <CheckboxInput label="Mounting Procedure Explained (Drilling/Civil Work)" checked={formData.mountingProcedureExplained} onChange={(v) => setFormData({ ...formData, mountingProcedureExplained: v })} />
              <CheckboxInput label="Complete Fixing Arrangement Discussed with Client" checked={formData.fixingArrangementDiscussed} onChange={(v) => setFormData({ ...formData, fixingArrangementDiscussed: v })} />
            </div>
          </div>

          {/* 4. Equipment Location Finalization */}
          <div className="space-y-3">
            <SectionTitle title="4. Equipment Location Finalization" />
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
              <div className="space-y-2">
                <CheckboxInput label="Inverter Location Finalized" checked={formData.inverterLocationFinalized} onChange={(v) => setFormData({ ...formData, inverterLocationFinalized: v })} />
                <PhotoUpload label="Inverter Location Photo" value={formData.inverterLocationPhoto} onChange={(v) => setFormData({ ...formData, inverterLocationPhoto: v })} />
              </div>
              <div className="space-y-2">
                <CheckboxInput label="DC Cable Routing Finalized" checked={formData.dcCableRoutingFinalized} onChange={(v) => setFormData({ ...formData, dcCableRoutingFinalized: v })} />
                <PhotoUpload label="DC Cable Routing Photo" value={formData.dcCableRoutingPhoto} onChange={(v) => setFormData({ ...formData, dcCableRoutingPhoto: v })} />
              </div>
              <div className="space-y-2">
                <CheckboxInput label="Earthing Pit Location Finalized" checked={formData.earthingPitLocationFinalized} onChange={(v) => setFormData({ ...formData, earthingPitLocationFinalized: v })} />
                <PhotoUpload label="Earthing Pit Photo" value={formData.earthingPitLocationPhoto} onChange={(v) => setFormData({ ...formData, earthingPitLocationPhoto: v })} />
              </div>
              <div className="space-y-2">
                <CheckboxInput label="LA Location Finalized" checked={formData.laLocationFinalized} onChange={(v) => setFormData({ ...formData, laLocationFinalized: v })} />
                <PhotoUpload label="LA Location Photo" value={formData.laLocationPhoto} onChange={(v) => setFormData({ ...formData, laLocationPhoto: v })} />
              </div>
              <div className="space-y-2">
                <CheckboxInput label="Final Termination Point Finalized" checked={formData.terminationPointFinalized} onChange={(v) => setFormData({ ...formData, terminationPointFinalized: v })} />
                <PhotoUpload label="Termination Point Photo" value={formData.terminationPointPhoto} onChange={(v) => setFormData({ ...formData, terminationPointPhoto: v })} />
              </div>
              <div className="space-y-2">
                <CheckboxInput label="Spare Feeder Available" checked={formData.spareFeederAvailable} onChange={(v) => setFormData({ ...formData, spareFeederAvailable: v })} />
                <PhotoUpload label="Spare Feeder Photo" value={formData.spareFeederPhoto} onChange={(v) => setFormData({ ...formData, spareFeederPhoto: v })} />
              </div>
              <div className="space-y-2">
                <CheckboxInput label="DG / EB Interconnection" checked={formData.dgEbInterconnection} onChange={(v) => setFormData({ ...formData, dgEbInterconnection: v })} />
                <PhotoUpload label="DG / EB Photo" value={formData.dgEbInterconnectionPhoto} onChange={(v) => setFormData({ ...formData, dgEbInterconnectionPhoto: v })} />
              </div>
              <div className="space-y-2">
                <div className="space-y-1">
                  <label className="text-[8px] font-bold text-n400 uppercase tracking-wider">Spare Feeder Rating</label>
                  <input 
                  type="text" 
                  value={formData.spareFeederRating}
                  onChange={(e) => setFormData({ ...formData, spareFeederRating: e.target.value })}
                  className="w-full px-2 py-1.5 bg-white border border-n200 rounded-lg text-[10px] font-bold text-n700 focus:ring-2 focus:ring-shiroi-green outline-none"
                />
                </div>
                <PhotoUpload label="Rating Photo" value={formData.spareFeederRatingPhoto} onChange={(v) => setFormData({ ...formData, spareFeederRatingPhoto: v })} />
              </div>
            </div>
          </div>

          {/* 5. AC Routing */}
          <div className="space-y-3">
            <SectionTitle title="5. AC Routing" />
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
              <div className="space-y-2">
                <CheckboxInput label="AC Cable Routing Finalized" checked={formData.acCableRoutingFinalized || false} onChange={(v) => setFormData({ ...formData, acCableRoutingFinalized: v })} />
                <PhotoUpload label="AC Cable Routing Photo" value={formData.acCableRoutingPhoto} onChange={(v) => setFormData({ ...formData, acCableRoutingPhoto: v })} />
              </div>
            </div>
          </div>

          {/* 6. Deviations & Special Requirements */}
          <div className="space-y-3">
            <SectionTitle title="6. Deviations & Special Requirements" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[8px] font-bold text-n400 uppercase tracking-wider">Additional Panels Required?</label>
                <input 
                  type="text" 
                  value={formData.deviationDetails.additionalPanels}
                  onChange={(e) => setFormData({ ...formData, deviationDetails: { ...formData.deviationDetails, additionalPanels: e.target.value } })}
                  className="w-full px-2 py-1.5 bg-white border border-n200 rounded-lg text-[10px] font-bold text-n700 focus:ring-2 focus:ring-shiroi-green outline-none"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[8px] font-bold text-n400 uppercase tracking-wider">Additional Inverter Required?</label>
                <input 
                  type="text" 
                  value={formData.deviationDetails.additionalInverter}
                  onChange={(e) => setFormData({ ...formData, deviationDetails: { ...formData.deviationDetails, additionalInverter: e.target.value } })}
                  className="w-full px-2 py-1.5 bg-white border border-n200 rounded-lg text-[10px] font-bold text-n700 focus:ring-2 focus:ring-shiroi-green outline-none"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[8px] font-bold text-n400 uppercase tracking-wider">Routing Changes</label>
                <input 
                  type="text" 
                  value={formData.deviationDetails.routingChanges}
                  onChange={(e) => setFormData({ ...formData, deviationDetails: { ...formData.deviationDetails, routingChanges: e.target.value } })}
                  className="w-full px-2 py-1.5 bg-white border border-n200 rounded-lg text-[10px] font-bold text-n700 focus:ring-2 focus:ring-shiroi-green outline-none"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[8px] font-bold text-n400 uppercase tracking-wider">Cable Size Changes</label>
                <input 
                  type="text" 
                  value={formData.deviationDetails.cableSizeChanges}
                  onChange={(e) => setFormData({ ...formData, deviationDetails: { ...formData.deviationDetails, cableSizeChanges: e.target.value } })}
                  className="w-full px-2 py-1.5 bg-white border border-n200 rounded-lg text-[10px] font-bold text-n700 focus:ring-2 focus:ring-shiroi-green outline-none"
                />
              </div>
              <div className="md:col-span-2 space-y-1">
                <label className="text-[8px] font-bold text-n400 uppercase tracking-wider">Other Special Requests</label>
                <textarea 
                  value={formData.deviationDetails.otherRequests}
                  onChange={(e) => setFormData({ ...formData, deviationDetails: { ...formData.deviationDetails, otherRequests: e.target.value } })}
                  rows={2}
                  className="w-full px-2 py-1.5 bg-white border border-n200 rounded-lg text-[10px] font-bold text-n700 focus:ring-2 focus:ring-shiroi-green outline-none resize-none"
                />
              </div>
            </div>
          </div>

          {/* Sign-Off */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-6 border-t border-n100">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[8px] font-bold text-n400 uppercase tracking-wider flex items-center gap-2">
                  <PenTool size={10} /> Client Signature
                </label>
                <button onClick={clearClientSig} className="text-[8px] font-bold text-n400 hover:text-red-500 uppercase">Clear</button>
              </div>
              <div className="bg-n050 border-2 border-dashed border-n200 rounded-xl overflow-hidden">
                <SignatureCanvas 
                  ref={clientSigRef}
                  penColor="black"
                  canvasProps={{ className: "w-full h-20 cursor-crosshair" }}
                />
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[8px] font-bold text-n400 uppercase tracking-wider flex items-center gap-2">
                  <PenTool size={10} /> Engineer Signature
                </label>
                <button onClick={clearEngineerSig} className="text-[8px] font-bold text-n400 hover:text-red-500 uppercase">Clear</button>
              </div>
              <div className="bg-n050 border-2 border-dashed border-n200 rounded-xl overflow-hidden">
                <SignatureCanvas 
                  ref={engineerSigRef}
                  penColor="black"
                  canvasProps={{ className: "w-full h-20 cursor-crosshair" }}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-n100 bg-n050 flex justify-end gap-3">
          <button onClick={onClose} className="px-5 py-2 text-n600 font-bold hover:bg-white rounded-xl transition-all text-[10px]">
            Cancel
          </button>
          <button 
            onClick={handleFormSubmit}
            className="px-6 py-2 bg-shiroi-green text-white rounded-xl font-bold hover:bg-shiroi-green/90 transition-all shadow-lg shadow-shiroi-green/20 text-[10px]"
          >
            Submit Survey
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function CheckboxInput({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button 
      onClick={() => onChange(!checked)}
      className="flex items-center gap-3 group w-full text-left"
    >
      <div className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all ${
        checked ? 'bg-shiroi-green border-shiroi-green text-white' : 'border-n200 group-hover:border-shiroi-green'
      }`}>
        {checked && <Check size={14} strokeWidth={3} />}
      </div>
      <span className={`text-sm font-bold transition-colors ${checked ? 'text-n900' : 'text-n500 group-hover:text-n700'}`}>
        {label}
      </span>
    </button>
  );
}

function PdfPreviewModal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-n900/80 backdrop-blur-md">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-n100 w-full max-w-5xl h-[95vh] rounded-3xl shadow-2xl overflow-hidden flex flex-col"
      >
        <div className="p-4 bg-white border-b border-n200 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-red-50 text-red-500 rounded-lg">
              <FileText size={20} />
            </div>
            <h3 className="font-bold text-n900">{title}</h3>
          </div>
          <div className="flex items-center gap-2">
            <button className="p-2 hover:bg-n100 rounded-xl text-n600 flex items-center gap-2 text-xs font-bold">
              <Download size={16} /> Download PDF
            </button>
            <button className="p-2 hover:bg-n100 rounded-xl text-n600 flex items-center gap-2 text-xs font-bold">
              <Printer size={16} /> Print
            </button>
            <div className="w-px h-6 bg-n200 mx-2" />
            <button onClick={onClose} className="p-2 hover:bg-n100 rounded-xl text-n400 transition-all">
              <X size={20} />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-12 bg-n500/10">
          <div className="bg-white shadow-2xl mx-auto min-h-full">
            {children}
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function BOITab({ project, onUpdate }: { project: Project; onUpdate: (p: Project) => void }) {
  const [items, setItems] = useState<BOIItem[]>(project.boi || []);
  const [filter, setFilter] = useState('All');
  const [preparedBy, setPreparedBy] = useState(project.boiPreparedBy || '');
  const [showPdf, setShowPdf] = useState(false);

  const addItem = () => {
    const newItem: BOIItem = {
      id: Math.random().toString(36).substr(2, 9),
      category: 'Inverter',
      description: '',
      make: '',
      quantity: 1,
      unit: 'Nos',
      status: 'Yet to Finalize',
      rate: 0,
      gst: 18
    };
    setItems([...items, newItem]);
  };

  const updateItem = (id: string, updates: Partial<BOIItem>) => {
    const updatedItems = items.map(item => item.id === id ? { ...item, ...updates } : item);
    setItems(updatedItems);
  };

  const deleteItem = (id: string) => {
    const updatedItems = items.filter(item => item.id !== id);
    setItems(updatedItems);
  };

  const handleSave = () => {
    onUpdate({
      ...project,
      boi: items,
      boiPreparedBy: preparedBy
    });
  };

  const handleSubmit = () => {
    handleSave();
    setShowPdf(true);
  };

  const filteredItems = filter === 'All' ? items : items.filter(item => item.category === filter);
  const categories = ['All', ...BOI_CATEGORIES];

  return (
    <div className="bg-white p-6 rounded-2xl border border-n200 shadow-sm space-y-6">
      <div className="flex items-center justify-between border-b border-n100 pb-3">
        <div className="flex items-center gap-4">
          <h3 className="text-base font-brand font-bold flex items-center gap-2">
            <Truck className="text-shiroi-green" size={18} />
            Bill of Items (BOI)
          </h3>
          <div className="flex items-center gap-1 bg-n100 p-1 rounded-lg">
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setFilter(cat)}
                className={`px-2 py-1 text-[9px] font-brand font-bold uppercase rounded-md transition-all ${
                  filter === cat ? 'bg-white text-shiroi-green shadow-sm' : 'text-n500 hover:text-n700'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>
        <button 
          onClick={addItem}
          className="px-3 py-1.5 bg-n900 text-white rounded-xl text-xs font-brand font-bold flex items-center gap-1.5 hover:bg-n800 transition-colors"
        >
          <Plus size={14} /> Add Item
        </button>
      </div>

      <div className="overflow-x-auto -mx-6 px-6">
        <table className="w-full text-left border-collapse min-w-[600px]">
          <thead>
            <tr className="bg-n050 border-b border-n200">
              <th className="px-4 py-2.5 text-[10px] font-brand font-bold text-n500 uppercase tracking-wider">Category</th>
              <th className="px-4 py-2.5 text-[10px] font-brand font-bold text-n500 uppercase tracking-wider">Items / Description</th>
              <th className="px-4 py-2.5 text-[10px] font-brand font-bold text-n500 uppercase tracking-wider">Make</th>
              <th className="px-4 py-2.5 text-[10px] font-brand font-bold text-n500 uppercase tracking-wider w-20">Qty</th>
              <th className="px-4 py-2.5 text-[10px] font-brand font-bold text-n500 uppercase tracking-wider w-24">Unit</th>
              <th className="px-4 py-2.5 text-[10px] font-brand font-bold text-n500 uppercase tracking-wider w-20">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-n100">
            {filteredItems.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-n400 text-xs italic font-sans">
                  No items added yet. Click "Add Item" to start.
                </td>
              </tr>
            ) : (
              filteredItems.map((item) => (
                <tr key={item.id} className="group hover:bg-n050 transition-colors">
                  <td className="px-4 py-2.5">
                    <select 
                      value={item.category}
                      onChange={(e) => updateItem(item.id, { category: e.target.value })}
                      className="bg-transparent text-xs font-brand font-bold text-n700 focus:outline-none"
                    >
                      {BOI_CATEGORIES.map(cat => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-2.5">
                    <input 
                      type="text" 
                      value={item.description} 
                      onChange={(e) => updateItem(item.id, { description: e.target.value })}
                      className="bg-transparent text-xs text-n600 focus:outline-none w-full border-b border-transparent focus:border-shiroi-green font-sans" 
                      placeholder="Item description..." 
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    <input 
                      type="text" 
                      value={item.make} 
                      onChange={(e) => updateItem(item.id, { make: e.target.value })}
                      className="bg-transparent text-xs text-n600 focus:outline-none w-full border-b border-transparent focus:border-shiroi-green font-sans" 
                      placeholder="Brand/Make..." 
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    <input 
                      type="number" 
                      value={item.quantity} 
                      onChange={(e) => updateItem(item.id, { quantity: Number(e.target.value) })}
                      className="bg-transparent text-xs font-brand font-bold text-n900 focus:outline-none w-full border-b border-transparent focus:border-shiroi-green" 
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    <input 
                      type="text" 
                      value={item.unit} 
                      onChange={(e) => updateItem(item.id, { unit: e.target.value })}
                      className="bg-transparent text-xs text-n600 focus:outline-none w-full border-b border-transparent focus:border-shiroi-green font-sans" 
                      placeholder="Unit" 
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    <button onClick={() => deleteItem(item.id)} className="text-n400 hover:text-red-500 transition-colors">
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col md:flex-row items-end justify-between pt-6 border-t border-n100 gap-4">
        <div className="w-full md:w-64 space-y-2">
          <label className="text-[10px] font-brand font-bold text-n400 uppercase tracking-wider">Prepared By Engineer</label>
          <input 
            type="text" 
            value={preparedBy} 
            onChange={(e) => setPreparedBy(e.target.value)}
            placeholder="Engineer Name"
            className="w-full px-3 py-2 bg-n050 border border-n200 rounded-xl text-xs focus:ring-2 focus:ring-shiroi-green focus:outline-none font-brand font-bold"
          />
        </div>
        <div className="flex gap-3 w-full md:w-auto">
          <button 
            onClick={handleSave}
            className="px-5 py-2.5 bg-n100 text-n600 rounded-xl text-xs font-brand font-bold hover:bg-n200 transition-all flex-1 md:flex-none"
          >
            Save Draft
          </button>
          <button 
            onClick={handleSubmit}
            className="px-5 py-2.5 bg-shiroi-green text-white rounded-xl text-xs font-brand font-bold flex items-center gap-2 hover:bg-shiroi-green/90 transition-all shadow-lg shadow-shiroi-green/20 flex-1 md:flex-none justify-center"
          >
            <Send size={16} /> Submit to Purchase
          </button>
        </div>
      </div>

      <AnimatePresence>
        {showPdf && (
          <PdfPreviewModal title="Bill of Items (BOI)" onClose={() => setShowPdf(false)}>
            <div className="p-12 space-y-8 bg-white">
              <div className="flex justify-between items-start border-b-2 border-n900 pb-6">
                <div>
                  <h1 className="text-2xl font-display font-black uppercase tracking-tighter">Bill of Items</h1>
                  <p className="text-n500 font-brand font-bold text-xs uppercase tracking-widest mt-1">Shiroi Energy Private Limited</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-brand font-bold text-n400 uppercase">Project ID</p>
                  <p className="font-brand font-bold text-n900">{project.id}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-8">
                <div>
                  <p className="text-[9px] font-brand font-bold text-n400 uppercase mb-1">Client Details</p>
                  <p className="text-sm font-brand font-bold text-n900">{project.contactName}</p>
                  <p className="text-xs text-n500 font-sans">{project.location}</p>
                </div>
                <div className="text-right">
                  <p className="text-[9px] font-brand font-bold text-n400 uppercase mb-1">System Details</p>
                  <p className="text-sm font-brand font-bold text-n900">{project.systemSize} kWp {project.systemType}</p>
                  <p className="text-xs text-n500 font-sans">Date: {new Date().toLocaleDateString()}</p>
                </div>
              </div>

              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-n900 text-white">
                    <th className="px-4 py-2 text-[10px] font-brand font-bold uppercase">Category</th>
                    <th className="px-4 py-2 text-[10px] font-brand font-bold uppercase">Description</th>
                    <th className="px-4 py-2 text-[10px] font-brand font-bold uppercase">Make</th>
                    <th className="px-4 py-2 text-[10px] font-brand font-bold uppercase text-center">Qty</th>
                    <th className="px-4 py-2 text-[10px] font-brand font-bold uppercase">Unit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-n200 border-b border-n200">
                  {items.map((item, i) => (
                    <tr key={i}>
                      <td className="px-4 py-3 text-xs font-brand font-bold text-n900">{item.category}</td>
                      <td className="px-4 py-3 text-xs text-n600 font-sans">{item.description}</td>
                      <td className="px-4 py-3 text-xs text-n600 font-sans">{item.make}</td>
                      <td className="px-4 py-3 text-xs font-brand font-bold text-n900 text-center">{item.quantity}</td>
                      <td className="px-4 py-3 text-xs text-n600 font-sans">{item.unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="pt-12 flex justify-between items-end">
                <div className="space-y-4">
                  <p className="text-[10px] font-brand font-bold text-n400 uppercase">Prepared By</p>
                  <p className="text-sm font-brand font-bold text-n900 border-b border-n900 pb-1 px-4">{preparedBy}</p>
                </div>
                <div className="text-right space-y-4">
                  <p className="text-[10px] font-brand font-bold text-n400 uppercase">Authorized Signature</p>
                  <div className="h-12 w-48 border-b border-n900"></div>
                </div>
              </div>
            </div>
          </PdfPreviewModal>
        )}
      </AnimatePresence>
    </div>
  );
}

function BudgetAnalysisTab({ project, onUpdate }: { project: Project; onUpdate: (p: Project) => void }) {
  const [items, setItems] = useState<BOIItem[]>(project.boi || []);
  const [expenses, setExpenses] = useState<Expense[]>(project.expenses || [
    { id: 'e1', category: 'Others', description: 'Liasoning Charges', engineerName: '', voucherNo: '', amount: 0, status: 'Draft' },
    { id: 'e2', category: 'Transport', description: 'Transportation', engineerName: '', voucherNo: '', amount: 0, status: 'Draft' },
    { id: 'e3', category: 'Others', description: 'Labor Charges', engineerName: '', voucherNo: '', amount: 0, status: 'Draft' },
    { id: 'e4', category: 'Others', description: 'Miscellaneous', engineerName: '', voucherNo: '', amount: 0, status: 'Draft' },
  ]);
  const [filter, setFilter] = useState('All');
  const [showPdf, setShowPdf] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(project.boqBudgetAnalysisCompleted || false);

  const updateItem = (id: string, updates: Partial<BOIItem>) => {
    const updatedItems = items.map(item => {
      if (item.id === id) {
        const newItem = { ...item, ...updates };
        // Recalculate total if rate, quantity, or gst changes
        if (updates.rate !== undefined || updates.quantity !== undefined || updates.gst !== undefined) {
          const rate = updates.rate ?? item.rate;
          const qty = updates.quantity ?? item.quantity;
          const gst = updates.gst ?? item.gst;
          newItem.total = rate * qty * (1 + (gst || 0) / 100);
        }
        return newItem;
      }
      return item;
    });
    setItems(updatedItems);
  };

  const addItem = () => {
    const newItem: BOIItem = {
      id: Math.random().toString(36).substr(2, 9),
      category: 'Others',
      description: '',
      make: '',
      quantity: 1,
      unit: 'Nos',
      status: 'Yet to Finalize',
      rate: 0,
      gst: 18,
      total: 0
    };
    setItems([...items, newItem]);
  };

  const deleteItem = (id: string) => {
    setItems(items.filter(item => item.id !== id));
  };

  const updateExpense = (id: string, updates: Partial<Expense>) => {
    const updatedExpenses = expenses.map(exp => exp.id === id ? { ...exp, ...updates } : exp);
    setExpenses(updatedExpenses);
  };

  const handleSave = () => {
    onUpdate({
      ...project,
      boi: items,
      expenses: expenses,
      boqBudgetAnalysisCompleted: isSubmitted
    });
  };

  const boiTotal = items.reduce((sum, item) => sum + (item.total || 0), 0);
  const expenseTotal = expenses.reduce((sum, exp) => sum + (exp.amount || 0), 0);
  const actualBudget = boiTotal + expenseTotal;
  const projectCost = project.budget || 0;
  const expectedMargin = projectCost > 0 ? ((projectCost - actualBudget) / projectCost) * 100 : 0;

  const filteredItems = filter === 'All' ? items : items.filter(item => item.category === filter);
  const categories = ['All', ...BOI_CATEGORIES];

  return (
    <div className="space-y-6">
      <div className="bg-white p-6 rounded-2xl border border-n200 shadow-sm space-y-6">
        <div className="flex items-center justify-between border-b border-n100 pb-3">
          <div className="flex items-center gap-4">
            <h3 className="text-base font-bold flex items-center gap-2">
              <BarChart3 className="text-shiroi-green" size={18} />
              BOQ Budget Analysis
            </h3>
            <div className="flex items-center gap-1 bg-n100 p-1 rounded-lg">
              {categories.map(cat => (
                <button
                  key={cat}
                  onClick={() => setFilter(cat)}
                  className={`px-2 py-1 text-[9px] font-bold uppercase rounded-md transition-all ${
                    filter === cat ? 'bg-white text-shiroi-green shadow-sm' : 'text-n500 hover:text-n700'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button 
              onClick={addItem}
              className="px-3 py-1.5 bg-n900 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 hover:bg-n800 transition-colors"
            >
              <Plus size={14} /> Add Item
            </button>
            <button 
              onClick={() => setShowPdf(true)}
              className="px-3 py-1.5 bg-n100 text-n600 rounded-xl text-xs font-bold flex items-center gap-1.5 hover:bg-n200 transition-colors"
            >
              <FileText size={14} /> View PDF
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[1000px]">
            <thead>
              <tr className="bg-n050 border-b border-n200">
                <th className="px-3 py-2.5 text-[10px] font-bold text-n500 uppercase tracking-wider">Category</th>
                <th className="px-3 py-2.5 text-[10px] font-bold text-n500 uppercase tracking-wider">Items</th>
                <th className="px-3 py-2.5 text-[10px] font-bold text-n500 uppercase tracking-wider">Make</th>
                <th className="px-3 py-2.5 text-[10px] font-bold text-n500 uppercase tracking-wider w-16">Qty</th>
                <th className="px-3 py-2.5 text-[10px] font-bold text-n500 uppercase tracking-wider w-32">Status</th>
                <th className="px-3 py-2.5 text-[10px] font-bold text-n500 uppercase tracking-wider w-24">Rate</th>
                <th className="px-3 py-2.5 text-[10px] font-bold text-n500 uppercase tracking-wider w-16">GST%</th>
                <th className="px-3 py-2.5 text-[10px] font-bold text-n500 uppercase tracking-wider w-28">Total</th>
                <th className="px-3 py-2.5 text-[10px] font-bold text-n500 uppercase tracking-wider w-12"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-n100">
              {filteredItems.map((item) => (
                <tr key={item.id} className="group hover:bg-n050 transition-colors">
                  <td className="px-3 py-2">
                    <select 
                      value={item.category}
                      onChange={(e) => updateItem(item.id, { category: e.target.value })}
                      className="bg-transparent text-[11px] font-semibold text-n700 focus:outline-none"
                    >
                      {BOI_CATEGORIES.map(cat => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input 
                      type="text" 
                      value={item.description} 
                      onChange={(e) => updateItem(item.id, { description: e.target.value })}
                      className="bg-transparent text-[11px] text-n600 focus:outline-none w-full border-b border-transparent focus:border-shiroi-green" 
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input 
                      type="text" 
                      value={item.make} 
                      onChange={(e) => updateItem(item.id, { make: e.target.value })}
                      className="bg-transparent text-[11px] text-n600 focus:outline-none w-full border-b border-transparent focus:border-shiroi-green" 
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input 
                      type="number" 
                      value={item.quantity} 
                      onChange={(e) => updateItem(item.id, { quantity: Number(e.target.value) })}
                      className="bg-transparent text-[11px] font-bold text-n900 focus:outline-none w-full" 
                    />
                  </td>
                  <td className="px-3 py-2">
                    <select 
                      value={item.status}
                      onChange={(e) => updateItem(item.id, { status: e.target.value as BOIStatus })}
                      className="bg-transparent text-[11px] font-bold text-n700 focus:outline-none w-full"
                    >
                      {BOI_STATUSES.map(status => (
                        <option key={status} value={status}>{status}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input 
                      type="number" 
                      value={item.rate} 
                      onChange={(e) => updateItem(item.id, { rate: Number(e.target.value) })}
                      className="bg-transparent text-[11px] font-bold text-n900 focus:outline-none w-full" 
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input 
                      type="number" 
                      value={item.gst} 
                      onChange={(e) => updateItem(item.id, { gst: Number(e.target.value) })}
                      className="bg-transparent text-[11px] text-n600 focus:outline-none w-full" 
                    />
                  </td>
                  <td className="px-3 py-2">
                    <span className="text-[11px] font-bold text-n900">₹{item.total?.toLocaleString()}</span>
                  </td>
                  <td className="px-3 py-2">
                    <button onClick={() => deleteItem(item.id)} className="text-n300 hover:text-red-500 transition-colors">
                      <Trash2 size={12} />
                    </button>
                  </td>
                </tr>
              ))}
              <tr className="bg-n050 font-bold">
                <td colSpan={7} className="px-3 py-3 text-[11px] text-n500 text-right uppercase tracking-wider">Total BOI Value</td>
                <td className="px-3 py-3 text-[11px] text-shiroi-green">₹{boiTotal.toLocaleString()}</td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="space-y-4 pt-6 border-t border-n100">
          <h4 className="text-[10px] font-bold text-n400 uppercase tracking-wider">Project Expenses</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {expenses.map((exp) => (
              <div key={exp.id} className="p-3 bg-n050 rounded-xl border border-n200 space-y-2">
                <p className="text-[10px] font-bold text-n500 uppercase">{exp.description}</p>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-n400">₹</span>
                  <input 
                    type="number" 
                    value={exp.amount} 
                    onChange={(e) => updateExpense(exp.id, { amount: Number(e.target.value) })}
                    className="bg-transparent text-xs font-bold text-n900 focus:outline-none w-full"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="pt-8 border-t border-n100">
          <div className="bg-n900 rounded-2xl p-6 text-white">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <div className="space-y-1">
                <p className="text-[10px] font-bold text-n400 uppercase tracking-widest">Project Cost</p>
                <p className="text-2xl font-black">₹{projectCost.toLocaleString()}</p>
              </div>
              <div className="space-y-1">
                <p className="text-[10px] font-bold text-n400 uppercase tracking-widest">Actual Budget (BOI + Exp)</p>
                <p className="text-2xl font-black text-shiroi-green">₹{actualBudget.toLocaleString()}</p>
              </div>
              <div className="space-y-1">
                <p className="text-[10px] font-bold text-n400 uppercase tracking-widest">Final Expected Margin</p>
                <div className="flex items-center gap-3">
                  <p className="text-2xl font-black text-green-400">{expectedMargin.toFixed(2)}%</p>
                  <div className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${expectedMargin > 20 ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'}`}>
                    {expectedMargin > 20 ? 'Good' : 'Review'}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between pt-6">
          <label className="flex items-center gap-3 cursor-pointer group">
            <div 
              onClick={() => setIsSubmitted(!isSubmitted)}
              className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all ${
                isSubmitted ? 'bg-green-500 border-green-500 text-white' : 'border-n200 group-hover:border-green-500'
              }`}
            >
              {isSubmitted && <Check size={14} strokeWidth={3} />}
            </div>
            <span className={`text-xs font-bold ${isSubmitted ? 'text-n900' : 'text-n500'}`}>
              BOQ Budget Analysis Submitted
            </span>
          </label>
          <div className="flex gap-3">
            <button 
              onClick={handleSave}
              className="px-6 py-2 bg-shiroi-green text-white rounded-xl text-xs font-bold hover:bg-shiroi-green/90 transition-all shadow-lg shadow-shiroi-green/20"
            >
              Save Analysis
            </button>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {showPdf && (
          <PdfPreviewModal title="BOQ Budget Analysis Report" onClose={() => setShowPdf(false)}>
            <div className="p-12 space-y-10 bg-white">
              <div className="flex justify-between items-start border-b-4 border-n900 pb-8">
                <div>
                  <h1 className="text-3xl font-black uppercase tracking-tighter">Budget Analysis</h1>
                  <p className="text-n500 font-bold text-sm uppercase tracking-widest mt-1">Shiroi Energy Private Limited</p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-bold text-n400 uppercase">Project Reference</p>
                  <p className="text-lg font-black text-n900">{project.id}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-12">
                <div className="space-y-4">
                  <h4 className="text-xs font-bold text-n400 uppercase border-b border-n100 pb-2">Project Details</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-[10px] text-n400 uppercase">Client</p>
                      <p className="text-sm font-bold">{project.contactName}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-n400 uppercase">Capacity</p>
                      <p className="text-sm font-bold">{project.systemSize} kWp</p>
                    </div>
                    <div className="col-span-2">
                      <p className="text-[10px] text-n400 uppercase">Location</p>
                      <p className="text-sm font-bold">{project.location}</p>
                    </div>
                  </div>
                </div>
                <div className="space-y-4">
                  <h4 className="text-xs font-bold text-n400 uppercase border-b border-n100 pb-2">Financial Summary</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-[10px] text-n400 uppercase">Project Value</p>
                      <p className="text-sm font-bold">₹{projectCost.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-n400 uppercase">Actual Budget</p>
                      <p className="text-sm font-bold">₹{actualBudget.toLocaleString()}</p>
                    </div>
                    <div className="col-span-2">
                      <p className="text-[10px] text-n400 uppercase">Expected Margin</p>
                      <p className="text-lg font-black text-green-600">{expectedMargin.toFixed(2)}%</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <h4 className="text-xs font-bold text-n900 uppercase">Bill of Items Breakdown</h4>
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-n900 text-white">
                      <th className="px-4 py-2 text-[10px] font-bold uppercase">Category</th>
                      <th className="px-4 py-2 text-[10px] font-bold uppercase">Item</th>
                      <th className="px-4 py-2 text-[10px] font-bold uppercase">Make</th>
                      <th className="px-4 py-2 text-[10px] font-bold uppercase text-center">Qty</th>
                      <th className="px-4 py-2 text-[10px] font-bold uppercase text-right">Rate</th>
                      <th className="px-4 py-2 text-[10px] font-bold uppercase text-right">Total (incl. GST)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-n200 border-b border-n200">
                    {items.map((item, i) => (
                      <tr key={i}>
                        <td className="px-4 py-3 text-[11px] font-bold text-n900">{item.category}</td>
                        <td className="px-4 py-3 text-[11px] text-n600">{item.description}</td>
                        <td className="px-4 py-3 text-[11px] text-n600">{item.make}</td>
                        <td className="px-4 py-3 text-[11px] text-n900 text-center">{item.quantity}</td>
                        <td className="px-4 py-3 text-[11px] text-n900 text-right">₹{item.rate.toLocaleString()}</td>
                        <td className="px-4 py-3 text-[11px] font-bold text-n900 text-right">₹{item.total?.toLocaleString()}</td>
                      </tr>
                    ))}
                    <tr className="bg-n050 font-bold">
                      <td colSpan={5} className="px-4 py-3 text-[11px] text-right uppercase">BOI Subtotal</td>
                      <td className="px-4 py-3 text-[11px] text-right">₹{boiTotal.toLocaleString()}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="space-y-4">
                <h4 className="text-xs font-bold text-n900 uppercase">Other Project Expenses</h4>
                <div className="grid grid-cols-2 gap-4">
                  {expenses.map(exp => (
                    <div key={exp.id} className="flex justify-between items-center p-3 border border-n100 rounded-lg">
                      <span className="text-[11px] font-bold text-n500 uppercase">{exp.description}</span>
                      <span className="text-[11px] font-bold text-n900">₹{exp.amount.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="pt-12 border-t-2 border-n900 flex justify-between items-end">
                <div className="space-y-6">
                  <div className="space-y-1">
                    <p className="text-[10px] font-bold text-n400 uppercase">Analysis Prepared By</p>
                    <p className="text-sm font-bold text-n900">{project.boiPreparedBy || 'Project Engineer'}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] font-bold text-n400 uppercase">Submission Date</p>
                    <p className="text-sm font-bold text-n900">{new Date().toLocaleDateString()}</p>
                  </div>
                </div>
                <div className="text-right space-y-4">
                  <p className="text-[10px] font-bold text-n400 uppercase">Management Approval</p>
                  <div className="h-16 w-64 border-2 border-dashed border-n200 rounded-xl flex items-center justify-center">
                    <span className="text-[10px] text-n300 font-bold uppercase">Stamp & Signature</span>
                  </div>
                </div>
              </div>
            </div>
          </PdfPreviewModal>
        )}
      </AnimatePresence>
    </div>
  );
}

function DeliveryNoteTab({ project, onUpdate }: { project: Project; onUpdate: (p: Project) => void }) {
  const [showDcForm, setShowDcForm] = useState(false);
  const [viewPdf, setViewPdf] = useState<string | null>(null);

  const readyToDispatchItems = (project.boi || []).filter(item => item.status === 'Ready to Dispatch');

  const handleCreateDc = (dcData: any) => {
    const newDc: Delivery = {
      id: `DC-${(project.deliveries?.length || 0) + 1}`,
      dcNumber: `DC/${project.id}/${(project.deliveries?.length || 0) + 1}`,
      date: new Date().toISOString(),
      items: dcData.items,
      receiverName: dcData.receivedBy || 'Client',
      clientSignature: dcData.clientSignature,
      engineerSignature: dcData.engineerSignature,
      receivedBy: dcData.receivedBy
    };

    // Update BOI items status to 'Delivered'
    const updatedBoi = (project.boi || []).map(item => {
      if (dcData.items.find((dcItem: any) => dcItem.id === item.id)) {
        return { ...item, status: 'Delivered' as BOIStatus };
      }
      return item;
    });

    onUpdate({
      ...project,
      deliveries: [...(project.deliveries || []), newDc],
      boi: updatedBoi
    });
    setShowDcForm(false);
  };

  return (
    <div className="space-y-6">
      <div className="bg-white p-8 rounded-2xl border border-n200 shadow-sm text-center space-y-4">
        <div className="w-16 h-16 bg-shiroi-green/10 text-shiroi-green rounded-full flex items-center justify-center mx-auto mb-2">
          <Truck size={32} />
        </div>
        <h3 className="text-xl font-bold text-n900">Delivery Notes (DC)</h3>
        <p className="text-sm text-n500 max-w-md mx-auto">
          Create delivery challans for items ready for dispatch. Track multiple deliveries and capture digital signatures.
        </p>
        
        <div className="flex flex-wrap justify-center gap-4 pt-4">
          <button 
            onClick={() => setShowDcForm(true)}
            disabled={readyToDispatchItems.length === 0}
            className={`px-6 py-3 rounded-xl font-bold flex items-center gap-2 transition-all shadow-lg ${
              readyToDispatchItems.length > 0 
                ? 'bg-shiroi-green text-white hover:bg-shiroi-green/90 shadow-shiroi-green/20' 
                : 'bg-n100 text-n400 cursor-not-allowed shadow-none'
            }`}
          >
            <Plus size={18} /> Create New DC
          </button>
          {readyToDispatchItems.length === 0 && (
            <p className="text-[10px] font-bold text-solar-yellow uppercase w-full">
              No items marked as "Ready to Dispatch" in BOQ
            </p>
          )}
        </div>
      </div>

      {project.deliveries && project.deliveries.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {project.deliveries.map((dc) => (
            <div key={dc.id} className="bg-white p-6 rounded-2xl border border-n200 shadow-sm hover:border-shiroi-green transition-all group">
              <div className="flex justify-between items-start mb-4">
                <div className="p-2 bg-shiroi-green/10 text-shiroi-green rounded-lg">
                  <FileText size={20} />
                </div>
                <span className="text-[10px] font-bold text-n400 uppercase">{new Date(dc.date).toLocaleDateString()}</span>
              </div>
              <h4 className="font-bold text-n900 mb-1">{dc.dcNumber}</h4>
              <p className="text-xs text-n500 mb-4">{dc.items.length} items included</p>
              <button 
                onClick={() => setViewPdf(dc.id)}
                className="w-full py-2 bg-n100 text-n600 rounded-xl text-xs font-bold hover:bg-shiroi-green hover:text-white transition-all"
              >
                View Delivery Note
              </button>
            </div>
          ))}
        </div>
      )}

      <AnimatePresence>
        {showDcForm && (
          <DcFormModal 
            items={readyToDispatchItems} 
            onClose={() => setShowDcForm(false)} 
            onSubmit={handleCreateDc} 
          />
        )}
        {viewPdf && (
          <PdfPreviewModal 
            title="Delivery Challan" 
            onClose={() => setViewPdf(null)} 
          >
            {(() => {
              const dc = project.deliveries?.find(d => d.id === viewPdf);
              if (!dc) return null;
              return (
                <div className="p-12 space-y-8 bg-white">
                  <div className="flex justify-between items-start border-b-2 border-n900 pb-6">
                    <div>
                      <h1 className="text-2xl font-black uppercase tracking-tighter">Delivery Challan</h1>
                      <p className="text-n500 font-bold text-xs uppercase tracking-widest mt-1">Shiroi Energy Private Limited</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] font-bold text-n400 uppercase">DC Number</p>
                      <p className="font-bold text-n900">{dc.dcNumber}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-8">
                    <div>
                      <p className="text-[9px] font-bold text-n400 uppercase mb-1">Consignee</p>
                      <p className="text-sm font-bold text-n900">{project.contactName}</p>
                      <p className="text-xs text-n500">{project.address}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[9px] font-bold text-n400 uppercase mb-1">Project Details</p>
                      <p className="text-sm font-bold text-n900">{project.name}</p>
                      <p className="text-xs text-n500">Date: {new Date(dc.date).toLocaleDateString()}</p>
                    </div>
                  </div>

                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-n900 text-white">
                        <th className="px-4 py-2 text-[10px] font-bold uppercase">Sl No</th>
                        <th className="px-4 py-2 text-[10px] font-bold uppercase">Description of Goods</th>
                        <th className="px-4 py-2 text-[10px] font-bold uppercase text-center">Qty</th>
                        <th className="px-4 py-2 text-[10px] font-bold uppercase">Unit</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-n200 border-b border-n200">
                      {dc.items.map((item, i) => (
                        <tr key={i}>
                          <td className="px-4 py-3 text-xs text-n600">{i + 1}</td>
                          <td className="px-4 py-3 text-xs font-bold text-n900">{item.description}</td>
                          <td className="px-4 py-3 text-xs font-bold text-n900 text-center">{item.quantity}</td>
                          <td className="px-4 py-3 text-xs text-n600">{item.unit}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <div className="grid grid-cols-2 gap-12 pt-12">
                    <div className="space-y-4">
                      <p className="text-[10px] font-bold text-n400 uppercase">Receiver's Signature</p>
                      <div className="h-24 border border-n200 rounded-lg flex items-center justify-center italic text-n300">
                        {dc.clientSignature ? <img src={dc.clientSignature} className="max-h-full" /> : 'Signed on Delivery'}
                      </div>
                      <p className="text-[10px] font-bold text-n900 uppercase text-center">Received By: {dc.receivedBy || 'N/A'}</p>
                    </div>
                    <div className="text-right space-y-4">
                      <p className="text-[10px] font-bold text-n400 uppercase">For Shiroi Energy Private Limited</p>
                      <div className="h-24 border border-n200 rounded-lg flex items-center justify-center italic text-n300">
                        {dc.engineerSignature ? <img src={dc.engineerSignature} className="max-h-full" /> : 'Authorized Signatory'}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}
          </PdfPreviewModal>
        )}
      </AnimatePresence>
    </div>
  );
}

function DcFormModal({ items, onClose, onSubmit }: any) {
  const [selectedItems, setSelectedItems] = useState(items.map((i: any) => i.id));
  const [receivedBy, setReceivedBy] = useState('');

  const clientSigRef = React.useRef<any>(null);
  const engineerSigRef = React.useRef<any>(null);

  const clearClientSig = () => clientSigRef.current?.clear();
  const clearEngineerSig = () => engineerSigRef.current?.clear();

  const toggleItem = (id: string) => {
    if (selectedItems.includes(id)) {
      setSelectedItems(selectedItems.filter((i: string) => i !== id));
    } else {
      setSelectedItems([...selectedItems, id]);
    }
  };

  const handleFormSubmit = () => {
    const dcItems = items.filter((i: any) => selectedItems.includes(i.id));
    const clientSig = clientSigRef.current?.isEmpty() ? null : clientSigRef.current?.getTrimmedCanvas().toDataURL('image/png');
    const engineerSig = engineerSigRef.current?.isEmpty() ? null : engineerSigRef.current?.getTrimmedCanvas().toDataURL('image/png');

    onSubmit({
      items: dcItems,
      receivedBy,
      clientSignature: clientSig,
      engineerSignature: engineerSig
    });
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-n900/60 backdrop-blur-sm">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="bg-white w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-3xl shadow-2xl flex flex-col"
      >
        <div className="p-6 border-b border-n100 flex items-center justify-between bg-n050">
          <h3 className="text-xl font-bold text-n900">Create Delivery Challan</h3>
          <button onClick={onClose} className="p-2 hover:bg-n100 rounded-xl text-n400 transition-all">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-8 space-y-6">
          <div className="space-y-4">
            <label className="text-[10px] font-bold text-n400 uppercase tracking-wider">Select Items for this DC</label>
            <div className="space-y-2">
              {items.map((item: any) => (
                <button 
                  key={item.id}
                  onClick={() => toggleItem(item.id)}
                  className={`w-full p-4 rounded-2xl border-2 transition-all flex items-center justify-between ${
                    selectedItems.includes(item.id) ? 'bg-shiroi-green/10 border-shiroi-green' : 'bg-white border-n100 hover:border-shiroi-green/30'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-5 h-5 rounded border flex items-center justify-center ${
                      selectedItems.includes(item.id) ? 'bg-shiroi-green border-shiroi-green text-white' : 'border-n300'
                    }`}>
                      {selectedItems.includes(item.id) && <Check size={12} strokeWidth={4} />}
                    </div>
                    <div className="text-left">
                      <p className="text-xs font-bold text-n900">{item.description}</p>
                      <p className="text-[10px] text-n500">{item.category} | {item.make}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-black text-shiroi-green">{item.quantity} {item.unit}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-bold text-n400 uppercase tracking-wider">Received By (Name)</label>
            <input 
              type="text" 
              value={receivedBy}
              onChange={(e) => setReceivedBy(e.target.value)}
              placeholder="Enter receiver's name..."
              className="w-full px-4 py-3 bg-n050 border border-n200 rounded-2xl text-sm focus:ring-2 focus:ring-shiroi-green outline-none font-bold"
            />
          </div>

          <div className="grid grid-cols-2 gap-6 pt-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-bold text-n400 uppercase tracking-wider">Client Signature</label>
                <button onClick={clearClientSig} className="text-[9px] font-bold text-n400 hover:text-red-500 uppercase">Clear</button>
              </div>
              <div className="bg-n050 border-2 border-dashed border-n200 rounded-2xl overflow-hidden">
                <SignatureCanvas 
                  ref={clientSigRef}
                  penColor="black"
                  canvasProps={{ className: "w-full h-24 cursor-crosshair" }}
                />
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-bold text-n400 uppercase tracking-wider">Engineer Signature</label>
                <button onClick={clearEngineerSig} className="text-[9px] font-bold text-n400 hover:text-red-500 uppercase">Clear</button>
              </div>
              <div className="bg-n050 border-2 border-dashed border-n200 rounded-2xl overflow-hidden">
                <SignatureCanvas 
                  ref={engineerSigRef}
                  penColor="black"
                  canvasProps={{ className: "w-full h-24 cursor-crosshair" }}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="p-6 border-t border-n100 bg-n050 flex justify-end gap-3">
          <button onClick={onClose} className="px-6 py-2.5 text-n600 font-bold hover:bg-n100 rounded-xl transition-all">
            Cancel
          </button>
          <button 
            onClick={handleFormSubmit}
            disabled={selectedItems.length === 0}
            className="px-8 py-2.5 bg-shiroi-green text-white rounded-xl font-bold hover:bg-shiroi-green/90 transition-all shadow-lg shadow-shiroi-green/20 disabled:opacity-50 disabled:shadow-none"
          >
            Generate DC
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function ExecutionTab({ project, onUpdate }: any) {
  const [isAddingTask, setIsAddingTask] = useState(false);
  const [newTask, setNewTask] = useState<Partial<ExecutionTask>>({
    category: EXECUTION_MILESTONES[0],
    title: '',
    status: 'Open',
    assignedTo: '',
    assignedDate: '',
    actionDate: '',
    doneBy: '',
    remarks: ''
  });

  const [selectedTaskForLogs, setSelectedTaskForLogs] = useState<number | null>(null);
  const [newLog, setNewLog] = useState({ activity: '', doneBy: '', remarks: '' });

  const tasks: ExecutionTask[] = project.execution || EXECUTION_MILESTONES.map((category, i) => ({
    id: `task-${i}`,
    category,
    title: category,
    status: 'Open',
    remarks: '',
    dailyLogs: []
  }));

  const handleAddTask = () => {
    if (!newTask.title) return;
    const task: ExecutionTask = {
      id: Math.random().toString(36).substr(2, 9),
      category: newTask.category || EXECUTION_MILESTONES[0],
      title: newTask.title,
      status: newTask.status as any || 'Open',
      assignedTo: newTask.assignedTo,
      assignedDate: newTask.assignedDate,
      actionDate: newTask.actionDate,
      doneBy: newTask.doneBy,
      remarks: newTask.remarks,
      dailyLogs: []
    };
    onUpdate({ ...project, execution: [...tasks, task] });
    setIsAddingTask(false);
    setNewTask({
      category: EXECUTION_MILESTONES[0],
      title: '',
      status: 'Open',
      assignedTo: '',
      assignedDate: '',
      actionDate: '',
      doneBy: '',
      remarks: ''
    });
  };

  const deleteTask = (index: number) => {
    const updatedTasks = tasks.filter((_, i) => i !== index);
    onUpdate({ ...project, execution: updatedTasks });
  };

  const updateTask = (index: number, field: keyof ExecutionTask, value: any) => {
    const updatedTasks = [...tasks];
    updatedTasks[index] = { ...updatedTasks[index], [field]: value };
    onUpdate({ ...project, execution: updatedTasks });
  };

  const addDailyLog = (taskIndex: number) => {
    if (!newLog.activity) return;
    const updatedTasks = [...tasks];
    const task = updatedTasks[taskIndex];
    const logs = task.dailyLogs || [];
    const log: DailyLog = {
      id: Math.random().toString(36).substr(2, 9),
      date: new Date().toISOString().split('T')[0],
      ...newLog
    };
    updatedTasks[taskIndex] = { ...task, dailyLogs: [...logs, log] };
    onUpdate({ ...project, execution: updatedTasks });
    setNewLog({ activity: '', doneBy: '', remarks: '' });
  };

  return (
    <div className="bg-white p-6 rounded-2xl border border-n200 shadow-sm space-y-6 relative">
      <div className="flex items-center justify-between border-b border-n100 pb-3">
        <h3 className="text-base font-bold flex items-center gap-2">
          <Settings className="text-shiroi-green" size={18} />
          Execution Milestones
        </h3>
        <button 
          onClick={() => setIsAddingTask(true)}
          className="px-3 py-1.5 bg-shiroi-green text-white rounded-xl text-xs font-bold flex items-center gap-1 hover:bg-shiroi-green/90 transition-all shadow-lg shadow-shiroi-green/20"
        >
          <Plus size={14} /> Add Task
        </button>
      </div>

      {isAddingTask && (
        <div className="p-4 bg-n050 rounded-xl border border-n100 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-n400 uppercase">Category</label>
              <select 
                value={newTask.category}
                onChange={(e) => setNewTask({...newTask, category: e.target.value})}
                className="w-full px-3 py-2 bg-white border border-n200 rounded-lg text-xs focus:ring-2 focus:ring-shiroi-green focus:outline-none font-bold"
              >
                {EXECUTION_MILESTONES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-n400 uppercase">Task Name</label>
              <input 
                type="text" 
                value={newTask.title}
                onChange={(e) => setNewTask({...newTask, title: e.target.value})}
                placeholder="Task name..."
                className="w-full px-3 py-2 bg-white border border-n200 rounded-lg text-xs focus:ring-2 focus:ring-shiroi-green focus:outline-none font-bold"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-n400 uppercase">Assigned To</label>
              <input 
                type="text" 
                value={newTask.assignedTo}
                onChange={(e) => setNewTask({...newTask, assignedTo: e.target.value})}
                placeholder="Engineer..."
                className="w-full px-3 py-2 bg-white border border-n200 rounded-lg text-xs focus:ring-2 focus:ring-shiroi-green focus:outline-none font-bold"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-n400 uppercase">Status</label>
              <select 
                value={newTask.status}
                onChange={(e) => setNewTask({...newTask, status: e.target.value as any})}
                className="w-full px-3 py-2 bg-white border border-n200 rounded-lg text-xs focus:ring-2 focus:ring-shiroi-green focus:outline-none font-bold"
              >
                <option value="Open">Open</option>
                <option value="In Progress">In Progress</option>
                <option value="Closed">Closed</option>
              </select>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setIsAddingTask(false)} className="px-4 py-1.5 text-xs font-bold text-n600 hover:bg-n100 rounded-lg transition-all">
              Cancel
            </button>
            <button onClick={handleAddTask} className="px-4 py-1.5 bg-shiroi-green text-white rounded-lg text-xs font-bold hover:bg-shiroi-green/90 transition-all">
              Save Task
            </button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse border border-n200">
          <thead>
            <tr className="bg-n050 border-b border-n200">
              <th className="px-4 py-2.5 text-[10px] font-bold text-n500 uppercase tracking-wider border-r border-n200">Category</th>
              <th className="px-4 py-2.5 text-[10px] font-bold text-n500 uppercase tracking-wider border-r border-n200">Task Name</th>
              <th className="px-4 py-2.5 text-[10px] font-bold text-n500 uppercase tracking-wider border-r border-n200">Asg To</th>
              <th className="px-4 py-2.5 text-[10px] font-bold text-n500 uppercase tracking-wider border-r border-n200">Asg Date</th>
              <th className="px-4 py-2.5 text-[10px] font-bold text-n500 uppercase tracking-wider border-r border-n200">Action Date</th>
              <th className="px-4 py-2.5 text-[10px] font-bold text-n500 uppercase tracking-wider border-r border-n200">Status</th>
              <th className="px-4 py-2.5 text-[10px] font-bold text-n500 uppercase tracking-wider border-r border-n200">Done By</th>
              <th className="px-4 py-2.5 text-[10px] font-bold text-n500 uppercase tracking-wider border-r border-n200">Remarks</th>
              <th className="px-4 py-2.5 text-[10px] font-bold text-n500 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-n100">
            {tasks.map((task, i) => (
              <React.Fragment key={task.id}>
                <tr className="hover:bg-n050 transition-colors">
                  <td className="px-4 py-2.5 border-r border-n200">
                    <select 
                      value={task.category}
                      onChange={(e) => updateTask(i, 'category', e.target.value)}
                      className="bg-transparent text-[10px] font-bold text-n700 focus:outline-none w-full"
                    >
                      {EXECUTION_MILESTONES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-2.5 border-r border-n200">
                    <input 
                      type="text" 
                      value={task.title}
                      onChange={(e) => updateTask(i, 'title', e.target.value)}
                      className="bg-transparent text-xs text-n600 focus:outline-none w-full font-bold"
                    />
                  </td>
                  <td className="px-4 py-2.5 border-r border-n200">
                    <input 
                      type="text" 
                      value={task.assignedTo || ''}
                      onChange={(e) => updateTask(i, 'assignedTo', e.target.value)}
                      placeholder="Assignee"
                      className="bg-transparent text-xs text-n600 focus:outline-none w-full font-bold"
                    />
                  </td>
                  <td className="px-4 py-2.5 border-r border-n200">
                    <input 
                      type="date" 
                      value={task.assignedDate || ''}
                      onChange={(e) => updateTask(i, 'assignedDate', e.target.value)}
                      className="bg-transparent text-[10px] text-n600 focus:outline-none w-full font-bold"
                    />
                  </td>
                  <td className="px-4 py-2.5 border-r border-n200">
                    <input 
                      type="date" 
                      value={task.actionDate || ''}
                      onChange={(e) => updateTask(i, 'actionDate', e.target.value)}
                      className="bg-transparent text-[10px] text-n600 focus:outline-none w-full font-bold"
                    />
                  </td>
                  <td className="px-4 py-2.5 border-r border-n200">
                    <select 
                      value={task.status}
                      onChange={(e) => updateTask(i, 'status', e.target.value)}
                      className={`text-[9px] font-bold uppercase tracking-wider rounded-md px-1 py-0.5 focus:outline-none ${
                        task.status === 'Closed' ? 'bg-shiroi-green/20 text-shiroi-green' : 
                        task.status === 'In Progress' ? 'bg-shiroi-green/10 text-shiroi-green' : 
                        'bg-n100 text-n600'
                      }`}
                    >
                      <option value="Open">Open</option>
                      <option value="In Progress">In Progress</option>
                      <option value="Closed">Closed</option>
                    </select>
                  </td>
                  <td className="px-4 py-2.5 border-r border-n200">
                    <input 
                      type="text" 
                      value={task.doneBy || ''}
                      onChange={(e) => updateTask(i, 'doneBy', e.target.value)}
                      placeholder="Done by"
                      className="bg-transparent text-xs text-n600 focus:outline-none w-full font-bold"
                    />
                  </td>
                  <td className="px-4 py-2.5 border-r border-n200">
                    <input 
                      type="text" 
                      value={task.remarks || ''}
                      onChange={(e) => updateTask(i, 'remarks', e.target.value)}
                      placeholder="Remarks"
                      className="bg-transparent text-xs text-n600 focus:outline-none w-full font-bold"
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={() => setSelectedTaskForLogs(selectedTaskForLogs === i ? null : i)}
                        className={`p-1 rounded-lg transition-all ${selectedTaskForLogs === i ? 'bg-shiroi-green/10 text-shiroi-green' : 'text-n400 hover:text-shiroi-green'}`}
                        title="Daily Logs"
                      >
                        <Activity size={14} />
                      </button>
                      <button 
                        onClick={() => deleteTask(i)}
                        className="p-1 text-n400 hover:text-red-500 transition-all"
                        title="Delete Task"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
                {selectedTaskForLogs === i && (
                  <tr className="bg-n050/50">
                    <td colSpan={9} className="px-8 py-4">
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <h4 className="text-[10px] font-bold text-n500 uppercase tracking-wider flex items-center gap-2">
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
                            className="px-3 py-1.5 bg-white border border-n200 rounded-lg text-xs focus:ring-2 focus:ring-shiroi-green focus:outline-none font-bold"
                          />
                          <input 
                            type="text" 
                            placeholder="Done by..."
                            value={newLog.doneBy}
                            onChange={(e) => setNewLog({...newLog, doneBy: e.target.value})}
                            className="px-3 py-1.5 bg-white border border-n200 rounded-lg text-xs focus:ring-2 focus:ring-shiroi-green focus:outline-none font-bold"
                          />
                          <input 
                            type="text" 
                            placeholder="Remarks..."
                            value={newLog.remarks}
                            onChange={(e) => setNewLog({...newLog, remarks: e.target.value})}
                            className="px-3 py-1.5 bg-white border border-n200 rounded-lg text-xs focus:ring-2 focus:ring-shiroi-green focus:outline-none font-bold"
                          />
                          <button 
                            onClick={() => addDailyLog(i)}
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
                                  <th className="px-3 py-2 text-[9px] font-bold text-n400 uppercase">Date</th>
                                  <th className="px-3 py-2 text-[9px] font-bold text-n400 uppercase">Activity</th>
                                  <th className="px-3 py-2 text-[9px] font-bold text-n400 uppercase">Done By</th>
                                  <th className="px-3 py-2 text-[9px] font-bold text-n400 uppercase">Remarks</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-n100">
                                {task.dailyLogs.map((log) => (
                                  <tr key={log.id}>
                                    <td className="px-3 py-2 text-[10px] text-n500 font-bold">{log.date}</td>
                                    <td className="px-3 py-2 text-[10px] text-n700 font-bold">{log.activity}</td>
                                    <td className="px-3 py-2 text-[10px] text-n600 font-bold">{log.doneBy}</td>
                                    <td className="px-3 py-2 text-[10px] text-n500 italic font-bold">{log.remarks}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <p className="text-[10px] text-n400 italic font-bold">No daily logs recorded yet.</p>
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
    </div>
  );
}

function QualityCheckTab({ project, onUpdate }: { project: Project; onUpdate: (p: Project) => void }) {
  const [qcData, setQcData] = useState<any>(project.qualityChecks || {});
  const [showPdf, setShowPdf] = useState(false);

  const sections = [
    {
      id: 'panel',
      title: "1. Panel Installation Check",
      items: ["Panels securely mounted", "Proper tilt angle maintained", "No physical damage", "Panels clean"]
    },
    {
      id: 'structure',
      title: "2. Structure & Mounting",
      items: ["Structure properly aligned", "Nuts & bolts tightened", "Corrosion protection applied", "Earthing completed"]
    },
    {
      id: 'electrical',
      title: "3. Electrical Wiring Check",
      items: ["Proper cable routing", "MC4 connectors properly fixed", "No loose or exposed wires", "Cable insulation intact"]
    },
    {
      id: 'inverter',
      title: "4. Inverter Check",
      items: ["Inverter installed properly", "Display functioning correctly", "Error-free operation", "Proper ventilation available"]
    }
  ];

  const updateQc = (item: string, field: string, value: any) => {
    setQcData({
      ...qcData,
      [item]: { ...(qcData[item] || {}), [field]: value }
    });
  };

  const handleSave = () => {
    onUpdate({
      ...project,
      qualityChecks: qcData,
      qualityCheckCompleted: true
    });
  };

  return (
    <div className="bg-white p-6 rounded-2xl border border-n200 shadow-sm space-y-6">
      <div className="flex items-center justify-between border-b border-n100 pb-3">
        <h3 className="text-base font-bold flex items-center gap-2">
          <ClipboardCheck className="text-shiroi-green" size={18} />
          Solar System Quality Check Form
        </h3>
        <div className="flex gap-2">
          <button 
            onClick={() => setShowPdf(true)}
            className="px-4 py-1.5 bg-n100 text-n600 rounded-xl text-xs font-bold hover:bg-n200 transition-all flex items-center gap-2"
          >
            <FileText size={14} /> View PDF
          </button>
          <button 
            onClick={handleSave}
            className="px-4 py-1.5 bg-shiroi-green text-white rounded-xl text-xs font-bold hover:bg-shiroi-green/90 transition-all shadow-lg shadow-shiroi-green/20 flex items-center gap-2"
          >
            <Save size={14} /> Save Progress
          </button>
        </div>
      </div>

      <div className="space-y-8">
        {sections.map((section, idx) => (
          <div key={idx} className="space-y-4">
            <SectionTitle title={section.title} />
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-n050 border-b border-n200">
                    <th className="px-4 py-2 text-[9px] font-bold text-n500 uppercase tracking-wider">Checkpoint</th>
                    <th className="px-4 py-2 text-[9px] font-bold text-n500 uppercase tracking-wider w-24">Status</th>
                    <th className="px-4 py-2 text-[9px] font-bold text-n500 uppercase tracking-wider">Remarks</th>
                    <th className="px-4 py-2 text-[9px] font-bold text-n500 uppercase tracking-wider w-32">Photo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-n100">
                  {section.items.map((item, i) => (
                    <tr key={i} className="hover:bg-n050 transition-colors">
                      <td className="px-4 py-3 text-xs font-bold text-n700">{item}</td>
                      <td className="px-4 py-3">
                        <select 
                          value={qcData[item]?.status || 'Pending'}
                          onChange={(e) => updateQc(item, 'status', e.target.value)}
                          className={`text-[9px] font-bold uppercase tracking-wider rounded-md px-1 py-0.5 focus:outline-none ${
                            qcData[item]?.status === 'Pass' ? 'bg-shiroi-green/20 text-shiroi-green' : 
                            qcData[item]?.status === 'Fail' ? 'bg-red-50 text-red-600' : 
                            'bg-n100 text-n600'
                          }`}
                        >
                          <option value="Pending">Pending</option>
                          <option value="Pass">Pass</option>
                          <option value="Fail">Fail</option>
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        <input 
                          type="text" 
                          value={qcData[item]?.remarks || ''}
                          onChange={(e) => updateQc(item, 'remarks', e.target.value)}
                          placeholder="Add remarks..."
                          className="w-full bg-transparent text-xs text-n600 focus:outline-none border-b border-transparent focus:border-shiroi-green font-bold"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <button className="flex items-center gap-1 text-[10px] font-bold text-n400 hover:text-shiroi-green transition-all">
                          <Camera size={14} /> Upload
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>

      <AnimatePresence>
        {showPdf && (
          <PdfPreviewModal title="Quality Check Report" onClose={() => setShowPdf(false)}>
            <div className="p-12 space-y-10 bg-white">
              <div className="flex justify-between items-start border-b-4 border-n900 pb-8">
                <div>
                  <h1 className="text-3xl font-black uppercase tracking-tighter">Quality Check Report</h1>
                  <p className="text-n500 font-bold text-sm uppercase tracking-widest mt-1">Shiroi Energy Private Limited</p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-bold text-n400 uppercase">Project</p>
                  <p className="text-lg font-black text-n900">{project.name}</p>
                </div>
              </div>

              <div className="space-y-8">
                {sections.map((section, idx) => (
                  <div key={idx} className="space-y-4">
                    <h3 className="text-sm font-black text-n900 uppercase tracking-wider bg-n050 p-2">{section.title}</h3>
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b-2 border-n900">
                          <th className="py-2 text-[10px] font-bold uppercase">Checkpoint</th>
                          <th className="py-2 text-[10px] font-bold uppercase w-24">Status</th>
                          <th className="py-2 text-[10px] font-bold uppercase">Remarks</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-n200">
                        {section.items.map((item, i) => (
                          <tr key={i}>
                            <td className="py-3 text-xs text-n700 font-bold">{item}</td>
                            <td className="py-3">
                              <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${
                                qcData[item]?.status === 'Pass' ? 'bg-shiroi-green/20 text-shiroi-green' : 
                                qcData[item]?.status === 'Fail' ? 'bg-red-100 text-red-700' : 
                                'bg-n100 text-n600'
                              }`}>
                                {qcData[item]?.status || 'Pending'}
                              </span>
                            </td>
                            <td className="py-3 text-xs text-n600 italic font-bold">{qcData[item]?.remarks || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            </div>
          </PdfPreviewModal>
        )}
      </AnimatePresence>
    </div>
  );
}

function LiasonningTab({ project, onUpdate }: { project: Project; onUpdate: (p: Project) => void }) {
  const [liaison, setLiaison] = useState<Liasonning>(project.liasonning || {
    tneb: {
      docsCollected: { completed: false },
      registration: { completed: false },
      estimatePaid: { completed: false },
      inspectionArranged: { completed: false },
      netmeterInstalled: { completed: false },
    },
    ceig: {
      docsCollected: { completed: false },
      registration: { completed: false },
      estimatePaid: { completed: false },
      drawingApproved: { completed: false },
      inspectionArranged: { completed: false },
      drRrReceived: { completed: false },
      finalApproval: { completed: false },
    }
  });

  const updateMilestone = (process: 'tneb' | 'ceig', key: string, field: keyof Milestone, value: any) => {
    const updatedProcess = { 
      ...liaison[process], 
      [key]: { ...(liaison[process] as any)[key], [field]: value } 
    };
    const updatedLiaison = { ...liaison, [process]: updatedProcess };
    setLiaison(updatedLiaison);
  };

  const handleSave = () => {
    onUpdate({ ...project, liasonning: liaison });
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <button 
          onClick={handleSave}
          className="px-4 py-1.5 bg-orange-500 text-white rounded-xl text-xs font-bold hover:bg-orange-600 transition-all shadow-lg shadow-orange-500/20 flex items-center gap-2"
        >
          <Save size={14} /> Save Changes
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-5">
          <h3 className="text-base font-bold text-slate-800 border-b border-slate-100 pb-3 flex items-center gap-2">
            <Zap className="text-blue-500" size={18} />
            TNEB Process
          </h3>
          <div className="space-y-4">
            <LiaisonItem 
              label="Document Collection" 
              milestone={liaison.tneb.docsCollected} 
              onChange={(f, v) => updateMilestone('tneb', 'docsCollected', f, v)}
            />
            <LiaisonItem 
              label="Registration Process" 
              milestone={liaison.tneb.registration} 
              onChange={(f, v) => updateMilestone('tneb', 'registration', f, v)}
            />
            <LiaisonItem 
              label="Estimate & Payment" 
              milestone={liaison.tneb.estimatePaid} 
              onChange={(f, v) => updateMilestone('tneb', 'estimatePaid', f, v)}
            />
            <LiaisonItem 
              label="Arrange Inspection" 
              milestone={liaison.tneb.inspectionArranged} 
              onChange={(f, v) => updateMilestone('tneb', 'inspectionArranged', f, v)}
            />
            <LiaisonItem 
              label="Netmeter Installation" 
              milestone={liaison.tneb.netmeterInstalled} 
              onChange={(f, v) => updateMilestone('tneb', 'netmeterInstalled', f, v)}
            />
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-5">
          <h3 className="text-base font-bold text-slate-800 border-b border-slate-100 pb-3 flex items-center gap-2">
            <ShieldCheck className="text-green-500" size={18} />
            CEIG Process
          </h3>
          <div className="space-y-4">
            <LiaisonItem 
              label="Document Collection" 
              milestone={liaison.ceig.docsCollected} 
              onChange={(f, v) => updateMilestone('ceig', 'docsCollected', f, v)}
            />
            <LiaisonItem 
              label="Registration Process" 
              milestone={liaison.ceig.registration} 
              onChange={(f, v) => updateMilestone('ceig', 'registration', f, v)}
            />
            <LiaisonItem 
              label="Estimate & Payment" 
              milestone={liaison.ceig.estimatePaid} 
              onChange={(f, v) => updateMilestone('ceig', 'estimatePaid', f, v)}
            />
            <LiaisonItem 
              label="Drawing Approvals" 
              milestone={liaison.ceig.drawingApproved} 
              onChange={(f, v) => updateMilestone('ceig', 'drawingApproved', f, v)}
            />
            <LiaisonItem 
              label="Arrange Inspection" 
              milestone={liaison.ceig.inspectionArranged} 
              onChange={(f, v) => updateMilestone('ceig', 'inspectionArranged', f, v)}
            />
            <LiaisonItem 
              label="Get DR & RR" 
              milestone={liaison.ceig.drRrReceived} 
              onChange={(f, v) => updateMilestone('ceig', 'drRrReceived', f, v)}
            />
            <LiaisonItem 
              label="Final Approvals" 
              milestone={liaison.ceig.finalApproval} 
              onChange={(f, v) => updateMilestone('ceig', 'finalApproval', f, v)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function CommissioningTab({ project, onUpdate }: any) {
  const [showPdf, setShowPdf] = useState(false);
  const updateCommissioning = (field: string, value: any) => {
    const commissioning = { ...(project.commissioning || {}), [field]: value };
    onUpdate({ ...project, commissioning });
  };

  const report = project.commissioning || {};

  return (
    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-8">
      <div className="flex items-center justify-between border-b border-slate-100 pb-3">
        <h3 className="text-base font-bold flex items-center gap-2">
          <FileText className="text-shiroi-green" size={18} />
          Solar PV System Commissioning Report
        </h3>
        <div className="flex gap-3">
          <button 
            onClick={() => setShowPdf(true)}
            className="px-4 py-1.5 bg-slate-900 text-white rounded-xl text-xs font-bold hover:bg-slate-800 transition-all flex items-center gap-2 shadow-lg shadow-slate-900/20"
          >
            <FileDown size={14} /> Preview Report
          </button>
          <button className="px-4 py-1.5 bg-shiroi-green text-white rounded-xl text-xs font-bold hover:bg-shiroi-green/90 transition-all flex items-center gap-2 shadow-lg shadow-shiroi-green/20">
            <Save size={14} /> Save Report
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="space-y-6">
          <div className="space-y-4">
            <SectionTitle title="Project Details" />
            <div className="space-y-1">
              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Commissioning Date</p>
              <input 
                type="date" 
                value={report.date || ''} 
                onChange={(e) => updateCommissioning('date', e.target.value)}
                className="w-full bg-transparent text-xs font-semibold text-slate-700 focus:outline-none border-b border-slate-200 focus:border-shiroi-green"
              />
            </div>
            <StaticField label="Project Name" value={project.name} />
            <StaticField label="Client Name" value={project.clientName} />
            <StaticField label="Location" value={project.location} />
            <StaticField label="System Type" value={project.systemType} />
            <StaticField label="Capacity" value={`${project.systemSize} kWp`} />
          </div>

          <div className="space-y-4">
            <SectionTitle title="System Overview" />
            <EditField label="Module Type" value={report.systemOverview?.moduleType} onChange={(v: any) => updateCommissioning('systemOverview', { ...report.systemOverview, moduleType: v })} />
            <EditField label="Inverter Model" value={report.systemOverview?.inverterModel} onChange={(v: any) => updateCommissioning('systemOverview', { ...report.systemOverview, inverterModel: v })} />
            <EditField label="Mounting Type" value={report.systemOverview?.mountingType} onChange={(v: any) => updateCommissioning('systemOverview', { ...report.systemOverview, mountingType: v })} />
            <div className="grid grid-cols-2 gap-4">
              <EditField label="No. of Modules" value={report.systemOverview?.numModules} type="number" onChange={(v: any) => updateCommissioning('systemOverview', { ...report.systemOverview, numModules: parseInt(v) })} />
              <EditField label="No. of Inverters" value={report.systemOverview?.numInverters} type="number" onChange={(v: any) => updateCommissioning('systemOverview', { ...report.systemOverview, numInverters: parseInt(v) })} />
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="space-y-4">
            <SectionTitle title="Electrical Tests" />
            <div className="grid grid-cols-2 gap-4">
              <EditField label="String VOC (V)" value={report.tests?.stringVoc} onChange={(v: any) => updateCommissioning('tests', { ...report.tests, stringVoc: v })} />
              <EditField label="String ISC (A)" value={report.tests?.stringIsc} onChange={(v: any) => updateCommissioning('tests', { ...report.tests, stringIsc: v })} />
            </div>
            <EditField label="Insulation Resistance" value={report.tests?.insulationResistance} onChange={(v: any) => updateCommissioning('tests', { ...report.tests, insulationResistance: v })} />
            <div className="flex items-center gap-4 pt-2">
              <CheckboxField label="Polarity Check" checked={report.tests?.polarityCheck} />
              <CheckboxField label="Phase Sequence" checked={report.tests?.phaseSequence} />
            </div>
          </div>

          <div className="space-y-4">
            <SectionTitle title="Monitoring Details" />
            <EditField label="Monitoring Link" value={report.monitoringLink} onChange={(v: any) => updateCommissioning('monitoringLink', v)} />
            <div className="grid grid-cols-2 gap-4">
              <EditField label="Login ID" value={report.monitoringLogin} onChange={(v: any) => updateCommissioning('monitoringLogin', v)} />
              <EditField label="Password" value={report.monitoringPassword} onChange={(v: any) => updateCommissioning('monitoringPassword', v)} />
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="space-y-4">
            <SectionTitle title="Performance & Remarks" />
            <div className="grid grid-cols-2 gap-4">
              <EditField label="Initial Power (kW)" value={report.performance?.initialPower} type="number" onChange={(v: any) => updateCommissioning('performance', { ...report.performance, initialPower: parseFloat(v) })} />
              <EditField label="PR (%)" value={report.performance?.performanceRatio} type="number" onChange={(v: any) => updateCommissioning('performance', { ...report.performance, performanceRatio: parseFloat(v) })} />
            </div>
            <EditField label="Remarks" value={report.remarks} isTextArea onChange={(v: any) => updateCommissioning('remarks', v)} />
          </div>

          <div className="space-y-4">
            <SectionTitle title="Signatures" />
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Engineer</p>
                <div className="h-20 border border-slate-200 rounded-xl flex items-center justify-center bg-slate-50 italic text-[10px] text-slate-400">
                  {report.engineerSignature ? <img src={report.engineerSignature} className="max-h-full" /> : 'Sign here'}
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Client</p>
                <div className="h-20 border border-slate-200 rounded-xl flex items-center justify-center bg-slate-50 italic text-[10px] text-slate-400">
                  {report.clientSignature ? <img src={report.clientSignature} className="max-h-full" /> : 'Sign here'}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {showPdf && (
          <PdfPreviewModal title="Commissioning Report" onClose={() => setShowPdf(false)}>
            <div className="p-12 space-y-10 bg-white">
              <div className="flex justify-between items-start border-b-4 border-n900 pb-8">
                <div>
                  <h1 className="text-3xl font-black uppercase tracking-tighter">Commissioning Report</h1>
                  <p className="text-n500 font-bold text-sm uppercase tracking-widest mt-1">Shiroi Energy Private Limited</p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-bold text-n400 uppercase">Report Date</p>
                  <p className="text-lg font-black text-n900">{report.date || 'N/A'}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-12">
                <div className="space-y-6">
                  <h3 className="text-sm font-black text-n900 uppercase tracking-wider bg-n050 p-2">Project Details</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <PdfField label="Project Name" value={project.name} />
                    <PdfField label="Client Name" value={project.clientName} />
                    <PdfField label="Location" value={project.location} />
                    <PdfField label="System Type" value={project.systemType} />
                    <PdfField label="Capacity" value={`${project.systemSize} kWp`} />
                  </div>
                </div>

                <div className="space-y-6">
                  <h3 className="text-sm font-black text-n900 uppercase tracking-wider bg-n050 p-2">System Overview</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <PdfField label="Module Type" value={report.systemOverview?.moduleType || '-'} />
                    <PdfField label="Inverter Model" value={report.systemOverview?.inverterModel || '-'} />
                    <PdfField label="No. of Modules" value={report.systemOverview?.numModules?.toString() || '-'} />
                    <PdfField label="No. of Inverters" value={report.systemOverview?.numInverters?.toString() || '-'} />
                  </div>
                </div>
              </div>

              <div className="space-y-6">
                <h3 className="text-sm font-black text-n900 uppercase tracking-wider bg-n050 p-2">Electrical Test Results</h3>
                <div className="grid grid-cols-4 gap-4">
                  <PdfField label="String VOC" value={report.tests?.stringVoc || '-'} />
                  <PdfField label="String ISC" value={report.tests?.stringIsc || '-'} />
                  <PdfField label="Insulation Res." value={report.tests?.insulationResistance || '-'} />
                  <PdfField label="Earthing Res." value={report.tests?.earthingResistance || '-'} />
                </div>
                <div className="flex gap-8">
                  <PdfCheck label="Polarity Check" checked={!!report.tests?.polarityCheck} />
                  <PdfCheck label="Phase Sequence" checked={!!report.tests?.phaseSequence} />
                  <PdfCheck label="Grid Synchronization" checked={!!report.inverterCommissioning?.gridSync} />
                </div>
              </div>

              <div className="space-y-6">
                <h3 className="text-sm font-black text-n900 uppercase tracking-wider bg-n050 p-2">Performance & Remarks</h3>
                <div className="grid grid-cols-3 gap-4">
                  <PdfField label="Initial Power" value={`${report.performance?.initialPower || '-'} kW`} />
                  <PdfField label="Performance Ratio" value={`${report.performance?.performanceRatio || '-'} %`} />
                  <PdfField label="Monitoring" value={report.performance?.monitoringWorking ? 'Working' : 'Pending'} />
                </div>
                <div className="p-4 border border-n200 rounded-lg">
                  <p className="text-[9px] font-bold text-n400 uppercase mb-2">Remarks</p>
                  <p className="text-xs text-n700 leading-relaxed">{report.remarks || 'No specific remarks provided.'}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-12 pt-10">
                <div className="space-y-4">
                  <div className="h-24 border-b-2 border-n900 flex items-center justify-center italic text-n300">
                    {report.engineerSignature ? <img src={report.engineerSignature} className="max-h-full" /> : 'Engineer Signature'}
                  </div>
                  <p className="text-center text-[10px] font-black uppercase tracking-widest">Authorized Engineer</p>
                </div>
                <div className="space-y-4">
                  <div className="h-24 border-b-2 border-n900 flex items-center justify-center italic text-n300">
                    {report.clientSignature ? <img src={report.clientSignature} className="max-h-full" /> : 'Client Signature'}
                  </div>
                  <p className="text-center text-[10px] font-black uppercase tracking-widest">Client Acknowledgement</p>
                </div>
              </div>
            </div>
          </PdfPreviewModal>
        )}
      </AnimatePresence>
    </div>
  );
}

function EditableField({ label, value, onChange }: { label: string, value: string, onChange: (val: string) => void }) {
  return (
    <div>
      <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">{label}</p>
      <input 
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-transparent text-xs font-semibold text-slate-700 focus:outline-none border-b border-transparent focus:border-orange-500"
      />
    </div>
  );
}

function AMCTab({ project, onUpdate }: { project: Project; onUpdate: (p: Project) => void }) {
  const [amcSchedule, setAmcSchedule] = useState<AMCScheduleItem[]>(project.amcSchedule || []);
  const [showMsg, setShowMsg] = useState<string | null>(null);

  const generateSchedule = () => {
    if (!project.commissioning?.date) {
      setShowMsg("Please set the commissioning date in the Commissioning tab first.");
      setTimeout(() => setShowMsg(null), 5000);
      return;
    }

    const startDate = new Date(project.commissioning.date);
    const newSchedule: AMCScheduleItem[] = [];

    for (let i = 1; i <= 4; i++) {
      const scheduledDate = new Date(startDate);
      scheduledDate.setMonth(startDate.getMonth() + (i * 3));
      
      newSchedule.push({
        id: `amc-${project.id}-${i}`,
        visitNumber: i,
        scheduledDate: scheduledDate.toISOString().split('T')[0],
        status: 'Pending',
        remarks: `Quarterly AMC Visit #${i}`
      });
    }

    setAmcSchedule(newSchedule);
    onUpdate({ ...project, amcSchedule: newSchedule });
  };

  const updateVisit = (id: string, updates: Partial<AMCScheduleItem>) => {
    const updated = amcSchedule.map(v => v.id === id ? { ...v, ...updates } : v);
    setAmcSchedule(updated);
  };

  const markCompleted = (id: string) => {
    const visit = amcSchedule.find(v => v.id === id);
    if (!visit?.completedDate || !visit?.engineerName) return;
    updateVisit(id, { status: 'Completed' });
  };

  const handleSave = () => {
    onUpdate({ ...project, amcSchedule });
  };

  return (
    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-8">
      <div className="flex items-center justify-between border-b border-slate-100 pb-3">
        <h3 className="text-base font-bold flex items-center gap-2">
          <ShieldCheck className="text-shiroi-green" size={18} />
          Annual Maintenance Contract (AMC) Schedule
        </h3>
        <div className="flex gap-3">
          {amcSchedule.length === 0 ? (
            <button 
              onClick={generateSchedule}
              className="px-4 py-1.5 bg-shiroi-green text-white rounded-xl text-xs font-bold hover:bg-shiroi-green/90 transition-all flex items-center gap-2 shadow-lg shadow-shiroi-green/20"
            >
              <Plus size={14} /> Generate 1-Year Free AMC
            </button>
          ) : (
            <button 
              onClick={handleSave}
              className="px-4 py-1.5 bg-orange-500 text-white rounded-xl text-xs font-bold hover:bg-orange-600 transition-all flex items-center gap-2 shadow-lg shadow-orange-500/20"
            >
              <Save size={14} /> Save Changes
            </button>
          )}
        </div>
      </div>

      {showMsg && (
        <motion.div 
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-3 bg-red-50 border border-red-100 rounded-xl text-red-600 text-xs font-bold flex items-center gap-2"
        >
          <X size={14} /> {showMsg}
        </motion.div>
      )}

      {amcSchedule.length === 0 ? (
        <div className="py-12 text-center space-y-4">
          <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto">
            <Calendar className="text-slate-300" size={32} />
          </div>
          <div className="space-y-1">
            <h4 className="text-sm font-bold text-slate-800">No AMC Schedule Generated</h4>
            <p className="text-xs text-slate-500 max-w-xs mx-auto">
              Once the project is commissioned, you can generate the 1-year free AMC schedule consisting of 4 quarterly visits.
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {amcSchedule.map((visit) => (
            <div key={visit.id} className={`p-5 rounded-2xl border transition-all space-y-4 ${
              visit.status === 'Completed' ? 'bg-green-50 border-green-100' : 'bg-white border-slate-200'
            }`}>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Visit #{visit.visitNumber}</span>
                <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${
                  visit.status === 'Completed' ? 'bg-green-500 text-white' : 'bg-orange-100 text-orange-600'
                }`}>
                  {visit.status}
                </span>
              </div>

              <div className="space-y-1">
                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Scheduled Date</p>
                <p className="text-xs font-bold text-slate-700">{new Date(visit.scheduledDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
              </div>

              {visit.status === 'Completed' ? (
                <div className="space-y-3 pt-3 border-t border-green-100">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-0.5">
                      <p className="text-[8px] font-bold text-slate-400 uppercase tracking-tighter">Completed Date</p>
                      <p className="text-[10px] font-bold text-slate-700">{visit.completedDate}</p>
                    </div>
                    <div className="space-y-0.5">
                      <p className="text-[8px] font-bold text-slate-400 uppercase tracking-tighter">Engineer</p>
                      <p className="text-[10px] font-bold text-slate-700">{visit.engineerName}</p>
                    </div>
                  </div>
                  <button className="w-full py-1.5 bg-white border border-green-200 rounded-lg text-[10px] font-bold text-green-600 hover:bg-green-100 transition-all flex items-center justify-center gap-2">
                    <FileText size={12} /> View Report
                  </button>
                </div>
              ) : (
                <div className="space-y-3 pt-3 border-t border-slate-100">
                  <div className="space-y-2">
                    <div className="space-y-1">
                      <p className="text-[8px] font-bold text-slate-400 uppercase tracking-tighter">Completion Date</p>
                      <input 
                        type="date" 
                        value={visit.completedDate || ''}
                        onChange={(e) => updateVisit(visit.id, { completedDate: e.target.value })}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-[10px] font-bold text-slate-700 focus:outline-none focus:ring-1 focus:ring-shiroi-green"
                      />
                    </div>
                    <div className="space-y-1">
                      <p className="text-[8px] font-bold text-slate-400 uppercase tracking-tighter">Engineer Name</p>
                      <input 
                        type="text" 
                        value={visit.engineerName || ''}
                        placeholder="Engineer Name"
                        onChange={(e) => updateVisit(visit.id, { engineerName: e.target.value })}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-[10px] font-bold text-slate-700 focus:outline-none focus:ring-1 focus:ring-shiroi-green"
                      />
                    </div>
                  </div>
                  <button 
                    onClick={() => markCompleted(visit.id)}
                    disabled={!visit.completedDate || !visit.engineerName}
                    className="w-full py-1.5 bg-shiroi-green text-white rounded-lg text-[10px] font-bold hover:bg-shiroi-green/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    <CheckCircle2 size={12} /> Complete Visit
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {amcSchedule.length > 0 && (
        <div className="pt-8 border-t border-slate-100 space-y-6">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2">
              <Layers className="text-blue-500" size={16} />
              AMC History & Documents
            </h4>
            <button className="px-3 py-1 bg-slate-100 text-slate-600 rounded-lg text-[10px] font-bold uppercase tracking-wider hover:bg-slate-200 transition-all flex items-center gap-1.5">
              <Plus size={12} /> Add Custom Visit
            </button>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 flex items-center gap-4 group hover:border-shiroi-green transition-all cursor-pointer">
              <div className="w-10 h-10 bg-white rounded-xl border border-slate-200 flex items-center justify-center text-slate-400 group-hover:text-shiroi-green transition-all">
                <FileDown size={20} />
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Document</p>
                <p className="text-xs font-bold text-slate-700">AMC Contract.pdf</p>
              </div>
            </div>
            
            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 flex items-center gap-4 group hover:border-shiroi-green transition-all cursor-pointer">
              <div className="w-10 h-10 bg-white rounded-xl border border-slate-200 flex items-center justify-center text-slate-400 group-hover:text-shiroi-green transition-all">
                <FileDown size={20} />
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Document</p>
                <p className="text-xs font-bold text-slate-700">Warranty Certificate.pdf</p>
              </div>
            </div>

            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 border-dashed flex flex-col items-center justify-center text-slate-400 hover:text-shiroi-green hover:border-shiroi-green transition-all cursor-pointer">
              <Plus size={20} />
              <span className="text-[9px] font-bold uppercase mt-1">Upload New Document</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Helper Components ---

function StaticField({ label, value }: { label: string, value: string }) {
  return (
    <div>
      <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">{label}</p>
      <p className="text-xs font-semibold text-slate-700">{value}</p>
    </div>
  );
}

function CheckboxField({ label, checked }: { label: string, checked?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${
        checked ? 'bg-orange-500 border-orange-500 text-white' : 'bg-white border-slate-300'
      }`}>
        {checked && <CheckCircle2 size={12} />}
      </div>
      <span className="text-xs font-medium text-slate-600">{label}</span>
    </div>
  );
}

function RadioField({ label, options, selected }: { label: string, options: string[], selected?: string }) {
  return (
    <div className="space-y-1.5">
      <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">{label}</p>
      <div className="flex flex-wrap gap-2">
        {options.map(opt => (
          <div key={opt} className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border transition-all cursor-pointer ${
            selected === opt ? 'bg-orange-500 border-orange-500 text-white' : 'bg-white border-slate-200 text-slate-500'
          }`}>
            {opt}
          </div>
        ))}
      </div>
    </div>
  );
}

function LiaisonItem({ label, milestone, onChange }: { label: string, milestone: Milestone, onChange: (field: keyof Milestone, value: any) => void }) {
  return (
    <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold text-slate-700">{label}</span>
        <button 
          onClick={() => onChange('completed', !milestone.completed)}
          className={`flex items-center gap-1.5 px-2 py-0.5 rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all ${
            milestone.completed ? 'bg-green-500 text-white' : 'bg-slate-200 text-slate-500'
          }`}
        >
          {milestone.completed ? <CheckCircle2 size={10} /> : <Circle size={10} />}
          {milestone.completed ? 'Completed' : 'Pending'}
        </button>
      </div>
      
      {milestone.completed && (
        <div className="grid grid-cols-2 gap-2.5 pt-2 border-t border-slate-200">
          <div className="space-y-0.5">
            <p className="text-[8px] font-bold text-slate-400 uppercase tracking-tighter">Comp. Date</p>
            <input 
              type="date" 
              value={milestone.date || ''}
              onChange={(e) => onChange('date', e.target.value)}
              className="w-full bg-white border border-slate-200 rounded-md px-1.5 py-0.5 text-[9px] font-bold text-slate-700 focus:outline-none focus:ring-1 focus:ring-orange-500"
            />
          </div>
          <div className="space-y-0.5">
            <p className="text-[8px] font-bold text-slate-400 uppercase tracking-tighter">Comp. By</p>
            <input 
              type="text" 
              value={milestone.completedBy || ''}
              onChange={(e) => onChange('completedBy', e.target.value)}
              placeholder="Name..."
              className="w-full bg-white border border-slate-200 rounded-md px-1.5 py-0.5 text-[9px] font-bold text-slate-700 focus:outline-none focus:ring-1 focus:ring-orange-500"
            />
          </div>
          <div className="col-span-2">
            <button className="w-full flex items-center justify-center gap-1.5 px-2 py-1 bg-white border border-dashed border-slate-300 rounded-md text-[9px] font-bold text-slate-500 hover:border-orange-500 hover:text-orange-500 transition-all">
              <Upload size={10} /> {milestone.document ? 'Update Doc' : 'Upload Doc'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
