import * as React from 'react';

/**
 * Standard list-page layout — the same shape confirmed on the Projects table.
 *
 * - `header` renders in a fixed white band pulled flush under the topbar
 *   (`-mt` negates main's padding) so the page's "Projects"-style topbar title
 *   and the filter bar read as one merged white header. It stays put while the
 *   body scrolls. Put the filter bar (and any title/create actions) here.
 * - `children` (KPIs / summary + the table) scroll in the region below. A table
 *   rendered inside with a `sticky top-0` `<thead>` and NO own overflow wrapper
 *   will freeze its column header at the top of this region once the KPIs/Views
 *   scroll past — because the header anchors to THIS scroll container.
 *
 * The page that renders this MUST be the direct child of the (erp) `<main>` so
 * `h-full` resolves against main's height.
 */
export function ListPageShell({
  header,
  children,
}: {
  header?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      {header != null && (
        <div className="shrink-0 -mx-4 -mt-4 space-y-3 border-b border-n-200 bg-white px-4 py-3 lg:-mx-6 lg:-mt-6 lg:px-6">
          {header}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        <div className={header != null ? 'space-y-4 pt-4' : 'space-y-4'}>{children}</div>
      </div>
    </div>
  );
}
