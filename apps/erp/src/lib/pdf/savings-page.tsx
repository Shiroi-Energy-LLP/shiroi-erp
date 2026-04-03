// apps/erp/src/lib/pdf/savings-page.tsx
// Segment-adaptive: residential = visual, commercial/industrial = numbers-first
import React from 'react';
import { View, Text } from '@react-pdf/renderer';
import { styles, BRAND } from './pdf-styles';
import { formatINR } from './proposal-pdf-data';
import type { ProposalPDFData } from './proposal-pdf-data';
import Decimal from 'decimal.js';

function shortINR(amount: number): string {
  if (amount >= 10_000_000) return `₹${(amount / 10_000_000).toFixed(1)} Cr`;
  if (amount >= 100_000) return `₹${(amount / 100_000).toFixed(1)} L`;
  if (amount >= 1_000) return `₹${(amount / 1_000).toFixed(0)}K`;
  return formatINR(amount);
}

interface SavingsCalc {
  year1Savings: number;
  year5Savings: number;
  year10Savings: number;
  year25Savings: number;
  cumulativeSavings25: number;
  co2AvoidedPerYear: number; // tonnes
  treesEquivalent: number;
}

function calculateSavings(sim: NonNullable<ProposalPDFData['simulation']>): SavingsCalc {
  const tariff = new Decimal(sim.tariffRate || 8); // default ₹8/kWh
  const escalation = new Decimal(sim.tariffEscalation || 3).div(100);
  const degradation = new Decimal(sim.degradationRate || 0.005);

  let cumulative = new Decimal(0);
  let year1 = new Decimal(0);
  let year5 = new Decimal(0);
  let year10 = new Decimal(0);
  let year25 = new Decimal(0);

  for (let y = 1; y <= 25; y++) {
    const yearKwh = new Decimal(sim.annualKwh).mul(new Decimal(1).sub(degradation).pow(y - 1));
    const yearTariff = tariff.mul(new Decimal(1).add(escalation).pow(y - 1));
    const yearSaving = yearKwh.mul(yearTariff);
    cumulative = cumulative.add(yearSaving);

    if (y === 1) year1 = yearSaving;
    if (y === 5) year5 = yearSaving;
    if (y === 10) year10 = yearSaving;
    if (y === 25) year25 = yearSaving;
  }

  // CO₂: India grid emission factor ~0.82 kg CO₂/kWh (CEA 2023)
  const co2PerYear = new Decimal(sim.annualKwh).mul('0.00082').toNumber(); // tonnes

  return {
    year1Savings: year1.round().toNumber(),
    year5Savings: year5.round().toNumber(),
    year10Savings: year10.round().toNumber(),
    year25Savings: year25.round().toNumber(),
    cumulativeSavings25: cumulative.round().toNumber(),
    co2AvoidedPerYear: co2PerYear,
    treesEquivalent: Math.round(co2PerYear * 45), // ~45 trees per tonne CO₂/year
  };
}

// ─── Residential: Visual Layout ───────────────────────────────────────

