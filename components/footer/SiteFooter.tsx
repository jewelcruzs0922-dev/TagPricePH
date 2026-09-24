import Link from "next/link";
import { Logo } from "@/components/ui/Logo";
import {
  FacebookIcon,
  InstagramIcon,
  TikTokIcon,
  XIcon,
  YouTubeIcon,
} from "@/components/ui/BrandIcons";

const footerLinks = [
  { href: "/about", label: "About Us" },
  { href: "/help", label: "Help" },
  { href: "/help#privacy", label: "Privacy" },
  { href: "/help#terms", label: "Terms" },
];

const socials = [
  { label: "Facebook", Icon: FacebookIcon },
  { label: "X", Icon: XIcon },
  { label: "Instagram", Icon: InstagramIcon },
  { label: "TikTok", Icon: TikTokIcon },
  { label: "YouTube", Icon: YouTubeIcon },
];

function SocialIcon({
  label,
  Icon,
}: {
  label: string;
  Icon: React.ComponentType<{ className?: string; size?: number }>;
}) {
  return (
    <span
      title={label}
      className="flex h-8 w-8 items-center justify-center rounded-full text-ink-2 transition hover:text-ink"
    >
      <Icon className="h-[15px] w-[15px]" size={15} />
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-14 border-t border-line/80 bg-cream">
      <div className="container-page flex flex-col gap-8 py-10 md:flex-row md:items-center md:justify-between md:py-11">
        <div className="max-w-xs">
          <Logo />
          <p className="mt-2.5 text-[14px] text-ink-2">
            Smarter shopping for every Juan.
          </p>
        </div>

        <nav aria-label="Footer" className="flex flex-wrap gap-x-7 gap-y-3">
          {footerLinks.map((link) => (
            <Link
              key={link.label}
              href={link.href}
              className="text-[14px] font-medium text-ink-2 transition hover:text-ink"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex flex-col items-start gap-3 md:items-end">
          <div className="flex items-center gap-1" aria-hidden="true">
            {socials.map((social) => (
              <SocialIcon
                key={social.label}
                label={social.label}
                Icon={social.Icon}
              />
            ))}
          </div>
          <p className="text-[13px] text-ink-2">
            Made for Filipino shoppers 🇵🇭
          </p>
        </div>
      </div>
      <div className="border-t border-line/70">
        <div className="container-page flex flex-col gap-1.5 py-4 text-[12px] text-ink-3 sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} TagPricePH · Demo sample data</p>
          <p>Prices may not reflect live retailer prices.</p>
        </div>
        <div className="container-page border-t border-line/60 py-3 text-[12px] leading-relaxed text-ink-3">
          <p>
            Some links on TagPricePH are affiliate links. If you purchase through
            one of these links, TagPricePH may earn a commission at no additional
            cost to you.
          </p>
        </div>
      </div>
    </footer>
  );
}
