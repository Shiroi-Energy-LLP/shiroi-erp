/**
 * Phase 3: Claude prompt templates for document extraction
 */

export const PROPOSAL_EXTRACTION_PROMPT = `You are extracting structured data from a solar energy proposal document by Shiroi Energy, a rooftop solar EPC company in Chennai, Tamil Nadu, India.

Extract ALL available information into the JSON schema below. Only include fields you are confident about. Omit uncertain fields rather than guessing.

**Key context:**
- Indian phone numbers are 10 digits starting with 6-9
- GSTIN format: 2-digit state + 5-letter PAN + 4-digit + 1-letter + 1Z + 1-check
- Amounts are in Indian Rupees (INR / ₹)
- System sizes in kWp (kilowatt peak)
- Common panel brands: Trina, Jinko, Canadian Solar, Adani, Vikram, Waaree, REC
- Common inverter brands: Sungrow, Growatt, ABB, Delta, Goodwe, Fronius, Huawei
- Electricity boards: TANGEDCO/TNEB (Tamil Nadu), BESCOM (Karnataka), KSEB (Kerala)
- Structure types: Elevated MS, Flat RCC, Ground Mount, Carport, Tin Sheet mount

Return ONLY valid JSON matching this schema:
{
  "customer_name": "string (full name)",
  "customer_phone": "string (10 digits, no prefix)",
  "customer_email": "string",
  "customer_address": { "line1": "string", "city": "string", "state": "string", "pincode": "string (6 digits)" },
  "system_size_kwp": number,
  "system_type": "on_grid" | "hybrid" | "off_grid",
  "panel": { "brand": "string", "model": "string", "wattage": number, "count": number },
  "inverter": { "brand": "string", "model": "string", "capacity_kw": number },
  "structure_type": "string",
  "total_cost": number (total project cost in INR),
  "gst_amount": number,
  "payment_schedule": [{ "milestone": "string", "percentage": number, "amount": number }],
  "annual_generation_kwh": number,
  "tariff_rate": number (per unit in INR),
  "annual_savings_inr": number,
  "payback_years": number,
  "electricity_board": "string",
  "sanctioned_load_kw": number,
  "connection_type": "single_phase" | "three_phase",
  "roof_type": "string",
  "roof_area_sqft": number
}

Document text follows:
---
`;

export const VENDOR_EXTRACTION_PROMPT = `You are extracting vendor and document information from a purchase order, invoice, or delivery challan for solar equipment procurement.

The documents are from Shiroi Energy Private Limited (a solar EPC company in Chennai, India) dealing with various solar equipment vendors.

Extract ALL available vendor and document information into JSON. Only include fields you are confident about.

**Key context:**
- Indian GSTIN: 2-digit state code + 5-letter PAN + 4-digit + 1-letter + "Z" + 1 check digit (e.g., 33AABCS1234Z1Z5)
- PAN: 5 letters + 4 digits + 1 letter (e.g., AABCS1234Z)
- MSME/Udyam registration number format: UDYAM-XX-00-0000000
- Amounts in INR

Return ONLY valid JSON:
{
  "vendor_name": "string",
  "vendor_phone": "string (10 digits)",
  "vendor_email": "string",
  "vendor_gstin": "string (15 chars)",
  "vendor_pan": "string (10 chars)",
  "vendor_address": "string",
  "is_msme": boolean,
  "document_type": "purchase_order" | "invoice" | "delivery_challan" | "quotation" | "other",
  "amount": number,
  "po_number": "string",
  "invoice_number": "string",
  "date": "YYYY-MM-DD"
}

Document text follows:
---
`;

export const PHOTO_TAG_PROMPT = `You are analyzing a photo from a solar rooftop installation project by Shiroi Energy, a solar EPC company in Chennai, India.

Describe what you see and classify the photo. Be specific about the installation characteristics.

Return ONLY valid JSON:
{
  "content_type": "roof_survey" | "panel_installation" | "structure_installation" | "electrical_work" | "inverter_setup" | "earthing" | "completed_system" | "before_installation" | "site_overview" | "close_up_detail" | "meter_reading" | "cable_routing" | "safety_equipment" | "team_onsite",
  "structure_type": "flat_rcc" | "sloped_rcc" | "elevated_ms" | "ground_mount" | "carport" | "tin_sheet" | "railing_mount" | "wall_mount" | "unknown",
  "roof_type": "flat_rcc" | "sloped_tile" | "tin_sheet" | "metal_deck" | "asbestos" | "concrete_slab" | "unknown",
  "panel_orientation": "portrait" | "landscape" | "mixed" | "not_visible",
  "building_type": "individual_house" | "apartment" | "factory" | "warehouse" | "office" | "school" | "hospital" | "other",
  "segment": "residential" | "commercial" | "industrial",
  "estimated_panel_count": number (0 if not visible),
  "caption": "string (1-2 sentences describing what's in the photo, e.g. 'Completed 10kWp installation on flat RCC roof with elevated MS structure, portrait orientation, residential house')",
  "photo_quality": "good" | "fair" | "poor"
}
`;