function ResidentialSavings({ data }: { data: ProposalPDFData }) {
  const sim = data.simulation;
  if (!sim) return <NoSimulationPlaceholder />;

  const calc = calculateSavings(sim);

  return (
    <View>
      {/* Big headline */}
      <View style={{ backgroundColor: BRAND.greenLight, padding: 20, borderRadius: 4, marginBottom: 16, textAlign: 'center' }}>
        <Text style={{ fontSize: 10, color: BRAND.gray500, marginBottom: 4 }}>
          Your system will save you
        </Text>
        <Text style={{ fontSize: 28, fontFamily: 'Helvetica-Bold', color: BRAND.green }}>
          {shortINR(calc.cumulativeSavings25)}
        </Text>
        <Text style={{ fontSize: 12, color: BRAND.gray700, marginTop: 4 }}>
          over 25 years
        </Text>
        <Text style={{ fontSize: 14, fontFamily: 'Helvetica-Bold', color: BRAND.black, marginTop: 8 }}>
          Paying for itself in {sim.paybackYears.toFixed(1)} years
        </Text>
      </View>

      {/* Monthly generation bar chart (simplified) */}
      <Text style={styles.h3}>Monthly Solar Generation (kWh)</Text>
      {sim.monthlyKwh && sim.monthlyKwh.length === 12 && (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', height: 80, marginTop: 8, marginBottom: 16 }}>
          {sim.monthlyKwh.map((kwh, i) => {
            const maxKwh = Math.max(...sim.monthlyKwh);
            const barHeight = maxKwh > 0 ? (kwh / maxKwh) * 60 : 0;
            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            return (
              <View key={i} style={{ alignItems: 'center', width: '7.5%' }}>
                <Text style={{ fontSize: 6, color: BRAND.gray500, marginBottom: 2 }}>{Math.round(kwh)}</Text>
                <View style={{ width: '80%', height: barHeight, backgroundColor: BRAND.green, borderRadius: 2 }} />
                <Text style={{ fontSize: 6, color: BRAND.gray500, marginTop: 2 }}>{months[i]}</Text>
              </View>
            );
          })}
        </View>
      )}

      {/* Savings milestones */}
      <Text style={styles.h3}>Year-by-Year Savings</Text>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8, marginBottom: 16 }}>
        {[
          { label: 'Year 1', value: calc.year1Savings },
          { label: 'Year 5', value: calc.year5Savings },
          { label: 'Year 10', value: calc.year10Savings },
          { label: 'Year 25', value: calc.year25Savings },
        ].map((item, i) => (
          <View key={i} style={styles.kpiCard}>
            <Text style={styles.kpiValue}>{shortINR(item.value)}</Text>
            <Text style={styles.kpiLabel}>Savings in {item.label}</Text>
          </View>
        ))}
      </View>

      {/* Environmental impact */}
      <Text style={styles.h3}>Environmental Impact</Text>
      <View style={{ flexDirection: 'row', gap: 16, marginTop: 8 }}>
        <View style={{ flex: 1, backgroundColor: BRAND.gray50, padding: 12, borderRadius: 4 }}>
          <Text style={{ fontSize: 16, fontFamily: 'Helvetica-Bold', color: BRAND.green }}>
            {calc.co2AvoidedPerYear.toFixed(1)} tonnes
          </Text>
          <Text style={styles.caption}>CO₂ avoided per year</Text>
        </View>
        <View style={{ flex: 1, backgroundColor: BRAND.gray50, padding: 12, borderRadius: 4 }}>
          <Text style={{ fontSize: 16, fontFamily: 'Helvetica-Bold', color: BRAND.green }}>
            {calc.treesEquivalent}
          </Text>
          <Text style={styles.caption}>Equivalent trees planted</Text>
        </View>
        <View style={{ flex: 1, backgroundColor: BRAND.gray50, padding: 12, borderRadius: 4 }}>
          <Text style={{ fontSize: 16, fontFamily: 'Helvetica-Bold', color: BRAND.green }}>
            {Math.round(sim.annualKwh).toLocaleString()} kWh
          </Text>
          <Text style={styles.caption}>Clean energy per year</Text>
        </View>
      </View>

      {/* Assumptions footnote */}
      <View style={{ marginTop: 16 }}>
        <Text style={{ fontSize: 7, color: BRAND.gray500 }}>
          * Assumptions: Tariff rate ₹{sim.tariffRate}/kWh, annual tariff escalation {sim.tariffEscalation}%, panel degradation {(sim.degradationRate * 100).toFixed(1)}%/year.
          Actual savings depend on consumption patterns and tariff changes.
        </Text>
      </View>
    </View>
  );
}

// ─── Commercial/Industrial: Numbers-First Layout ──────────────────────

