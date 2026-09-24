import { PiggyBank } from "lucide-react";
import { formatPeso } from "@/lib/utils/format";

export function SavingsBadge({
  amount,
  compact = false,
}: {
  amount: number;
  compact?: boolean;
}) {
  if (amount <= 0) return null;
  if (compact) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2.5 py-1 text-[13px] font-bold text-success">
        save {formatPeso(amount)}
      </span>
    );
  }
  return (
    <div className="inline-flex items-center gap-3 rounded-2xl border border-[#f0d42a]/40 bg-accent-soft px-4 py-3">
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-ink">
        <PiggyBank className="h-5 w-5" aria-hidden="true" />
      </span>
      <div>
        <p className="text-[13px] font-semibold uppercase tracking-wide text-ink-2">
          You could save
        </p>
        <p className="text-[22px] font-extrabold leading-tight text-ink">
          {formatPeso(amount)}
        </p>
      </div>
    </div>
  );
}
