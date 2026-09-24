import Link from "next/link";

export default function NotFound() {
  return (
    <div className="container-page flex min-h-[50vh] flex-col items-center justify-center py-16 text-center">
      <p className="text-[13px] font-semibold uppercase tracking-wide text-ink-3">404</p>
      <h1 className="mt-2 text-[28px] font-extrabold text-ink">Page not found</h1>
      <p className="mt-2 max-w-md text-[16px] text-ink-2">
        The page you are looking for does not exist. Try searching for a product
        instead.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Link href="/" className="btn-primary">
          Go home
        </Link>
        <Link href="/search" className="btn-ghost">
          Search products
        </Link>
      </div>
    </div>
  );
}