function CommercialSavings({ data }: { data: ProposalPDFData }) {
  const sim = data.simulation;
  if (!sim) return <NoSimulationPlaceholder />;

  const calc = calculateSavings(sim);
  const roiPct = data.totalAfterDiscount > 0
    ? new Decimal(calc.cumulativeSavings25).sub(data.totalAfterDiscount).div(data.totalAfterDiscount).mul(100).toFixed(0)
    : '—';

  // Build financial table
  const years = [1, 5, 10, 15, 20, 25];
  const degradation = new Decimal(sim.degradationRate || 0.005);
  const tariff = new Decimal(sim.tariffRate || 8);
  const escalation = new Decimal(sim.tariffEscalation || 3).div(100);

  const rows = years.map(y => {
    const yearKwh = new Decimal(sim.annualKwh).mul(new Decimal(1).sub(degradation).pow(y - 1)).round().toNumber();
    const yearTariff = tariff.mul(new Decimal(1).add(escalation).pow(y - 1)).toDP(2).toNumber();
    const yearSaving = Math.round(yearKwh * yearTariff);

    let cumulative = 0;
    for (let i = 1; i <= y; i++) {
      const iKwh = new Decimal(sim.annualKwh).mul(new Decimal(1).sub(degradation).pow(i - 1));
      const iTariff = tariff.mul(new Decimal(1).add(escalation).pow(i - 1));
      cumulative += iKwh.mul(iTariff).round().toNumber();
    }

    return { year: y, kwh: yearKwh, tariff: yearTariff, savings: yearSaving, cumulative };
  });

  return (
    <View>
      {/* 4 KPI cards */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 }}>
        {[
          { label: 'Annual Generation', value: `${Math.round(sim.annualKwh).toLocaleString()} kWh` },
          { label: 'Annual Savings (Year 1)', value: shortINR(calc.year1Savings) },
          { label: 'Payback Period', value: `${sim.paybackYears.toFixed(1)} years` },
          { label: '25-Year Savings', value: shortINR(calc.cumulativeSavings25) },
        ].map((item, i) => (
          <View key={i} style={styles.kpiCard}>
            <Text style={styles.kpiValue}>{item.value}</Text>
            <Text style={styles.kpiLabel}>{item.label}</Text>
          </View>
        ))}
      </View>

      {/* ROI highlight */}
      <View style={{ backgroundColor: BRAND.greenLight, padding: 12, borderRadius: 4, marginBottom: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ fontSize: 11, fontFamily: 'Helvetica-Bold', color: BRAND.greenDark }}>
          Return on Investment (25 years)
        </Text>
        <Text style={{ fontSize: 20, fontFamily: 'Helvetica-Bold', color: BRAND.green }}>
          {roiPct}%
        </Text>
      </View>

      {/* Financial table */}
      <Text style={styles.h3}>Financial Projection</Text>
      <View style={styles.tableHeader}>
        <Text style={[styles.tableCellBold, { width: '12%' }]}>Year</Text>
        <Text style={[styles.tableCellBold, { width: '22%', textAlign: 'right' }]}>Generation (kWh)</Text>
        <Text style={[styles.tableCellBold, { width: '18%', textAlign: 'right' }]}>Tariff (₹/kWh)</Text>
        <Text style={[styles.tableCellBold, { width: '22%', textAlign: 'right' }]}>Annual Savings</Text>
        <Text style={[styles.tableCellBold, { width: '26%', textAlign: 'right' }]}>Cumulative Savings</Text>
      </View>
      {rows.map(row => (
        <View key={row.year} style={styles.tableRow}>
          <Text style={[styles.tableCell, { width: '12%' }]}>Year {row.year}</Text>
          <Text style={[styles.tableCellRight, { width: '22%' }]}>{row.kwh.toLocaleString()}</Text>
          <Text style={[styles.tableCellRight, { width: '18%' }]}>₹{row.tariff.toFixed(2)}</Text>
          <Text style={[styles.tableCellRight, { width: '22%' }]}>{formatINR(row.savings)}</Text>
          <Text style={[styles.tableCellRight, { width: '26%', fontFamily: row.year === 25 ? 'Helvetica-Bold' : 'Helvetica' }]}>
            {formatINR(row.cumulative)}
          </Text>
        </View>
      ))}

      {/* Assumptions footnote */}
      <View style={{ marginTop: 12 }}>
        <Text style={{ fontSize: 7, color: BRAND.gray500 }}>
          * Tariff: ₹{sim.tariffRate}/kWh (current), escalation {sim.tariffEscalation}%/yr. Degradation: {(sim.degradationRate * 100).toFixed(1)}%/yr.
          Generation based on PVWatts simulation for Chennai (13.08°N, 80.27°E). Actual results may vary.
        </Text>
      </View>
    </View>
  );
}

// ─── Fallback when no simulation data ─────────────────────────────────

function NoSimulationPlaceholder() {
  return (
    <View style={{ backgroundColor: BRAND.gray50, padding: 20, borderRadius: 4, textAlign: 'center' }}>
      <Text style={{ fontSize: 12, color: BRAND.gray500 }}>
        Savings projection will be available after the solar simulation is completed.
      </Text>
      <Text style={{ fontSize: 10, color: BRAND.gray500, marginTop: 4 }}>
        Contact Shiroi for a detailed analysis based on your electricity consumption.
      </Text>
    </View>
  );
}

// ─── Main Export ──────────────────────────────────────────────────────

export function SavingsPage({ data }: { data: ProposalPDFData }) {
  const isResidential = data.segment === 'residential';
  return isResidential ? <ResidentialSavings data={data} /> : <CommercialSavings data={data} />;
}
