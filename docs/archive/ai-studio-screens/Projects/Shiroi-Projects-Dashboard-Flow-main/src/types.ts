export type ProjectStatus = 'Confirmed' | 'In Progress' | 'Completed' | 'On Hold';
export type SystemType = 'On Grid' | 'Off Grid' | 'Hybrid';
export type MountingType = 'Low Raise' | 'Elevated' | 'Asbestos Shed' | 'Metal Shed';
export type MountingStructure = 'GI' | 'MS' | 'Mini Rails' | 'Long Rails' | 'Customized';
export type Scope = 'Shiroi' | 'Client';
export type BOIStatus = 'Yet to Finalize' | 'Yet to Place' | 'Order Placed' | 'Received' | 'Ready to Dispatch' | 'Delivered';

export interface Delivery {
  id: string;
  dcNumber: string; // e.g., DC1, DC2
  date: string;
  items: BOIItem[];
  receiverName: string;
  receiverSignature?: string;
  authorizedSignatory?: string;
  clientSignature?: string;
  engineerSignature?: string;
  receivedBy?: string;
}

export interface Project {
  id: string;
  clientId: string;
  name: string;
  systemSize: number;
  location: string;
  status: ProjectStatus;
  percentComplete: number;
  startDate: string;
  endDate: string;
  remarks: string;
  
  // Project Details
  contactName: string;
  contactNumber: string;
  email: string;
  systemType: SystemType;
  mountingType: MountingType;
  mountingStructure: MountingStructure;
  scopeLA: Scope;
  scopeCivil: Scope;
  scopeStatutory: Scope;
  scopeCEIG: Scope;
  address: string;
  mapLink: string;
  budget: number;
  consideredMargin: number;
  actualBudget: number;
  actualMargin: number;
  
  // New Technical Specs
  inverterMake?: string;
  panelMake?: string;
  cableMake?: string;
  techRemarks?: string;

  // Workflow Data
  survey?: SiteSurvey;
  boi?: BOIItem[];
  execution?: ExecutionTask[];
  expenses?: Expense[];
  qualityCheck?: QualityCheck;
  qualityChecks?: { [key: string]: { status: string; remarks: string; photo?: string } };
  qualityCheckCompleted?: boolean;
  liasonning?: Liasonning;
  commissioning?: CommissioningReport;
  deliveries?: Delivery[];
  boiPreparedBy?: string;
  boqBudgetAnalysisCompleted?: boolean;
  amcDates?: string[];
  amcSchedule?: AMCScheduleItem[];
}

export interface AMCScheduleItem {
  id: string;
  visitNumber: number;
  scheduledDate: string;
  status: 'Pending' | 'Completed' | 'Missed';
  completedDate?: string;
  engineerName?: string;
  reportUrl?: string;
  remarks?: string;
}

export interface SiteSurvey {
  projectName?: string;
  systemSize?: number;
  date: string;
  location: { lat: number; lng: number; address?: string };
  mountingFeasibility: boolean;
  roofType: 'RCC' | 'Metal' | 'Tile' | 'Ground Mount';
  shadowAnalysis: boolean;
  shadowSource?: string;
  mountingProcedureExplained: boolean;
  fixingArrangementDiscussed: boolean;
  inverterLocationFinalized: boolean;
  inverterLocationPhoto?: string;
  dcCableRoutingFinalized: boolean;
  dcCableRoutingPhoto?: string;
  earthingPitLocationFinalized: boolean;
  earthingPitLocationPhoto?: string;
  laLocationFinalized: boolean;
  laLocationPhoto?: string;
  terminationPointFinalized: boolean;
  terminationPointPhoto?: string;
  spareFeederAvailable: boolean;
  spareFeederPhoto?: string;
  dgEbInterconnection: boolean;
  dgEbInterconnectionPhoto?: string;
  spareFeederRating?: string;
  spareFeederRatingPhoto?: string;
  
  // Electrical Connectivity
  existingMeterDetails?: string;
  phaseType?: 'Single Phase' | 'Three Phase';
  connectedLoad?: string;
  sanctionedLoad?: string;
  
  // AC Routing
  acCableRoutingFinalized?: boolean;
  acCableRoutingPhoto?: string;

  // Deviations & Special Requirements
  deviations: boolean;
  specialToolsRequired?: string;
  deviationDetails?: {
    general?: string;
    additionalPanels?: string;
    additionalInverter?: string;
    routingChanges?: string;
    cableSizeChanges?: string;
    otherRequests?: string;
  };
  clientSignature?: string;
  engineerSignature?: string;
  photos?: string[];
  submitted?: boolean;
  submittedAt?: string;
}

