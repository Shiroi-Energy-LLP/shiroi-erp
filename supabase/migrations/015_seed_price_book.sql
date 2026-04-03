-- Migration 015: Seed price book with FY 2025-26 Shiroi pricing
-- Source: Latest BOM patterns from 2025-26 proposals (PV300-PV346 series)
-- These are starting rates — founder can update via ERP price book management screen

-- ═══════════════════════════════════════════════════════════════════════
-- PRICE BOOK ITEMS
-- ═══════════════════════════════════════════════════════════════════════

-- Solar Panels (supply, 12% GST effective rate but classified as 5% for rooftop under MNRE)
INSERT INTO price_book (item_category, item_description, brand, model, specification, unit, base_price, gst_type, gst_rate, hsn_code, is_active) VALUES
  ('panel', 'Waaree 545W Bifacial Mono PERC', 'Waaree', 'WS-545', '545Wp', 'nos', 15800.00, 'supply', 12.00, '85414011', true),
  ('panel', 'Adani 540W Mono PERC', 'Adani', 'ASP-540', '540Wp', 'nos', 15500.00, 'supply', 12.00, '85414011', true),
  ('panel', 'Trina 550W Vertex S+', 'Trina', 'TSM-550', '550Wp', 'nos', 16200.00, 'supply', 12.00, '85414011', true),
  ('panel', 'Jinko 545W Tiger Neo', 'Jinko', 'JKM-545N', '545Wp', 'nos', 16000.00, 'supply', 12.00, '85414011', true);

-- Inverters — On-Grid String
INSERT INTO price_book (item_category, item_description, brand, model, specification, unit, base_price, gst_type, gst_rate, hsn_code, is_active) VALUES
  ('inverter', 'Sungrow 5kW On-Grid', 'Sungrow', 'SG5.0RT', '5kW', 'nos', 42000.00, 'supply', 12.00, '85044090', true),
  ('inverter', 'Sungrow 10kW On-Grid', 'Sungrow', 'SG10RT', '10kW', 'nos', 78000.00, 'supply', 12.00, '85044090', true),
  ('inverter', 'Sungrow 15kW On-Grid', 'Sungrow', 'SG15RT', '15kW', 'nos', 105000.00, 'supply', 12.00, '85044090', true),
  ('inverter', 'Sungrow 20kW On-Grid', 'Sungrow', 'SG20RT', '20kW', 'nos', 135000.00, 'supply', 12.00, '85044090', true),
  ('inverter', 'Sungrow 25kW On-Grid', 'Sungrow', 'SG25CX', '25kW', 'nos', 160000.00, 'supply', 12.00, '85044090', true),
  ('inverter', 'Growatt 5kW On-Grid', 'Growatt', 'MIN 5000TL-X', '5kW', 'nos', 38000.00, 'supply', 12.00, '85044090', true),
  ('inverter', 'Growatt 10kW On-Grid', 'Growatt', 'MID 10KTL3-X', '10kW', 'nos', 72000.00, 'supply', 12.00, '85044090', true);

-- Inverters — Hybrid
INSERT INTO price_book (item_category, item_description, brand, model, specification, unit, base_price, gst_type, gst_rate, hsn_code, is_active) VALUES
  ('inverter', 'Sungrow 5kW Hybrid', 'Sungrow', 'SH5.0RT', '5kW Hybrid', 'nos', 85000.00, 'supply', 12.00, '85044090', true),
  ('inverter', 'Sungrow 10kW Hybrid', 'Sungrow', 'SH10RT', '10kW Hybrid', 'nos', 145000.00, 'supply', 12.00, '85044090', true),
  ('inverter', 'Growatt 5kW Hybrid', 'Growatt', 'SPH 5000', '5kW Hybrid', 'nos', 78000.00, 'supply', 12.00, '85044090', true);

