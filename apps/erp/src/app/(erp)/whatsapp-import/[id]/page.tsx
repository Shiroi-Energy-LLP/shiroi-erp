import { notFound } from 'next/navigation';
import { getQueueItem } from '@/lib/whatsapp-import-queries';
import { approveQueueItem, rejectQueueItem } from '@/lib/whatsapp-import-actions';
import Link from 'next/link';

interface PageProps {
  params: Promise<{ id: string }>;
}

const PROFILE_LABELS: Record<string, string> = {
  marketing: 'Marketing',
  llp: 'LLP / Purchase',
  shiroi_energy: 'Shiroi Energy ⚡',
  site: 'Site',
};

export default async function QueueItemDetailPage({ params }: PageProps) {
  const { id } = await params;
  const item = await getQueueItem(id);
  if (!item) notFound();

  const data = item.extracted_data;
  const conf = item.confidence_score ?? 0;
  const confColor = conf >= 0.85 ? 'text-green-600 bg-green-50' : conf >= 0.60 ? 'text-yellow-600 bg-yellow-50' : 'text-red-600 bg-red-50';

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-4">
        <Link href="/whatsapp-import" className="text-sm text-blue-600 hover:underline">← Back to queue</Link>
      </div>

      <div className="bg-white border rounded-xl p-6 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">
              {item.extraction_type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {new Date(item.message_timestamp).toLocaleString('en-IN', {
                timeZone: 'Asia/Kolkata',
                day: '2-digit', month: 'short', year: 'numeric',
                hour: '2-digit', minute: '2-digit',
              })}
              {' · '}{item.sender_name}
              {' · '}{PROFILE_LABELS[item.chat_profile] ?? item.chat_profile}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${confColor}`}>
              {(conf * 100).toFixed(1)}% confidence
            </span>
            {item.requires_finance_review && (
              <span className="px-2 py-1 rounded-full text-xs font-bold bg-red-100 text-red-700">
                Finance Review Required
              </span>
            )}
          </div>
        </div>

        {/* Status banner */}
        {item.review_status !== 'pending' && (
          <div className={`rounded-lg px-4 py-3 text-sm font-medium ${
            item.review_status === 'auto_inserted' ? 'bg-blue-50 text-blue-700' :
            item.review_status === 'approved' ? 'bg-green-50 text-green-700' :
            'bg-red-50 text-red-700'
          }`}>
            {item.review_status === 'auto_inserted' && `✓ Auto-inserted into ${item.inserted_table}`}
            {item.review_status === 'approved' && `✓ Approved${item.inserted_table ? ` → ${item.inserted_table}` : ''}`}
            {item.review_status === 'rejected' && `✗ Rejected${item.review_notes ? ` — ${item.review_notes}` : ''}`}
            {item.reviewed_at && (
              <span className="opacity-75 ml-2 font-normal">
                {new Date(item.reviewed_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
              </span>
            )}
          </div>
        )}

        {/* Project match */}
        <div className="grid grid-cols-2 gap-4 pb-4 border-b">
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Project Match</p>
            <p className="text-sm font-medium text-gray-900">
              {item.matched_project_name ?? <span className="text-red-400 italic font-normal">No match found</span>}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Match Type</p>
            <p className="text-sm text-gray-700">
              {item.matched_project_id ? 'Project' : item.matched_lead_id ? 'Lead' : 'None'}
            </p>
          </div>
        </div>

        {/* Raw message */}
        <div>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Original Message</p>
          <pre className="bg-gray-50 border rounded-lg p-3 text-sm text-gray-700 whitespace-pre-wrap font-sans leading-relaxed">
            {item.raw_message_text ?? '(no text)'}
          </pre>
          {(item.media_filenames?.length ?? 0) > 0 && (
            <p className="text-xs text-gray-400 mt-1.5">
              📎 {item.media_filenames?.join(', ')}
            </p>
          )}
        </div>

        {/* Extracted data */}
        <div>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Extracted Data</p>
          <div className="bg-gray-50 border rounded-lg divide-y divide-gray-100">
            {Object.entries(data).map(([key, value]) => (
              <div key={key} className="flex gap-3 px-4 py-2.5 text-sm">
                <span className="text-gray-400 font-medium min-w-[160px] text-xs">{key}</span>
                <span className="text-gray-800 break-all">
                  {typeof value === 'object' ? JSON.stringify(value) : String(value ?? '')}
                </span>
              </div>
            ))}
            {Object.keys(data).length === 0 && (
              <div className="px-4 py-3 text-sm text-gray-400 italic">No fields extracted</div>
            )}
          </div>
        </div>

        {/* Actions */}
        {item.review_status === 'pending' && (
          <div className="flex gap-3 pt-2 border-t">
            <form action={async () => {
              'use server';
              await approveQueueItem(id);
            }}>
              <button type="submit"
                className="px-5 py-2 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 transition-colors">
                ✓ Approve &amp; Insert
              </button>
            </form>
            <form action={async () => {
              'use server';
              await rejectQueueItem(id, 'Manually rejected');
            }}>
              <button type="submit"
                className="px-5 py-2 bg-white border border-red-200 text-red-600 text-sm font-semibold rounded-lg hover:bg-red-50 transition-colors">
                ✗ Reject
              </button>
            </form>
            <div className="flex-1" />
            <Link href="/whatsapp-import"
              className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors">
              Skip →
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
