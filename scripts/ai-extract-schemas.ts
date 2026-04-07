/**
 * Phase 3: Zod schemas for AI-extracted document data
 *
 * These schemas validate Claude's structured output before DB insertion.
 * Fill-gaps-only merge: only populate fields that are currently NULL/empty.
 */

import { z } from 'zod';

// ─── Proposal Document Schema (Word docs, PDFs, PPTX) ───

export const ProposalDocSchema = z.object({
  customer_name: z.string().optional(),
  customer_phone: z.string().regex(/^[6-9][0-9]{9}$/).optional(),
  customer_email: z.string().email().optional(),
  customer_address: z.object({
    line1: z.string(),
    city: z.string(),
    state: z.string(),
    pincode: z.string().regex(/^[1-9][0-9]{5}$/),
  }).optional(),
  system_size_kwp: z.number().positive().optional(),
  system_type: z.enum(['on_grid', 'hybrid', 'off_grid']).optional(),
  panel: z.object({
    brand: z.string(),
    model: z.string().optional(),
    wattage: z.number().positive(),
    count: z.number().int().positive(),
  }).optional(),
  inverter: z.object({
    brand: z.string(),
    model: z.string().optional(),
    capacity_kw: z.number().positive().optional(),
  }).optional(),
  structure_type: z.string().optional(),
  total_cost: z.number().positive().optional(),
  gst_amount: z.number().nonnegative().optional(),
  payment_schedule: z.array(z.object({
    milestone: z.string(),
    percentage: z.number().min(0).max(100).optional(),
    amount: z.number().positive().optional(),
  })).optional(),
  annual_generation_kwh: z.number().positive().optional(),
  tariff_rate: z.number().positive().optional(),
  annual_savings_inr: z.number().positive().optional(),
  payback_years: z.number().positive().optional(),
  electricity_board: z.string().optional(),
  sanctioned_load_kw: z.number().positive().optional(),
  connection_type: z.enum(['single_phase', 'three_phase']).optional(),
  roof_type: z.string().optional(),
  roof_area_sqft: z.number().positive().optional(),
});

export type ProposalDoc = z.infer<typeof ProposalDocSchema>;

// ─── Vendor Document Schema (PO PDFs, invoices, delivery challans) ───

export const VendorDocSchema = z.object({
  vendor_name: z.string().optional(),
  vendor_phone: z.string().regex(/^[6-9][0-9]{9}$/).optional(),
  vendor_email: z.string().email().optional(),
  vendor_gstin: z.string().regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/).optional(),
  vendor_pan: z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/).optional(),
  vendor_address: z.string().optional(),
  is_msme: z.boolean().optional(),
  document_type: z.enum(['purchase_order', 'invoice', 'delivery_challan', 'quotation', 'other']).optional(),
  amount: z.number().positive().optional(),
  po_number: z.string().optional(),
  invoice_number: z.string().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export type VendorDoc = z.infer<typeof VendorDocSchema>;

// ─── Photo Tag Schema (Claude vision output) ───

export const PhotoTagSchema = z.object({
  content_type: z.enum([
    'roof_survey', 'panel_installation', 'structure_installation',
    'electrical_work', 'inverter_setup', 'earthing', 'completed_system',
    'before_installation', 'site_overview', 'close_up_detail',
    'meter_reading', 'cable_routing', 'safety_equipment', 'team_onsite',
  ]),
  structure_type: z.enum([
    'flat_rcc', 'sloped_rcc', 'elevated_ms', 'ground_mount',
    'carport', 'tin_sheet', 'railing_mount', 'wall_mount', 'unknown',
  ]).optional(),
  roof_type: z.enum([
    'flat_rcc', 'sloped_tile', 'tin_sheet', 'metal_deck',
    'asbestos', 'concrete_slab', 'unknown',
  ]).optional(),
  panel_orientation: z.enum(['portrait', 'landscape', 'mixed', 'not_visible']).optional(),
  building_type: z.enum([
    'individual_house', 'apartment', 'factory', 'warehouse',
    'office', 'school', 'hospital', 'other',
  ]).optional(),
  segment: z.enum(['residential', 'commercial', 'industrial']).optional(),
  estimated_panel_count: z.number().int().nonnegative().optional(),
  caption: z.string(),
  photo_quality: z.enum(['good', 'fair', 'poor']),
});

export type PhotoTag = z.infer<typeof PhotoTagSchema>;
