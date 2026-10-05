/** Shown instantly while a page's data loads on the server. */
export default function Loading() {
  return (
    <div role="status" aria-live="polite" className="animate-pulse space-y-3">
      <span className="sr-only">Loading…</span>
      <div className="h-6 w-48 rounded bg-surface-2" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => <div key={i} className="h-16 rounded-md border border-line bg-surface" />)}
      </div>
      <div className="h-64 rounded-md border border-line bg-surface" />
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="h-40 rounded-md border border-line bg-surface" />
        <div className="h-40 rounded-md border border-line bg-surface" />
      </div>
    </div>
  );
}
