import { getQueueItems, getQueueStats } from '@/lib/whatsapp-import-queries';
import Link from 'next/link';
import { BulkActionTable } from '@/components/whatsapp-import/bulk-action-table';
import { WHATSAPP_PROFILE_LABELS as PROFILE_LABELS } from '@/lib/label-constants';

export const metadata = { title: 'WhatsApp Import Queue' };

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

      {/* Table with bulk-select */}
      <BulkActionTable items={items} status={status} />

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