export interface BOIItem {
  id: string;
  category: string;
  description: string;
  make: string;
  quantity: number;
  unit: string;
  status: BOIStatus;
  rate: number;
  gst: number;
  vendor?: string;
  price?: number;
  total?: number;
}

export interface DailyLog {
  id: string;
  date: string;
  activity: string;
  doneBy: string;
  remarks: string;
}

export interface ExecutionTask {
  id: string;
  category: string;
  title: string;
  assignedTo?: string;
  assignedDate?: string;
  actionDate?: string;
  status: 'Open' | 'In Progress' | 'Closed';
  doneBy?: string;
  remarks?: string;
  dailyLogs?: DailyLog[];
}

export interface Expense {
  id: string;
  category: 'Travel & Allowance' | 'Food & Accommodation' | 'Local Expenses' | 'Material Purchase' | 'Transport' | 'Others';
  description: string;
  engineerName: string;
  voucherNo: string;
  amount: number;
  status: 'Draft' | 'Pending Verification' | 'Verified' | 'Approved' | 'Processed';
  supportingDoc?: string;
}

export interface QualityCheck {
  inspectionDate: string;
  checkedBy: string;
  panelSecure: boolean;
  tiltAngle: boolean;
  noPhysicalDamage: boolean;
  panelsClean: boolean;
  structureAligned: boolean;
  boltsTightened: boolean;
  corrosionProtection: boolean;
  earthingCompleted: boolean;
  cableRouting: boolean;
  mc4Fixed: boolean;
  noExposedWires: boolean;
  insulationIntact: boolean;
  inverterInstalled: boolean;
  displayFunctioning: boolean;
  errorFree: boolean;
  ventilation: boolean;
  earthingResistance: boolean;
  laInstalled: boolean;
  spdInstalled: boolean;
  groundingConnections: boolean;
  batteryInstalled?: boolean;
  batteryTerminals?: boolean;
  batteryNoLeakage?: boolean;
  batteryVentilation?: boolean;
  systemGenerating: boolean;
  voltageLimits: boolean;
  monitoringWorking: boolean;
  monitoringCredentials?: string;
  warningSigns: boolean;
  fireExtinguisher: boolean;
  siteClean: boolean;
  remarks: string;
  status: 'Approved' | 'Rework Required';
  photos?: { [key: string]: string };
}

export interface Milestone {
  completed: boolean;
  date?: string;
  completedBy?: string;
  document?: string;
}

export interface Liasonning {
  tneb: {
    docsCollected: Milestone;
    registration: Milestone;
    estimatePaid: Milestone;
    inspectionArranged: Milestone;
    netmeterInstalled: Milestone;
  };
  ceig: {
    docsCollected: Milestone;
    registration: Milestone;
    estimatePaid: Milestone;
    drawingApproved: Milestone;
    inspectionArranged: Milestone;
    drRrReceived: Milestone;
    finalApproval: Milestone;
  };
}

export interface CommissioningReport {
  date: string;
  epcContractor: string;
  systemOverview: {
    type: SystemType;
    moduleType: string;
    inverterModel: string;
    mountingType: string;
    numModules: number;
    numInverters: number;
  };
  installationDetails: {
    tiltAngle: number;
    orientation: string;
    structureType: string;
    cableSize: string;
    earthingDetails: string;
  };
  preCommissioningChecks: { [key: string]: boolean };
  tests: {
    stringVoc: number;
    stringIsc: number;
    insulationResistance: number;
    polarityCheck: boolean;
    outputVoltage: number;
    frequency: number;
    phaseSequence: boolean;
    earthingResistance: number;
  };
  inverterCommissioning: {
    startup: boolean;
    gridSync: boolean;
    parametersConfigured: boolean;
    faultStatus?: string;
  };
  performance: {
    initialPower: number;
    expectedPower: number;
    performanceRatio?: number;
    monitoringWorking: boolean;
  };
  clientSignature?: string;
  engineerSignature?: string;
  monitoringLogin?: string;
  monitoringPassword?: string;
  monitoringLink?: string;
  remarks?: string;
  declaration?: boolean;
}

export interface ServiceRecord {
  id: string;
  projectName: string;
  description: string;
  createDate: string;
  assignedTo: string;
  actionDate: string;
  status: 'Open' | 'Closed' | 'In Progress';
  doneBy: string;
  amount: number;
  remarks: string;
}

export interface AMCRecord {
  id: string;
  projectName: string;
  type: string;
  category: 'Free AMC' | 'Paid AMC';
  assignedTo: string;
  actionDate: string;
  doneBy: string;
  amount: number;
  reportUrl?: string;
}
