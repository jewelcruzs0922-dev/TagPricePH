import type { Metadata, Viewport } from "next";
import { Outfit } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { TagPricePHHeader } from "@/components/header/TagPricePHHeader";
import { SiteFooter } from "@/components/footer/SiteFooter";
import { baseUrl, metadataConfig } from "@/lib/utils/seo";
import "./globals.css";

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(baseUrl),
  title: {
    default: metadataConfig.title,
    template: "%s | TagPricePH",
  },
  description: metadataConfig.description,
  applicationName: "TagPricePH",
  keywords: [
    "price comparison Philippines",
    "TagPricePH",
    "Shopee deals",
    "Lazada deals",
    "price tracker PH",
  ],
  openGraph: {
    type: "website",
    locale: "en_PH",
    url: baseUrl,
    siteName: "TagPricePH",
    title: metadataConfig.title,
    description: metadataConfig.description,
  },
  twitter: {
    card: "summary_large_image",
    title: metadataConfig.title,
    description: metadataConfig.description,
  },
  alternates: {
    canonical: "/",
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#FAF8F1",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-PH">
      <body className={`${outfit.variable} antialiased`}>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-ink focus:px-4 focus:py-2 focus:text-white"
        >
          Skip to content
        </a>
        <TagPricePHHeader />
        <main id="main">{children}</main>
        <SiteFooter />
        <Analytics />
      </body>
    </html>
  );
}
