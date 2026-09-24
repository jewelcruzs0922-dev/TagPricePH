import { SearchX, AlertTriangle } from "lucide-react";
import Link from "next/link";

export function EmptyState({
  title = "We couldn't find that product.",
  supporting = "Try a different product name or brand.",
  actionLabel = "Search again",
  actionHref = "/search",
}: {
  title?: string;
  supporting?: string;
  actionLabel?: string;
  actionHref?: string;
}) {
  return (
    <div className="card mx-auto max-w-lg p-8 text-center">
      <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-accent-soft">
        <SearchX className="h-6 w-6 text-ink" aria-hidden="true" />
      </span>
      <h2 className="text-[18px] font-bold text-ink">{title}</h2>
      <p className="mt-1 text-[15px] text-ink-2">{supporting}</p>
      <Link href={actionHref} className="btn-primary mt-5 inline-flex">
        {actionLabel}
      </Link>
    </div>
  );
}

export function ErrorState({
  onRetryHref = "/",
}: {
  onRetryHref?: string;
}) {
  return (
    <div className="card mx-auto max-w-lg p-8 text-center" role="alert">
      <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-wait-soft">
        <AlertTriangle className="h-6 w-6 text-wait" aria-hidden="true" />
      </span>
      <h2 className="text-[18px] font-bold text-ink">
        Something went wrong while loading prices.
      </h2>
      <p className="mt-1 text-[15px] text-ink-2">
        Please try again in a moment.
      </p>
      <Link href={onRetryHref} className="btn-primary mt-5 inline-flex">
        Try again
      </Link>
    </div>
  );
}

export function ProductGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="card overflow-hidden">
          <div className="skeleton h-36 w-full" />
          <div className="space-y-2 p-4">
            <div className="skeleton h-4 w-3/4" />
            <div className="skeleton h-6 w-1/2" />
            <div className="skeleton h-4 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  );
}