-- Batteries
INSERT INTO price_book (item_category, item_description, brand, model, specification, unit, base_price, gst_type, gst_rate, hsn_code, is_active) VALUES
  ('battery', 'Sungrow SBR 5.12kWh LFP', 'Sungrow', 'SBR064', '5.12kWh', 'nos', 185000.00, 'supply', 12.00, '85076000', true),
  ('battery', 'Sungrow SBR 10.24kWh LFP', 'Sungrow', 'SBR128', '10.24kWh', 'nos', 340000.00, 'supply', 12.00, '85076000', true),
  ('battery', 'Growatt APX 5.12kWh LFP', 'Growatt', 'APX 5.0P', '5.12kWh', 'nos', 165000.00, 'supply', 12.00, '85076000', true);

-- Mounting Structure (works contract, 18% GST)
INSERT INTO price_book (item_category, item_description, brand, model, specification, unit, base_price, gst_type, gst_rate, hsn_code, is_active) VALUES
  ('structure', 'GI Flush Mount Structure per kWp', NULL, NULL, 'Hot-dip galvanized, IS 2062 Grade E250', 'kw', 7500.00, 'works_contract', 18.00, '73089090', true),
  ('structure', 'Aluminium Elevated Structure per kWp', NULL, NULL, 'Anodized aluminium, 3m elevation', 'kw', 9500.00, 'works_contract', 18.00, '76109090', true);

-- DC Cable
INSERT INTO price_book (item_category, item_description, brand, model, specification, unit, base_price, gst_type, gst_rate, hsn_code, is_active) VALUES
  ('dc_cable', 'DC Solar Cable 4sq mm per kWp', 'Polycab', 'XLPE 4sq', '4 sq mm, UV resistant', 'kw', 2800.00, 'supply', 18.00, '85446090', true),
  ('dc_cable', 'DC Solar Cable 6sq mm per kWp', 'Polycab', 'XLPE 6sq', '6 sq mm, UV resistant', 'kw', 3200.00, 'supply', 18.00, '85446090', true);

-- AC Cable
INSERT INTO price_book (item_category, item_description, brand, model, specification, unit, base_price, gst_type, gst_rate, hsn_code, is_active) VALUES
  ('ac_cable', 'AC Cable 3-core per kWp', 'Polycab', 'FRLS 3C', '3C x 2.5 sq mm FRLS', 'kw', 1800.00, 'supply', 18.00, '85446090', true);

-- Conduit & Accessories
INSERT INTO price_book (item_category, item_description, brand, model, specification, unit, base_price, gst_type, gst_rate, hsn_code, is_active) VALUES
  ('conduit', 'PVC Conduit + Cable Tray per kWp', NULL, NULL, '25mm PVC conduit + perforated tray', 'kw', 1200.00, 'supply', 18.00, '39172990', true);

-- Earthing
INSERT INTO price_book (item_category, item_description, brand, model, specification, unit, base_price, gst_type, gst_rate, hsn_code, is_active) VALUES
  ('earthing', 'Lightning Arrestor + Earthing Kit', NULL, NULL, 'LA + 2 earth pits, copper bonded rods', 'lumpsum', 18000.00, 'works_contract', 18.00, '85351000', true);

-- ACDB / DCDB
INSERT INTO price_book (item_category, item_description, brand, model, specification, unit, base_price, gst_type, gst_rate, hsn_code, is_active) VALUES
  ('acdb', 'ACDB Panel (up to 10kW)', NULL, NULL, 'MCB, SPD, isolator, IP65 enclosure', 'nos', 5500.00, 'supply', 18.00, '85372000', true),
  ('acdb', 'ACDB Panel (10-25kW)', NULL, NULL, 'MCCB, SPD, isolator, IP65 enclosure', 'nos', 8500.00, 'supply', 18.00, '85372000', true),
  ('dcdb', 'DCDB Panel (up to 10kW)', NULL, NULL, 'DC fuse, SPD, DC isolator, IP65', 'nos', 4500.00, 'supply', 18.00, '85372000', true),
  ('dcdb', 'DCDB Panel (10-25kW)', NULL, NULL, 'DC fuse, SPD, DC isolator, IP65', 'nos', 7000.00, 'supply', 18.00, '85372000', true);

