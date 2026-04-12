// apps/erp/src/lib/qc-constants.ts
// QC inspection section definitions — shared between form, step, and PDF

export interface QcSectionDef {
  id: string;
  name: string;
  items: string[];
  optional?: boolean;
}

export const QC_SECTIONS: QcSectionDef[] = [
  {
    id: 'panel_installation',
    name: 'Panel Installation Check',
    items: [
      'Panels properly mounted and aligned',
      'Panel tilt angle verified as per design',
      'Panel surface clean and undamaged',
      'Module connections secure (MC4 connectors)',
    ],
  },
  {
    id: 'structure_mounting',
    name: 'Structure & Mounting',
    items: [
      'Structure bolts torqued to specification',
      'Structure aligned and leveled',
      'Clamps and mid-clamps properly tightened',
      'Waterproofing at roof penetration points',
    ],
  },
  {
    id: 'electrical_wiring',
    name: 'Electrical Wiring Check',
    items: [
      'DC cable routing as per design',
      'AC cable routing as per design',
      'Cable labels and markings in place',
      'Junction box connections secure',
    ],
  },
  {
    id: 'inverter',
    name: 'Inverter Check',
    items: [
      'Inverter mounted securely',
      'Ventilation clearance adequate',
      'DC isolator installed and functional',
      'AC isolator installed and functional',
    ],
  },
  {
    id: 'earthing_protection',
    name: 'Earthing & Protection',
    items: [
      'Earthing system continuity verified',
      'Lightning arrestor installed',
      'Surge protection device installed',
    ],
  },
  {
    id: 'battery',
    name: 'Battery Check (if applicable)',
    items: [
      'Battery mounted in ventilated area',
      'Battery connections torqued to spec',
      'BMS configured and functional',
      'Battery enclosure secured',
    ],
    optional: true,
  },
  {
    id: 'safety',
    name: 'Safety Check',
    items: [
      'Safety signage in place',
      'Fire extinguisher accessible',
      'Walkway clearances adequate',
    ],
  },
];

export type QcItemResult = {
  item: string;
  passed: boolean | null;
  remarks: string;
};

export type QcSectionResult = {
  id: string;
  name: string;
  items: QcItemResult[];
  /** Storage paths for section photos (uploaded to site-photos bucket) */
  photos?: string[];
};

export type QcProjectInfo = {
  project_number: string | null;
  customer_name: string | null;
  site_address: string | null;
  system_size_kwp: number | null;
  system_type: string | null;
};

export type QcChecklistData = {
  sections: QcSectionResult[];
  remarks: string;
  battery_applicable: boolean;
  /** Auto-populated project details + editable inspection metadata */
  project_info?: QcProjectInfo;
  installation_date?: string | null;
  checked_by?: string | null;
  inspection_date?: string | null;
};

export function buildInitialChecklist(batteryApplicable: boolean = false): QcChecklistData {
  return {
    sections: QC_SECTIONS
      .filter((s) => !s.optional || batteryApplicable)
      .map((s) => ({
        id: s.id,
        name: s.name,
        items: s.items.map((item) => ({ item, passed: null, remarks: '' })),
      })),
    remarks: '',
    battery_applicable: batteryApplicable,
  };
}
