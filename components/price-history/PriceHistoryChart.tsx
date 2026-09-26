"use client";

import { useMemo, useState } from "react";
import type { BuyTiming, DataSource, PricePoint } from "@/lib/types";
import { filterHistory, getAverage } from "@/lib/pricing";
import { formatPeso } from "@/lib/utils/format";

type Range = "7D" | "30D" | "3M" | "6M";
const ranges: Range[] = ["7D", "30D", "3M", "6M"];

type PriceHistoryChartProps = {
  history: PricePoint[];
  /**
   * Today's price, or null when no offer currently qualifies as one (every
   * listing stale, out of stock, or not this variant). Null must not be
   * rendered as ₱0 — that would be a price nobody is charging.
   */
  currentPrice?: number | null;
  timing?: BuyTiming;
  showSummary?: boolean;
  compact?: boolean;
  /**
   * Where the series came from. Defaults to "demo" so a caller that forgets to
   * say gets the honest label rather than presenting generated figures as a
   * recorded price history.
   */
  source?: DataSource;
};

function formatAxis(price: number): string {
  if (price >= 1000) {
    const k = Math.round(price / 1000);
    return `₱${k}k`;
  }
  return formatPeso(price);
}

function formatDateLabel(iso: string): string {
  const date = new Date(`${iso}T00:00:00`);
  return date.toLocaleDateString("en-PH", { month: "short", day: "numeric" });
}

