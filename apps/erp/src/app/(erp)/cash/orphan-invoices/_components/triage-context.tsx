'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';

interface SelectedProject {
  id: string;
  number: string;
  customer_name: string;
}

interface TriageContextValue {
  selectedProject: SelectedProject | null;
  setSelectedProject: (p: SelectedProject | null) => void;
}

const Ctx = createContext<TriageContextValue | undefined>(undefined);

export function TriageProvider({ children }: { children: ReactNode }) {
  const [selectedProject, setSelectedProject] = useState<SelectedProject | null>(null);
  return <Ctx.Provider value={{ selectedProject, setSelectedProject }}>{children}</Ctx.Provider>;
}

export function useTriage(): TriageContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useTriage must be used inside TriageProvider');
  return ctx;
}
