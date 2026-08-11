"use client";

export default function ProjectError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-canvas px-5 py-10 text-ink">
      <section role="alert" aria-live="assertive" aria-labelledby="workspace-error-heading" className="w-full max-w-lg border-l-2 border-danger pl-5">
        <p className="text-sm font-semibold text-danger">Workspace unavailable</p>
        <h1 id="workspace-error-heading" className="mt-3 text-3xl font-semibold tracking-[-0.04em]">The project could not be opened.</h1>
        <p className="mt-3 text-sm leading-6 text-ink-muted">Your saved project is still on disk. Try loading the workspace again.</p>
        <button type="button" onClick={reset} className="mt-6 inline-flex min-h-11 items-center rounded-lg bg-accent px-4 text-sm font-semibold text-on-accent hover:bg-accent-strong">Try again</button>
      </section>
    </main>
  );
}