export function PriceHistoryChart({
  history,
  currentPrice,
  showSummary = true,
  compact = false,
  source = "demo",
}: PriceHistoryChartProps) {
  const [range, setRange] = useState<Range>("30D");
  const points = useMemo(() => filterHistory(history, range), [history, range]);

  const prices = points.map((point) => point.price);
  const current = currentPrice ?? null;
  // The scale only includes today's price when there is one, so an unknown
  // current price cannot drag the axis down to zero.
  const scale = current === null ? prices : [...prices, current];
  const min = Math.min(...scale);
  const max = Math.max(...scale);
  const average = getAverage(points);
  const lowest = Math.min(...prices);
  const highest = Math.max(...prices);

  const width = 400;
  const height = 200;
  const padLeft = 52;
  const padRight = 16;
  const padTop = 16;
  const padBottom = 28;
  const span = max - min || 1;

  // Align axis labels to reference: ~40k / 45k / 50k / 55k style ticks
  const tickCount = 4;
  const ticks = Array.from({ length: tickCount }, (_, i) => {
    const value = min + ((max - min) * i) / (tickCount - 1);
    return Math.round(value / 500) * 500;
  });

  const coords = points.map((point, index) => {
    const x =
      padLeft +
      (index / Math.max(points.length - 1, 1)) * (width - padLeft - padRight);
    const y =
      padTop +
      (1 - (point.price - min) / span) * (height - padTop - padBottom);
    return { ...point, x, y };
  });

  const linePath = coords
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`,
    )
    .join(" ");
  const areaPath =
    coords.length > 0
      ? `${linePath} L ${coords[coords.length - 1].x.toFixed(1)} ${height - padBottom} L ${coords[0].x.toFixed(1)} ${height - padBottom} Z`
      : "";

  const last = coords[coords.length - 1];
  const xLabels = points
    .filter((_, index) => {
      const step = Math.max(Math.floor(points.length / 5), 1);
      return index % step === 0 || index === points.length - 1;
    })
    .map((point) => point);

  return (
    <div
      className={`flex flex-col rounded-2xl border border-line bg-white ${compact ? "p-4" : "p-4 sm:p-5"}`}
    >
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <h3 className="text-[16px] font-bold text-ink">How the price changed</h3>
        <div
          className="flex gap-1 rounded-full border border-line bg-cream p-1"
          role="tablist"
          aria-label="Price history range"
        >
          {ranges.map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={range === item}
              className={`min-h-11 rounded-full px-3.5 py-1.5 text-[13px] font-bold transition ${
                range === item
                  ? "bg-accent text-ink shadow-sm"
                  : "text-ink-2 hover:text-ink"
              }`}
              onClick={() => setRange(item)}
            >
              {item}
            </button>
          ))}
        </div>
      </div>

      {source !== "live" && points.length > 0 && (
        <p className="mb-2 text-[12px] leading-snug text-ink-2">
          Sample history for demonstration — not recorded retailer prices.
        </p>
      )}

      {points.length === 0 ? (
        <div
          className="flex min-h-[160px] flex-col items-center justify-center rounded-xl border border-dashed border-line bg-cream/40 px-4 py-8 text-center"
          role="status"
        >
          <p className="text-[15px] font-semibold text-ink">
            {history.length === 0
              ? "No price history yet"
              : "No price points in this range"}
          </p>
          <p className="mt-1 text-[13px] text-ink-2">
            {history.length === 0
              ? "Once this product has recorded prices, its history will appear here."
              : "Try a wider range above."}
          </p>
        </div>
      ) : (
        <div className="relative">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-[200px] w-full"
          role="img"
          aria-label={
            current === null
              ? `Price chart from ${formatPeso(lowest)} to ${formatPeso(highest)} over ${range}`
              : `Price chart from ${formatPeso(lowest)} to ${formatPeso(current)} over ${range}`
          }
        >
          {ticks.map((tick) => {
            const y =
              padTop +
              (1 - (tick - min) / span) * (height - padTop - padBottom);
            return (
              <g key={tick}>
                <line
                  x1={padLeft}
                  x2={width - padRight}
                  y1={y}
                  y2={y}
                  stroke="#EFECE3"
                />
                <text
                  x={padLeft - 8}
                  y={y + 5}
                  textAnchor="end"
                  fontSize="18"
                  fill="#98A2B3"
                  fontFamily="Outfit, sans-serif"
                >
                  {formatAxis(tick)}
                </text>
              </g>
            );
          })}
          <path d={areaPath} fill="rgba(244,216,74,0.3)" />
          <path
            d={linePath}
            fill="none"
            stroke="#E6C517"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {last && (
            <>
              <circle cx={last.x} cy={last.y} r="6" fill="#172033" />
              <circle cx={last.x} cy={last.y} r="3.5" fill="#F4D84A" />
            </>
          )}
          {xLabels.map((point) => {
            const coord = coords.find((c) => c.date === point.date);
            if (!coord) return null;
            return (
              <text
                key={point.date}
                x={coord.x}
                y={height - 8}
                textAnchor="middle"
                fontSize="16"
                fill="#98A2B3"
                fontFamily="Outfit, sans-serif"
              >
                {formatDateLabel(point.date)}
              </text>
            );
          })}
        </svg>

        {last && (
          <div
            className="pointer-events-none absolute rounded-lg border border-line bg-white px-2 py-1 shadow-sm"
            style={{
              left: `${Math.min(Math.max((last.x / width) * 100 - 8, 4), 72)}%`,
              top: `${Math.max((last.y / height) * 100 - 18, 0)}%`,
            }}
          >
            <p className="text-[11px] font-semibold text-ink-2">
              {current !== null ? "Today" : "Last recorded"}
            </p>
            <p className="text-[13px] font-extrabold leading-tight text-ink">
              {formatPeso(current ?? last.price)}
            </p>
          </div>
        )}
      </div>
      )}

      {showSummary && points.length > 0 && (
        <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat
            label="Current"
            value={current !== null ? formatPeso(current) : "Unavailable"}
            strong
          />
          <Stat label="Lowest" value={formatPeso(lowest)} />
          <Stat label="Average" value={formatPeso(average)} />
          <Stat label="Highest" value={formatPeso(highest)} />
        </dl>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="rounded-xl border border-line bg-cream/50 px-2.5 py-2">
      <dt className="text-[12px] font-semibold uppercase tracking-wide text-ink-2">
        {label}
      </dt>
      <dd
        className={`text-[14px] ${strong ? "font-extrabold text-ink" : "font-semibold text-ink-2"}`}
      >
        {value}
      </dd>
    </div>
  );
}
