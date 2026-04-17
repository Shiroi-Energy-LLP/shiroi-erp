/**
 * Vendor Portal — Thank-you confirmation page.
 *
 * No data fetch. Rendered after successful quote submission.
 */

export default function ThankYouPage() {
  return (
    <main className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <span className="text-lg font-semibold text-emerald-700">Shiroi Energy</span>
          <span className="text-xs text-slate-500">Procurement Portal</span>
        </div>
      </header>
      <div className="mx-auto max-w-md px-6 py-24">
        <div className="rounded-lg border border-slate-200 bg-white p-10 text-center shadow-sm">
          <div className="mx-auto mb-6 inline-flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
            <svg
              className="h-9 w-9 text-emerald-600"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
          <h1 className="mb-2 text-2xl font-semibold text-slate-900">Thank you!</h1>
          <p className="text-slate-600">
            Your quote has been received. Our team will review it and get back to you.
          </p>
          <p className="mt-8 text-xs text-slate-400">Shiroi Energy Procurement</p>
        </div>
      </div>
    </main>
  );
}
