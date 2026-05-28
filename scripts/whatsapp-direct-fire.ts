/**
 * Fire one WhatsApp template message directly to Meta Cloud API,
 * bypassing n8n. Binary-search diagnostic for the May-26 "n8n still
 * not firing" issue: if this script delivers, n8n is the culprit;
 * if it doesn't, the problem is Meta-side (token expired, template
 * paused, quota exhausted).
 *
 * Usage:
 *   pnpm tsx scripts/whatsapp-direct-fire.ts
 *   pnpm tsx scripts/whatsapp-direct-fire.ts +919999999999  # override recipient
 *
 * Required env (.env.local OR sourced from the droplet's .env):
 *   META_ACCESS_TOKEN     System User permanent token (long-lived)
 *   META_PHONE_NUMBER_ID  e.g. 1140448799143790 (from workflow JSONs)
 *   VIVEK_WHATSAPP        e.g. +919444414087 (recipient default)
 *
 * Template fired: erp_alert|en with 2 body params (matches every n8n
 * workflow). On success Meta returns {messaging_product, contacts:[...],
 * messages: [{id: "wamid..."}]}. Save the wamid -- you can later query
 * delivery status via the Meta Business Manager → Insights tab.
 */

import * as dotenv from 'dotenv';
import * as path from 'node:path';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const TOKEN = process.env.META_ACCESS_TOKEN;
const PHONE_NUMBER_ID = process.env.META_PHONE_NUMBER_ID ?? '1140448799143790';
const recipient = process.argv[2] ?? process.env.VIVEK_WHATSAPP;

if (!TOKEN) {
  console.error('Missing META_ACCESS_TOKEN in .env.local (copy from the droplet /opt/shiroi-automation/.env)');
  process.exit(1);
}
if (!recipient) {
  console.error('No recipient — pass as arg or set VIVEK_WHATSAPP in .env.local');
  process.exit(1);
}

const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

async function main() {
  const url = `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`;
  const body = {
    messaging_product: 'whatsapp',
    to: recipient,
    type: 'template',
    template: {
      name: 'erp_alert',
      language: { code: 'en' },
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: '🧪 WhatsApp direct-fire test (bypassed n8n)' },
            { type: 'text', text: `Fired ${now} UTC. If this arrived, n8n is the bottleneck.` },
          ],
        },
      ],
    },
  };

  console.log(`POST ${url}`);
  console.log(`  to:        ${recipient}`);
  console.log(`  template:  erp_alert|en (2 body params)`);
  console.log('');

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  console.log(`HTTP ${resp.status}`);
  console.log(text);

  if (!resp.ok) {
    process.exit(1);
  }

  const json = JSON.parse(text) as { messages?: Array<{ id: string }> };
  const wamid = json.messages?.[0]?.id;
  if (wamid) {
    console.log('');
    console.log(`✓ Accepted by Meta. wamid: ${wamid}`);
    console.log('  Watch your phone for the message in the next few seconds.');
    console.log('  If it never arrives despite this 200 OK, Meta is shadow-throttling --');
    console.log('  check Meta Business Manager → Insights → Quality rating.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
