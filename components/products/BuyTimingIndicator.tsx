import { CheckCircle2, Clock, TrendingUp } from "lucide-react";
import type { BuyTiming } from "@/lib/types";

const styles: Record<
  BuyTiming["status"],
  { wrap: string; icon: React.ReactNode; title: string }
> = {
  good: {
    wrap: "border-success/25 bg-success-soft text-ink",
    icon: <CheckCircle2 className="h-5 w-5 text-success" aria-hidden="true" />,
    title: "text-success",
  },
  fair: {
    wrap: "border-line bg-accent-soft/60 text-ink",
    icon: <Clock className="h-5 w-5 text-ink" aria-hidden="true" />,
    title: "text-ink",
  },
  wait: {
    wrap: "border-[#f0d4b5] bg-wait-soft text-ink",
    icon: <TrendingUp className="h-5 w-5 text-wait" aria-hidden="true" />,
    title: "text-wait",
  },
};

export function BuyTimingIndicator({
  timing,
  detail,
  className = "",
}: {
  timing: BuyTiming;
  detail?: string;
  className?: string;
}) {
  const style = styles[timing.status];
  return (
    <div
      className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${style.wrap} ${className}`}
      role="status"
    >
      <span className="mt-0.5 shrink-0">{style.icon}</span>
      <div>
        <p className={`text-[15px] font-bold ${style.title}`}>{timing.label}</p>
        <p className="text-[14px] leading-snug text-ink-2">
          {detail ?? timing.detail}
        </p>
      </div>
    </div>
  );
}
