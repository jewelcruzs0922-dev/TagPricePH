import Link from "next/link";

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link
      href="/"
      className="inline-flex items-center gap-2 font-extrabold tracking-tight text-ink"
      aria-label="TagPricePH home"
    >
      <svg
        width="34"
        height="34"
        viewBox="0 0 34 34"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M12 5 H26 a5 5 0 0 1 5 5 V24 a5 5 0 0 1-5 5 H12 L4 17 Z"
          fill="#F4D84A"
          stroke="#172033"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <circle cx="11.5" cy="17" r="2.2" fill="#172033" />
      </svg>
      {!compact && (
        <span className="inline-flex items-center gap-1.5 text-[20px] leading-none">
          TagPrice
          <span className="rounded-md bg-accent px-1.5 py-1 text-[12px] font-bold leading-none text-ink">
            PH
          </span>
        </span>
      )}
    </Link>
  );
}
