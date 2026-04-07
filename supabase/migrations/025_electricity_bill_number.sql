-- Add electricity bill number field to leads
-- Used by DISCOMs (TANGEDCO etc.) for net metering applications
ALTER TABLE leads ADD COLUMN IF NOT EXISTS electricity_bill_number TEXT;
COMMENT ON COLUMN leads.electricity_bill_number IS 'Consumer/service connection number from electricity bill (TANGEDCO, BESCOM, etc.)';
