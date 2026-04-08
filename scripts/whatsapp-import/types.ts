// scripts/whatsapp-import/types.ts

export type ChatProfile = 'marketing' | 'llp' | 'shiroi_energy' | 'site';

export interface RawMessage {
  timestamp: Date;
  sender: string;
  text: string;
  attachedMedia: string[];   // filenames from the ZIP
  isDeleted: boolean;
}

export interface MessageCluster {
  id: string;                // hash of first message in cluster
  profile: ChatProfile;
  startTime: Date;
  endTime: Date;
  sender: string;
  messages: RawMessage[];
  combinedText: string;      // all message texts joined with \n
  mediaFiles: string[];      // all media across the cluster
}

export type ExtractionType =
  | 'customer_payment'
  | 'vendor_payment'
  | 'purchase_order'
  | 'boq_item'
  | 'task'
  | 'activity'
  | 'contact'
  | 'site_photo'
  | 'daily_report'
  | 'unknown';

export interface ProjectMatch {
  project_id: string | null;
  lead_id: string | null;
  matched_name: string | null;
  confidence: number;    // 0–1
}

export interface ExtractedRecord {
  extraction_type: ExtractionType;
  project_match: ProjectMatch;
  data: Record<string, unknown>;
  confidence: number;
  requires_finance_review: boolean;
}

export interface ClusterExtractionResult {
  cluster_id: string;
  records: ExtractedRecord[];
  raw_llm_response: string;
}

// What Claude returns per cluster (parsed from JSON)
export interface LLMExtractionResponse {
  records: Array<{
    type: ExtractionType;
    project_name_mentioned: string | null;
    confidence: number;
    data: Record<string, unknown>;
  }>;
}
