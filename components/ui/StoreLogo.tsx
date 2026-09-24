import { getStore } from "@/lib/data/stores";
import {
  AbensonMark,
  LazadaMark,
  ShopeeMark,
  SmMark,
  TikTokShopMark,
} from "@/components/ui/BrandIcons";

const marks: Record<
  string,
  React.ComponentType<{ className?: string; size?: number }>
> = {
  tiktok: TikTokShopMark,
  lazada: LazadaMark,
  shopee: ShopeeMark,
  abensons: AbensonMark,
  sm: SmMark,
};

const backgrounds: Record<string, string> = {
  lazada:
    "linear-gradient(135deg, #F85606 0%, #F83C72 45%, #A020F0 100%)",
};

export function StoreLogo({
  storeId,
  size = 36,
}: {
  storeId: string;
  size?: number;
}) {
  const store = getStore(storeId);
  const Mark = marks[storeId];
  const background = backgrounds[storeId] ?? store.color;
  const iconSize = Math.max(14, Math.round(size * 0.62));

  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-[10px] text-white"
      style={{
        width: size,
        height: size,
        background,
      }}
      aria-hidden="true"
    >
      {Mark ? (
        <Mark size={iconSize} />
      ) : (
        <span
          className="font-bold leading-none"
          style={{ fontSize: Math.max(11, size * 0.32) }}
        >
          {store.short}
        </span>
      )}
    </span>
  );
}
