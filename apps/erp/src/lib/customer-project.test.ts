import { describe, it, expect } from 'vitest';
import { formatCustomerProject } from './customer-project';

describe('formatCustomerProject', () => {
  it('company + project → em-dash label', () => {
    expect(
      formatCustomerProject({ companyName: 'Lancor Holdings', customerName: null, projectName: 'Tower A' }),
    ).toBe('Lancor Holdings — Tower A');
  });

  it('customer only (no company, no project) → customer name', () => {
    expect(
      formatCustomerProject({ companyName: null, customerName: 'Rajesh Kumar', projectName: null }),
    ).toBe('Rajesh Kumar');
  });

  it('customer + project (no company) → customer — project', () => {
    expect(
      formatCustomerProject({ companyName: null, customerName: 'Rajesh Kumar', projectName: 'Farmhouse' }),
    ).toBe('Rajesh Kumar — Farmhouse');
  });

  it('company name takes precedence over customer name as base', () => {
    expect(
      formatCustomerProject({ companyName: 'Lancor Holdings', customerName: 'Rajesh Kumar', projectName: 'Tower A' }),
    ).toBe('Lancor Holdings — Tower A');
  });

  it('company precedence — no project', () => {
    expect(
      formatCustomerProject({ companyName: 'Lancor Holdings', customerName: 'Rajesh Kumar', projectName: null }),
    ).toBe('Lancor Holdings');
  });

  it('null/undefined inputs → no stray dashes', () => {
    expect(
      formatCustomerProject({ companyName: null, customerName: null, projectName: null }),
    ).toBe('');
    expect(
      formatCustomerProject({ companyName: undefined, customerName: undefined, projectName: undefined }),
    ).toBe('');
  });

  it('whitespace-only inputs → treated as empty, no stray dashes', () => {
    expect(
      formatCustomerProject({ companyName: '   ', customerName: '  ', projectName: '  ' }),
    ).toBe('');
  });

  it('both base and project empty → empty string', () => {
    expect(
      formatCustomerProject({ companyName: '', customerName: '', projectName: '' }),
    ).toBe('');
  });

  it('project only (no base) → project name without dash', () => {
    expect(
      formatCustomerProject({ companyName: null, customerName: null, projectName: 'Tower A' }),
    ).toBe('Tower A');
  });
});