-- Net Metering + Liaison
INSERT INTO price_book (item_category, item_description, brand, model, specification, unit, base_price, gst_type, gst_rate, hsn_code, is_active) VALUES
  ('net_meter', 'TNEB Net Metering + Liaison (Residential)', NULL, NULL, 'Application, CEIG, meter, inspection', 'lumpsum', 25000.00, 'works_contract', 18.00, '99833', true),
  ('net_meter', 'TNEB Net Metering + Liaison (Commercial)', NULL, NULL, 'Application, CEIG, meter, inspection, load study', 'lumpsum', 45000.00, 'works_contract', 18.00, '99833', true);

-- Civil Works
INSERT INTO price_book (item_category, item_description, brand, model, specification, unit, base_price, gst_type, gst_rate, hsn_code, is_active) VALUES
  ('civil_work', 'Foundation + Waterproofing per kWp', NULL, NULL, 'RCC pedestal / channel base + Dr Fixit', 'kw', 3500.00, 'works_contract', 18.00, '99543', true);

-- Installation Labour
INSERT INTO price_book (item_category, item_description, brand, model, specification, unit, base_price, gst_type, gst_rate, hsn_code, is_active) VALUES
  ('installation_labour', 'Installation Labour per kWp (Residential)', NULL, NULL, 'Panel mounting, wiring, testing, commissioning', 'kw', 4500.00, 'works_contract', 18.00, '99833', true),
  ('installation_labour', 'Installation Labour per kWp (Commercial)', NULL, NULL, 'Panel mounting, wiring, testing, commissioning', 'kw', 4000.00, 'works_contract', 18.00, '99833', true);

-- Transport
INSERT INTO price_book (item_category, item_description, brand, model, specification, unit, base_price, gst_type, gst_rate, hsn_code, is_active) VALUES
  ('transport', 'Material Transport (within Chennai)', NULL, NULL, 'Pickup + crane charges', 'lumpsum', 8000.00, 'works_contract', 18.00, '99679', true),
  ('transport', 'Material Transport (outstation TN)', NULL, NULL, 'Truck + crane, up to 200km', 'lumpsum', 15000.00, 'works_contract', 18.00, '99679', true);

-- ═══════════════════════════════════════════════════════════════════════
-- BOM CORRECTION FACTORS (initial estimates, will auto-update from actuals)
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO bom_correction_factors (item_category, system_type, segment, correction_factor, data_points_count, is_active) VALUES
  -- Generic factors (apply to all system_type + segment combos)
  ('panel',               NULL, NULL, 1.0000, 0, true),
  ('inverter',            NULL, NULL, 1.0000, 0, true),
  ('battery',             NULL, NULL, 1.0000, 0, true),
  ('structure',           NULL, NULL, 1.0850, 0, true),  -- structures tend to run 8.5% over estimate
  ('dc_cable',            NULL, NULL, 1.0500, 0, true),  -- cabling 5% buffer
  ('ac_cable',            NULL, NULL, 1.0500, 0, true),
  ('conduit',             NULL, NULL, 1.0500, 0, true),
  ('earthing',            NULL, NULL, 1.0000, 0, true),
  ('acdb',                NULL, NULL, 1.0000, 0, true),
  ('dcdb',                NULL, NULL, 1.0000, 0, true),
  ('net_meter',           NULL, NULL, 1.0000, 0, true),
  ('civil_work',          NULL, NULL, 1.1000, 0, true),  -- civil work 10% buffer
  ('installation_labour', NULL, NULL, 1.0500, 0, true),  -- labour 5% buffer
  ('transport',           NULL, NULL, 1.0000, 0, true);
