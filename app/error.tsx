"use client";

import Link from "next/link";

/**
 * Route-level error boundary. The data layer fails closed by design (a broken
 * database must never render as an empty store), so this page is where an
 * uncaught server error lands instead of Next's bare 500.
 *
 * The error itself is only logged — never rendered. Exception messages can
 * carry connection details, and the visitor needs a way forward, not a stack
 * trace.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  console.error("route error:", error.digest ?? error.name);
  return (
    <div className="container-page flex min-h-[50vh] flex-col items-center justify-center py-16 text-center">
      <h1 className="text-[26px] font-extrabold tracking-tight text-ink">
        Something went wrong on our side
      </h1>
      <p className="mt-3 max-w-md text-[15px] text-ink-2">
        We couldn&apos;t load this page right now. Your prices are safe — try
        again in a moment.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <button type="button" onClick={reset} className="btn-primary">
          Try again
        </button>
        <Link href="/" className="btn-ghost">
          Back to home
        </Link>
      </div>
    </div>
  );
}
