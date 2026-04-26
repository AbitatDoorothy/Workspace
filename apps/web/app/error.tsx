"use client";

export default function ErrorBoundary({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main>
      <section className="workspace-shell">
        <div className="panel error-panel">
          <h1>Something went wrong</h1>
          <p>{error.message || "The workspace UI hit an unexpected error."}</p>
          <button onClick={reset} type="button">
            Try again
          </button>
        </div>
      </section>
    </main>
  );
}
