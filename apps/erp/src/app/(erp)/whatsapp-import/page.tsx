import { getQueueItems, getQueueStats } from '@/lib/whatsapp-import-queries';
import Link from 'next/link';

export const metadata = { title: 'WhatsApp Import Queue' };

const PROFILE_LABELS: Record<string, string> = {
  marketing: 'Marketing',
  llp: 'LLP / Purchase',
  shiroi_energy: 'Shiroi Energy ⚡',
  site: 'Site',
};

const TYPE_CONFIG: Record<string, { label: string; color: string }> = {
  customer_payment: { label: 'Payment',      color: 'bg-green-100 text-green-800' },
  vendor_payment:   { label: 'Vendor Pay',   color: 'bg-red-100 text-red-800' },
  purchase_order:   { label: 'PO',           color: 'bg-orange-100 text-orange-800' },
  boq_item:         { label: 'BOQ Item',     color: 'bg-blue-100 text-blue-800' },
  task:             { label: 'Task',         color: 'bg-purple-100 text-purple-800' },
  activity:         { label: 'Activity',     color: 'bg-gray-100 text-gray-700' },
  contact:          { label: 'Contact',      color: 'bg-indigo-100 text-indigo-800' },
  site_photo:       { label: 'Photo',        color: 'bg-yellow-100 text-yellow-800' },
  daily_report:     { label: 'Daily Report', color: 'bg-teal-100 text-teal-800' },
  milestone_update: { label: 'Milestone',    color: 'bg-cyan-100 text-cyan-800' },
  delivery:         { label: 'Delivery',     color: 'bg-sky-100 text-sky-800' },
  unknown:          { label: 'Unknown',      color: 'bg-gray-100 text-gray-500' },
};

interface PageProps {
  searchParams: Promise<{ status?: string; profile?: string; type?: string; page?: string }>;
}

function extractSummary(data: Record<string, unknown>, type: string): string {
  switch (type) {
    case 'customer_payment':
    case 'vendor_payment':
      if (data['amount']) return `₹${Number(data['amount']).toLocaleString('en-IN')}`;
      return 'Payment';
    case 'task':
      return String(data['title'] ?? 'Task').slice(0, 60);
    case 'activity':
      return String(data['title'] ?? data['body'] ?? 'Activity').slice(0, 60);
    case 'purchase_order':
      return String(data['po_number'] ?? data['pdf_filename'] ?? 'PO').slice(0, 60);
    case 'boq_item':
      return String(data['item_description'] ?? 'BOQ item').slice(0, 60);
    case 'contact':
      return `${data['name'] ?? ''} ${data['phone'] ?? ''}`.trim().slice(0, 60);
    case 'daily_report':
      return String(data['work_description'] ?? 'Daily report').slice(0, 60);
    case 'milestone_update':
      return String(data['milestone_name'] ?? 'Milestone').slice(0, 60);
    case 'delivery':
      return String(data['item_description'] ?? 'Delivery').slice(0, 60);
    default:
      return JSON.stringify(data).slice(0, 60);
  }
}

