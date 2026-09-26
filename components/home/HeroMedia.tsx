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
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    // Auto-advance stops while the visitor has it paused, and never starts
    // for reduced-motion users (WCAG 2.2.2: a pause mechanism must exist,
    // and motion-sensitive users must not need it).
    if (paused) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % slides.length);
    }, SLIDE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [paused]);

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
              quality={75}
              priority={slideIndex === 0}
              sizes="(min-width: 1024px) 560px, (min-width: 640px) 90vw, 100vw"
              className="h-full w-full object-contain"
            />
          </div>
        );
      })}
      <button
        type="button"
        onClick={() => setPaused((value) => !value)}
        aria-pressed={paused}
        aria-label={
          paused ? "Play the highlights slideshow" : "Pause the highlights slideshow"
        }
        className="absolute bottom-2 right-2 z-10 flex h-11 w-11 items-center justify-center rounded-full border border-line bg-white/90 text-ink shadow-sm transition hover:bg-white focus-visible:outline-2"
      >
        {paused ? (
          <svg width="14" height="16" viewBox="0 0 14 16" aria-hidden="true" fill="currentColor">
            <path d="M1 1.5v13a1 1 0 0 0 1.53.85l10.5-6.5a1 1 0 0 0 0-1.7L2.53.65A1 1 0 0 0 1 1.5Z" />
          </svg>
        ) : (
          <svg width="12" height="14" viewBox="0 0 12 14" aria-hidden="true" fill="currentColor">
            <rect x="0" y="0" width="4" height="14" rx="1" />
            <rect x="8" y="0" width="4" height="14" rx="1" />
          </svg>
        )}
      </button>
    </div>
  );
}
