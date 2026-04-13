'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
  Button, Input, Label, Select,
} from '@repo/ui';
import { Plus } from 'lucide-react';
import { createAmcSchedule } from '@/lib/amc-actions';

interface CreateAmcDialogProps {
  commissionedProjects: { id: string; project_number: string; customer_name: string; commissioned_date: string | null }[];
  allProjects: { id: string; project_number: string; customer_name: string }[];
  employees: { id: string; full_name: string }[];
}

export function CreateAmcDialog({ commissionedProjects, allProjects, employees }: CreateAmcDialogProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [category, setCategory] = React.useState<'free_amc' | 'paid_amc'>('free_amc');
  const [selectedProject, setSelectedProject] = React.useState('');
  const [assignedTo, setAssignedTo] = React.useState('');

  // Free AMC
  const [commDate, setCommDate] = React.useState('');

  // Paid AMC
  const [startDate, setStartDate] = React.useState('');
  const [durationMonths, setDurationMonths] = React.useState(12);
  const [visitCount, setVisitCount] = React.useState(4);
  const [amcAmount, setAmcAmount] = React.useState('');

  const isFree = category === 'free_amc';
  const projects = isFree ? commissionedProjects : allProjects;

  function handleProjectChange(projectId: string) {
    setSelectedProject(projectId);
    if (isFree) {
      const project = commissionedProjects.find((p) => p.id === projectId);
      if (project?.commissioned_date) {
        setCommDate(project.commissioned_date);
      }
    }
  }

  function handleCategoryChange(cat: string) {
    setCategory(cat as 'free_amc' | 'paid_amc');
    setSelectedProject('');
    setCommDate('');
    setStartDate('');
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selectedProject) {
      setError('Please select a project');
      return;
    }

    setSaving(true);
    setError(null);

    const result = await createAmcSchedule({
      projectId: selectedProject,
      category,
      assignedTo: assignedTo || undefined,
      ...(isFree
        ? { commissioningDate: commDate || undefined }
        : {
            startDate: startDate || undefined,
            durationMonths,
            visitCount,
            amcAmount: amcAmount ? parseFloat(amcAmount) : 0,
          }),
    });

    setSaving(false);
    if (result.success) {
      setOpen(false);
      setSelectedProject('');
      setCommDate('');
      setStartDate('');
      setAmcAmount('');
      router.refresh();
    } else {
      setError(result.error ?? 'Failed to create AMC');
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5 h-8 text-xs">
          <Plus className="h-3.5 w-3.5" /> Create AMC
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="text-sm">Create AMC Contract</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          {/* Category Selection */}
          <div>
            <Label htmlFor="amc-category" className="text-xs">AMC Category *</Label>
            <Select
              id="amc-category"
              value={category}
              onChange={(e) => handleCategoryChange(e.target.value)}
              className="h-8 text-xs"
            >
              <option value="free_amc">Free AMC (Warranty Period — 3 visits)</option>
              <option value="paid_amc">Paid AMC (Custom duration & visits)</option>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* Project */}
            <div className="col-span-2">
              <Label htmlFor="amc-project" className="text-xs">Project *</Label>
              <Select
                id="amc-project"
                value={selectedProject}
                onChange={(e) => handleProjectChange(e.target.value)}
                required
                className="h-8 text-xs"
              >
                <option value="" disabled>
                  {isFree ? 'Select commissioned project...' : 'Select project...'}
                </option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.customer_name}
                  </option>
                ))}
              </Select>
            </div>

            {/* Assigned To */}
            <div className="col-span-2">
              <Label htmlFor="amc-assigned" className="text-xs">Assigned To</Label>
              <Select
                id="amc-assigned"
                value={assignedTo}
                onChange={(e) => setAssignedTo(e.target.value)}
                className="h-8 text-xs"
              >
                <option value="">— Unassigned —</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>{e.full_name}</option>
                ))}
              </Select>
            </div>
          </div>

          {/* Free AMC fields */}
          {isFree && commDate && (
            <div className="bg-green-50 border border-green-200 rounded px-3 py-2">
              <p className="text-[10px] text-green-700 font-medium mb-1">Free AMC — 3 visits auto-generated</p>
              <p className="text-[10px] text-green-600">
                Commissioning: {commDate} · Visits spread evenly over 1 year
              </p>
            </div>
          )}

          {/* Paid AMC fields */}
          {!isFree && (
            <div className="space-y-3 bg-blue-50 border border-blue-200 rounded px-3 py-2.5">
              <p className="text-[10px] text-blue-700 font-medium">Paid AMC Details</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="amc-start" className="text-xs">Start Date *</Label>
                  <Input
                    id="amc-start"
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    required
                    className="h-8 text-xs"
                  />
                </div>
                <div>
                  <Label htmlFor="amc-duration" className="text-xs">Duration (months) *</Label>
                  <Input
                    id="amc-duration"
                    type="number"
                    min={1}
                    max={60}
                    value={durationMonths}
                    onChange={(e) => setDurationMonths(parseInt(e.target.value) || 12)}
                    required
                    className="h-8 text-xs"
                  />
                </div>
                <div>
                  <Label htmlFor="amc-visits" className="text-xs">Number of Visits *</Label>
                  <Input
                    id="amc-visits"
                    type="number"
                    min={1}
                    max={24}
                    value={visitCount}
                    onChange={(e) => setVisitCount(parseInt(e.target.value) || 4)}
                    required
                    className="h-8 text-xs"
                  />
                </div>
                <div>
                  <Label htmlFor="amc-amount" className="text-xs">AMC Amount (₹) *</Label>
                  <Input
                    id="amc-amount"
                    type="number"
                    step="0.01"
                    min="0"
                    value={amcAmount}
                    onChange={(e) => setAmcAmount(e.target.value)}
                    required
                    placeholder="0.00"
                    className="h-8 text-xs"
                  />
                </div>
              </div>
            </div>
          )}

          {error && (
            <p className="text-xs text-red-600 bg-red-50 px-3 py-1.5 rounded">{error}</p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" size="sm" className="h-8 text-xs" disabled={saving || !selectedProject}>
              {saving ? 'Creating...' : 'Create AMC'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
