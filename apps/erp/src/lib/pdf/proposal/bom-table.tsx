// apps/erp/src/lib/pdf/proposal/bom-table.tsx
// Role: Shared 14-row Technical Specification table (BOM).
//       Maps proposal BOM lines to the fixed rows Shiroi uses in real proposals.
//       Hardcoded fallbacks used when a specific BOM line is absent.
//       Row 14 (Net Metering & Liaison) only appears when a net_meter line
//       exists with scope_owner='shiroi'.
// Mode: shared (used by both detailed and quick proposals).
//       Title differs: "Technical Specification" (detailed) vs
//       "Parts Used and Specifications" (quick).
import React from 'react';
import { View, Text } from '@react-pdf/renderer';
import { BRAND } from '../pdf-styles';
import type { ProposalPDFData } from '../proposal-pdf-data';

function structureLabel(st: string | null): string {
  if (!st) return 'GI / Aluminium Min Rail';
  const map: Record<string, string> = {
    flush_mount: 'GI / Aluminium Flush Rail',
    elevated:    'GI / Aluminium Elevated Rail',
    high_rise:   'GI / Aluminium High Rise Rail',
  };
  return map[st] ?? 'GI / Aluminium Min Rail';
}

interface BomTableProps {
  data: ProposalPDFData;
  mode: 'quick' | 'detailed';
}

interface BomRow {
  sNo: number;
  label: string;
  value: string;
}

export function BomTable({ data, mode }: BomTableProps) {
  const { bomLines, systemSizeKwp, panelWattage, panelBrand, inverterCapacityKw, inverterBrand, customerCity, structureType } = data;

  // Helper: find first BOM line by category
  const findLine = (cat: string) => bomLines.find(l => l.category === cat) ?? null;

  const panelLine   = findLine('panel');
  const inverterLine = findLine('inverter');
  const netMeterLine = findLine('net_meter');

  const showNetMeter = !!netMeterLine && netMeterLine.scopeOwner === 'shiroi';

  // Build the 13 (or 14) rows
  const rows: BomRow[] = [
    {
      sNo: 1,
      label: 'System Size',
      value: `Total Capacity – ${systemSizeKwp} kW`,
    },
    {
      sNo: 2,
      label: 'Area Required for Installation',
      value: 'As per layout shared',
    },
    {
      sNo: 3,
      label: 'Location',
      value: customerCity ?? 'Chennai',
    },
    {
      sNo: 4,
      label: 'Mounting Structure Type',
      value: structureLabel(structureType),
    },
    {
      sNo: 5,
      label: 'PV (Photovoltaic) Module',
      value: panelLine
        ? `${panelLine.description}${panelLine.brand ? ` (${panelLine.brand})` : ''} 30 Years Warranty`
        : `${panelWattage ?? '600/620'} Wp Bifacial Solar module (${panelBrand ?? 'Premier/Adani'}) 30 Years Warranty`,
    },
    {
      sNo: 6,
      label: 'DC Cables',
      value: (() => {
        const l = findLine('dc_cable');
        return l ? `${l.description}${l.brand ? ` (${l.brand})` : ''}` : 'Siechem / Polycab / Orbit';
      })(),
    },
    {
      sNo: 7,
      label: 'AC Cable',
      value: (() => {
        const l = findLine('ac_cable');
        return l ? `${l.description}${l.brand ? ` (${l.brand})` : ''}` : 'Siechem / Polycab / Orbit';
      })(),
    },
    {
      sNo: 8,
      label: 'DC Combiner Box',
      value: (() => {
        const l = findLine('dcdb');
        return l ? l.description : 'IP 66 / IP 67 Rated Outdoor Electrical Box, 20A DC MCB';
      })(),
    },
    {
      sNo: 9,
      label: 'Inverter',
      value: inverterLine
        ? `${inverterLine.description}${inverterLine.brand ? ` (${inverterLine.brand})` : ''} (wifi monitoring enabled)`
        : `${inverterCapacityKw ?? systemSizeKwp} kW ${inverterBrand ?? 'Sungrow'} (wifi monitoring enabled)`,
    },
    {
      sNo: 10,
      label: 'ACDB',
      value: (() => {
        const l = findLine('acdb');
        return l ? l.description : '20A MCB and SPD';
      })(),
    },
    {
      sNo: 11,
      label: 'Earthing Accessories',
      value: (() => {
        const l = findLine('earthing');
        return l ? l.description : 'Cu Wire and copper bonded earth, 1 mtr length, 17.2 mm dia';
      })(),
    },
    {
      sNo: 12,
      label: 'Cable Routing Accessories',
      value: (() => {
        const l = findLine('conduit');
        return l ? l.description : 'Electrical UPVC';
      })(),
    },
    {
      sNo: 13,
      label: 'Lightning Arrestor',
      value: 'Copper LA with 4 prong',
    },
  ];

  if (showNetMeter) {
    rows.push({
      sNo: 14,
      label: 'Net Metering & Liaison',
      value: netMeterLine!.description,
    });
  }

  const title = mode === 'quick' ? 'Parts Used and Specifications' : 'Technical Specification';

  return (
    <View>
      <Text
        style={{
          fontSize: 18,
          fontFamily: 'Helvetica-Bold',
          color: BRAND.black,
          marginBottom: 12,
        }}
      >
        {title}
      </Text>

      {/* Table header */}
      <View
        style={{
          flexDirection: 'row',
          backgroundColor: BRAND.gray100,
          borderBottomWidth: 1,
          borderBottomColor: BRAND.gray300,
          paddingVertical: 5,
          paddingHorizontal: 6,
        }}
      >
        <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', width: '8%' }}>S. No</Text>
        <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', width: '92%' }}>
          SOLAR PV POWER PLANT
        </Text>
      </View>

      {rows.map((row, idx) => (
        <View
          key={row.sNo}
          style={{
            flexDirection: 'row',
            borderBottomWidth: 0.5,
            borderBottomColor: BRAND.gray300,
            paddingVertical: 5,
            paddingHorizontal: 6,
            backgroundColor: idx % 2 === 0 ? BRAND.white : BRAND.gray50,
          }}
        >
          <Text style={{ fontSize: 9, width: '8%', color: BRAND.gray500 }}>{row.sNo}</Text>
          <View style={{ width: '92%', flexDirection: 'row' }}>
            <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', width: '35%' }}>
              {row.label}
            </Text>
            <Text style={{ fontSize: 9, color: BRAND.gray700, width: '65%', flexWrap: 'wrap' }}>
              {row.value}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}
