import { Project, ServiceRecord, AMCRecord } from './types';

export const mockProjects: Project[] = [
  {
    id: '1',
    clientId: 'CL001',
    name: 'Xyz Solar Project',
    systemSize: 10,
    location: 'Chennai',
    status: 'Completed',
    percentComplete: 100,
    startDate: '2026-10-10',
    endDate: '2026-10-10',
    remarks: 'Nil',
    contactName: 'John Doe',
    contactNumber: '9876543210',
    email: 'john@example.com',
    systemType: 'On Grid',
    mountingType: 'Elevated',
    mountingStructure: 'GI',
    scopeLA: 'Shiroi',
    scopeCivil: 'Shiroi',
    scopeStatutory: 'Shiroi',
    scopeCEIG: 'Shiroi',
    address: '123 Solar St, Chennai',
    mapLink: 'https://maps.google.com',
    budget: 500000,
    consideredMargin: 15,
    actualBudget: 480000,
    actualMargin: 18,
    boi: [
      { id: 'b1', category: 'Inverter', description: '10 kW On-Grid Three Phase Inverter', make: 'Deye', quantity: 2, unit: 'Nos', status: 'Received', rate: 44500, gst: 5, vendor: 'Festa Solar' },
      { id: 'b2', category: 'MMS', description: 'Supply of GI Elevated Structure', make: '—', quantity: 20, unit: 'kWp', status: 'Received', rate: 9500, gst: 12, vendor: 'Thanigai' }
    ],
    execution: [
      {
        id: 'e1',
        category: 'Site Visit',
        title: 'Initial site survey',
        assignedTo: 'Engineer A',
        assignedDate: '2026-10-01',
        actionDate: '2026-10-02',
        status: 'Closed',
        doneBy: 'Engineer A',
        remarks: 'Site is ready for installation',
        dailyLogs: [
          { id: 'l1', date: '2026-10-02', activity: 'Measured roof dimensions', doneBy: 'Engineer A', remarks: 'Good' }
        ]
      }
    ]
  },
  {
    id: '2',
    clientId: 'CL002',
    name: 'ABC Industries',
    systemSize: 50,
    location: 'Coimbatore',
    status: 'In Progress',
    percentComplete: 45,
    startDate: '2026-11-01',
    endDate: '2026-12-15',
    remarks: 'Awaiting panel delivery',
    contactName: 'Jane Smith',
    contactNumber: '9876543211',
    email: 'jane@abc.com',
    systemType: 'Hybrid',
    mountingType: 'Metal Shed',
    mountingStructure: 'Mini Rails',
    scopeLA: 'Client',
    scopeCivil: 'Shiroi',
    scopeStatutory: 'Shiroi',
    scopeCEIG: 'Shiroi',
    address: '456 Industrial Ave, Coimbatore',
    mapLink: 'https://maps.google.com',
    budget: 2500000,
    consideredMargin: 12,
    actualBudget: 2200000,
    actualMargin: 14,
    execution: [
      {
        id: 'e2',
        category: 'Design Approval',
        title: 'Finalize layout design',
        assignedTo: 'Engineer B',
        assignedDate: '2026-11-05',
        actionDate: '',
        status: 'In Progress',
        doneBy: '',
        remarks: 'Waiting for client feedback',
        dailyLogs: []
      }
    ]
  }
];

export const mockServices: ServiceRecord[] = [
  {
    id: 's1',
    projectName: 'Xyz Solar Project',
    description: 'Inverter cleaning and checkup',
    createDate: '2026-03-20',
    assignedTo: 'Engineer A',
    actionDate: '2026-03-22',
    status: 'Closed',
    doneBy: 'Engineer A',
    amount: 1500,
    remarks: 'All good'
  },
  {
    id: 's2',
    projectName: 'ABC Industries',
    description: 'Cable routing issue',
    createDate: '2026-03-24',
    assignedTo: 'Engineer B',
    actionDate: '2026-03-25',
    status: 'Open',
    doneBy: '',
    amount: 0,
    remarks: ''
  }
];

export const mockAMCs: AMCRecord[] = [
  {
    id: 'a1',
    projectName: 'Xyz Solar Project',
    type: 'Quarterly',
    category: 'Free AMC',
    assignedTo: 'Engineer C',
    actionDate: '2026-03-28',
    doneBy: '',
    amount: 0
  }
];
