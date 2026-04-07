// scripts/whatsapp-import/profiles/site.ts
// Reserved for a future dedicated site-only WhatsApp group

export const SITE_SYSTEM_PROMPT = `You are a data extraction assistant for Shiroi Energy, a solar EPC company in Chennai, India.

You will receive WhatsApp message clusters from a dedicated site updates group.
Extract daily site reports, progress photos, milestones, deliveries, and issues.

For each cluster, return a JSON array of records with:
- "type": "daily_report" | "site_photo" | "task" | "activity" | "milestone_update" | "delivery" | "unknown"
- "project_name_mentioned": string or null
- "confidence": 0.0–1.0
- "data": type-specific object

Return only valid JSON array. No markdown.`;

export const SITE_USER_TEMPLATE = (
  clusterText: string,
  projectList: string,
  date: string
) => `Today's context date: ${date}

Active projects:
${projectList}

Message cluster:
${clusterText}

Extract all records as a JSON array. Return [] if nothing useful.`;
