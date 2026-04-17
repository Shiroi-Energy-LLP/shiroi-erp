// scripts/zoho-import/phase-04-contacts.ts
// Contacts.xls → merge into contacts table
// Strategy: exact GSTIN match → stamp zoho_contact_id
//           no GSTIN → fuzzy name match → stamp if ≥0.80 Jaccard
//           otherwise → skip (contacts are customer-facing and likely already in ERP)
//
// Note: we do NOT create new contacts from Zoho import because ERP contacts
// come from the lead/proposal flow. We only LINK existing contacts to Zoho IDs.
import { admin } from './supabase';
import { loadSheet, toStr } from './parse-xls';
import { emptyResult, PhaseResult } from './logger';
import { normalizeName, tokens, jaccard } from './normalize';

interface ZohoContactRow {
  'Contact ID': string | null;
  'Contact Name': string | null;
  'Display Name': string | null;
  'GST Identification Number (GSTIN)': string | null;
  'MobilePhone': string | null;
  'EmailID': string | null;
  'Contact Type': string | null;
}

export async function runPhase04(): Promise<PhaseResult> {
  const result = emptyResult('04-contacts');
  const dryRun = process.env.ZOHO_IMPORT_DRY_RUN === '1';

  const zohoRows = loadSheet<ZohoContactRow>('Contacts.xls');
  // Only customer contacts (not vendors — those go through phase-05)
  const customerRows = zohoRows.filter(r => {
    const ct = toStr(r['Contact Type']);
    return ct === 'customer' || ct === null;
  });
  console.log(`  ${customerRows.length} customer contacts in Contacts.xls`);

  // Load all ERP contacts with their names (contacts table has no gstin column)
  const { data: erpContacts, error: fetchErr } = await admin
    .from('contacts')
    .select('id, name, zoho_contact_id')
    .order('created_at');

  if (fetchErr) {
    result.errors.push({ row: 0, reason: 'fetch ERP contacts: ' + fetchErr.message });
    result.failed = customerRows.length;
    return result;
  }

  const erpList = erpContacts ?? [];

  for (let i = 0; i < customerRows.length; i++) {
    const zRow = customerRows[i];
    const zohoId = toStr(zRow['Contact ID']);
    if (!zohoId) { result.skipped++; continue; }

    const zohoName = toStr(zRow['Contact Name']) ?? toStr(zRow['Display Name']) ?? '';

    // Skip if already linked
    const alreadyLinked = erpList.find(c => c.zoho_contact_id === zohoId);
    if (alreadyLinked) { result.skipped++; continue; }

    let matchId: string | null = null;

    // Fuzzy name match (contacts table has no GSTIN; name is the only match vector)
    if (zohoName) {
      const zNorm = normalizeName(zohoName);
      const zTok = tokens(zNorm);
      let bestScore = 0;
      let bestId: string | null = null;
      for (const c of erpList) {
        const eTok = tokens(normalizeName(c.name ?? ''));
        const score = jaccard(zTok, eTok);
        if (score > bestScore) { bestScore = score; bestId = c.id; }
      }
      if (bestScore >= 0.80 && bestId) matchId = bestId;
    }

    if (!matchId) { result.skipped++; continue; }

    if (dryRun) {
      console.log(`  DRY RUN: would link contact ${zohoName} → ${matchId}`);
      result.skipped++;
      continue;
    }

    const { error: updErr } = await admin
      .from('contacts')
      .update({ zoho_contact_id: zohoId })
      .eq('id', matchId)
      .is('zoho_contact_id', null); // don't overwrite existing link

    if (updErr) {
      result.errors.push({ row: i, reason: updErr.message });
      result.failed++;
    } else {
      result.updated++;
      // update local cache so subsequent rows don't double-match
      const c = erpList.find(c => c.id === matchId);
      if (c) c.zoho_contact_id = zohoId;
    }
  }

  return result;
}