export default async function WhatsAppImportPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const status = params.status ?? 'pending';
  const profile = params.profile;
  const type = params.type;
  const page = Number(params.page ?? 1);
  const pageSize = 50;

  const [{ items, total }, stats] = await Promise.all([
    getQueueItems({ status, profile, type, page, pageSize }),
    getQueueStats(),
  ]);

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">WhatsApp Import Queue</h1>
        <p className="text-sm text-gray-500 mt-1">
          Review extracted records before they enter the database. Finance records always require manual review.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
        {[
          { label: 'Pending Review', value: stats.pending, color: 'text-orange-600' },
          { label: 'Finance Review', value: stats.pending_finance, color: 'text-red-600' },
          { label: 'Auto-Inserted', value: stats.auto_inserted, color: 'text-green-600' },
          { label: 'Approved', value: stats.approved, color: 'text-blue-600' },
          { label: 'Rejected', value: stats.rejected, color: 'text-gray-500' },
        ].map(s => (
          <div key={s.label} className="bg-white border rounded-lg p-4">
            <div className={`text-2xl font-bold ${s.color}`}>{s.value.toLocaleString()}</div>
            <div className="text-xs text-gray-500 mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* By-profile breakdown */}
      {Object.keys(stats.by_profile).length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {Object.entries(stats.by_profile).map(([p, count]) => (
            <Link key={p} href={`/whatsapp-import?profile=${p}`}
              className="px-3 py-1 text-xs rounded-full bg-indigo-50 text-indigo-700 font-medium hover:bg-indigo-100">
              {PROFILE_LABELS[p] ?? p} ({count})
            </Link>
          ))}
        </div>
      )}

      {/* By-type breakdown */}
      {Object.keys(stats.by_type).length > 0 && (
        <div className="flex flex-wrap gap-2 mb-5">
          {Object.entries(stats.by_type).sort((a, b) => b[1] - a[1]).map(([t, count]) => {
            const cfg = TYPE_CONFIG[t] ?? { label: t, color: 'bg-gray-100 text-gray-600' };
            return (
              <Link key={t} href={`/whatsapp-import?type=${t}`}
                className={`px-3 py-1 text-xs rounded-full font-medium hover:opacity-80 ${cfg.color}`}>
                {cfg.label} ({count})
              </Link>
            );
          })}
        </div>
      )}

      {/* Status filter tabs */}
      <div className="flex gap-2 mb-4 border-b pb-3">
        {(['pending', 'auto_inserted', 'approved', 'rejected'] as const).map(s => (
          <Link key={s} href={`/whatsapp-import?status=${s}`}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              status === s
                ? 'bg-blue-600 text-white'
                : 'text-gray-600 hover:bg-gray-100'
            }`}>
            {s.replace('_', ' ')}
          </Link>
        ))}
        <div className="flex-1" />
        <span className="text-sm text-gray-400 self-center">{total.toLocaleString()} total</span>
      </div>

      {/* Table */}
      <div className="border rounded-lg overflow-hidden bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left py-3 px-4 font-medium text-gray-600 w-32">Date</th>
              <th className="text-left py-3 px-4 font-medium text-gray-600 w-36">Sender</th>
              <th className="text-left py-3 px-4 font-medium text-gray-600 w-28">Type</th>
              <th className="text-left py-3 px-4 font-medium text-gray-600">Project Match</th>
              <th className="text-left py-3 px-4 font-medium text-gray-600 w-20">Conf.</th>
              <th className="text-left py-3 px-4 font-medium text-gray-600">Summary</th>
              <th className="text-left py-3 px-4 font-medium text-gray-600 w-28">Chat</th>
              <th className="text-right py-3 px-4 font-medium text-gray-600 w-20">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {items.length === 0 && (
              <tr>
                <td colSpan={8} className="text-center py-16 text-gray-400">
                  No items in this queue
                </td>
              </tr>
            )}
            {items.map(item => {
              const cfg = TYPE_CONFIG[item.extraction_type] ?? { label: item.extraction_type, color: 'bg-gray-100 text-gray-500' };
              const conf = item.confidence_score ?? 0;
              const confColor = conf >= 0.85 ? 'text-green-600' : conf >= 0.60 ? 'text-yellow-600' : 'text-red-500';
              const summary = extractSummary(item.extracted_data, item.extraction_type);

              return (
                <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                  <td className="py-3 px-4 text-gray-500 text-xs">
                    {new Date(item.message_timestamp).toLocaleDateString('en-IN', {
                      day: '2-digit', month: 'short', year: '2-digit',
                      timeZone: 'Asia/Kolkata'
                    })}
                  </td>
                  <td className="py-3 px-4 text-gray-700 text-xs truncate max-w-[140px]">{item.sender_name}</td>
                  <td className="py-3 px-4">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${cfg.color}`}>
                      {cfg.label}
                    </span>
                    {item.requires_finance_review && (
                      <span className="ml-1 inline-flex items-center px-1.5 py-0.5 rounded text-xs font-bold bg-red-100 text-red-700">₹</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-gray-700 text-xs max-w-[160px]">
                    {item.matched_project_name
                      ? <span className="truncate block">{item.matched_project_name}</span>
                      : <span className="text-red-400 italic">unmatched</span>
                    }
                  </td>
                  <td className={`py-3 px-4 font-mono text-xs font-semibold ${confColor}`}>
                    {(conf * 100).toFixed(0)}%
                  </td>
                  <td className="py-3 px-4 text-gray-600 text-xs max-w-[200px]">
                    <span className="truncate block">{summary}</span>
                  </td>
                  <td className="py-3 px-4 text-xs text-gray-400">
                    {PROFILE_LABELS[item.chat_profile] ?? item.chat_profile}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <Link href={`/whatsapp-import/${item.id}`}
                      className="text-blue-600 hover:text-blue-800 text-xs font-medium">
                      Review →
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center gap-2 mt-4">
          {page > 1 && (
            <Link href={`/whatsapp-import?status=${status}&page=${page - 1}`}
              className="px-3 py-1.5 text-sm rounded bg-gray-100 text-gray-700 hover:bg-gray-200">
              ← Prev
            </Link>
          )}
          <span className="px-3 py-1.5 text-sm text-gray-500">
            Page {page} of {totalPages}
          </span>
          {page < totalPages && (
            <Link href={`/whatsapp-import?status=${status}&page=${page + 1}`}
              className="px-3 py-1.5 text-sm rounded bg-gray-100 text-gray-700 hover:bg-gray-200">
              Next →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
