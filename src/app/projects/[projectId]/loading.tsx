export default function ProjectLoading() {
  return (
    <main className="min-h-[100dvh] bg-canvas p-5 text-ink sm:p-8 lg:p-10" aria-label="Loading workspace">
      <div className="mx-auto flex min-h-[calc(100dvh-2.5rem)] max-w-[1440px] gap-8">
        <div className="hidden w-[260px] shrink-0 animate-pulse border-r border-line pr-6 lg:block">
          <div className="h-5 w-28 rounded bg-surface-muted" />
          <div className="mt-10 h-4 w-40 rounded bg-surface-muted" />
          <div className="mt-3 h-4 w-32 rounded bg-surface-muted" />
          <div className="mt-10 space-y-3">
            <div className="h-12 rounded-lg bg-surface-muted" />
            <div className="h-12 rounded-lg bg-surface-muted" />
            <div className="h-12 rounded-lg bg-surface-muted" />
          </div>
        </div>
        <div className="min-w-0 flex-1 animate-pulse">
          <div className="h-16 border-b border-line bg-surface-muted/60" />
          <div className="max-w-[780px] pt-12">
            <div className="h-4 w-28 rounded bg-surface-muted" />
            <div className="mt-5 h-10 w-3/4 rounded bg-surface-muted" />
            <div className="mt-4 h-4 w-1/2 rounded bg-surface-muted" />
            <div className="mt-10 h-56 rounded-lg bg-surface-muted" />
          </div>
        </div>
      </div>
    </main>
  );
}
