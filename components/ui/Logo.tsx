import Link from "next/link";
import Image from "next/image";

const LOGO_WIDTH = 1819;
const LOGO_HEIGHT = 467;

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link
      href="/"
      className="inline-flex items-center"
      aria-label="TagPricePH home"
    >
      <Image
        src="/images/logo.png"
        alt="TagPricePH"
        width={LOGO_WIDTH}
        height={LOGO_HEIGHT}
        className={`w-auto rounded-[6px] ${
          compact ? "h-8" : "h-9 sm:h-10"
        }`}
      />
    </Link>
  );
}
