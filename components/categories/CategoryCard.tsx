import Link from "next/link";
import {
  Smartphone,
  Gamepad2,
  Phone,
  Laptop,
  House,
  Shirt,
  Sparkles,
  Dumbbell,
  type LucideIcon,
} from "lucide-react";
import type { Category } from "@/lib/types";

const icons: Record<string, LucideIcon> = {
  Smartphone,
  Gamepad2,
  Phone,
  Laptop,
  House,
  Shirt,
  Sparkles,
  Dumbbell,
};

export function CategoryCard({ category }: { category: Category }) {
  const Icon = icons[category.icon] ?? Smartphone;
  return (
    <Link
      href={`/categories/${category.slug}`}
      className="group flex flex-col items-center gap-3 rounded-2xl border border-[#f3ead0] bg-accent-soft/40 px-2 py-5 text-center transition hover:border-accent-deep/40 hover:bg-accent-soft"
    >
      <Icon
        className="h-9 w-9 text-ink transition group-hover:scale-105"
        strokeWidth={1.5}
        aria-hidden="true"
      />
      <span className="text-[13px] font-semibold leading-tight text-ink">
        {category.name}
      </span>
    </Link>
  );
}
