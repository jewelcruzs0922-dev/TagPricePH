"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

const slides = [
  {
    src: "/images/hero-showcase@2x.png",
    alt: "Price comparison on TagPricePH — iPhone 16 price deal across TikTok Shop, Lazada, and Shopee",
    width: 2724,
    height: 2310,
  },
  {
    src: "/images/hero-media-1.png",
    alt: "TagPricePH price drop showcase",
    width: 1536,
    height: 1024,
  },
  {
    src: "/images/hero-media-2.png",
    alt: "TagPricePH best deal comparison showcase",
    width: 1536,
    height: 1024,
  },
];

const SLIDE_INTERVAL_MS = 3500;

export function HeroMedia() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % slides.length);
    }, SLIDE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div
      className="relative mx-auto aspect-[6/5] w-full max-w-[560px] overflow-hidden lg:mx-0"
      aria-roledescription="carousel"
      aria-label="TagPricePH highlights"
    >
      {slides.map((slide, slideIndex) => {
        const active = slideIndex === index;
        return (
          <div
            key={slide.src}
            role="group"
            aria-roledescription="slide"
            aria-label={`${slideIndex + 1} of ${slides.length}`}
            aria-hidden={!active}
            className="absolute inset-0 transition-all duration-700 ease-out"
            style={{
              opacity: active ? 1 : 0,
              transform: active
                ? "translateY(0) scale(1)"
                : "translateY(12px) scale(1.04)",
              pointerEvents: active ? "auto" : "none",
            }}
          >
            <Image
              src={slide.src}
              alt={slide.alt}
              width={slide.width}
              height={slide.height}
              quality={100}
              priority={slideIndex === 0}
              sizes="(min-width: 1024px) 560px, (min-width: 640px) 90vw, 100vw"
              className="h-full w-full object-contain"
            />
          </div>
        );
      })}
    </div>
  );
}
