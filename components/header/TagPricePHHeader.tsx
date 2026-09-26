"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, Search, X, Bell } from "lucide-react";
import { Logo } from "@/components/ui/Logo";

const navItems = [
  { href: "/", label: "Home", exact: true },
  { href: "/search", label: "Compare", exact: false },
  { href: "/price-drops", label: "Price Drops", exact: false },
  { href: "/categories", label: "Categories", exact: false },
];

export function TagPricePHHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const closeMenu = () => setOpen(false);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    function onMouseDown(event: MouseEvent) {
      if (
        headerRef.current &&
        !headerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onMouseDown);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onMouseDown);
    };
  }, [open]);

  function isActive(item: (typeof navItems)[number]) {
    if (item.exact) return pathname === "/";
    return pathname === item.href || pathname.startsWith(`${item.href}/`);
  }

  return (
    <header ref={headerRef} className="sticky top-0 z-50 bg-cream/95 backdrop-blur">
      <div className="container-page flex h-16 items-center justify-between gap-4 sm:h-[72px]">
        <Logo />

        <nav aria-label="Primary" className="hidden items-center gap-1 md:flex">
          {navItems.map((item) => {
            const active = isActive(item);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`relative px-4 py-2 text-[15px] font-semibold transition ${
                  active ? "text-ink" : "text-ink-2 hover:text-ink"
                }`}
              >
                {item.label}
                {active && (
                  <span className="absolute inset-x-3 -bottom-0.5 h-[3px] rounded-full bg-accent" />
                )}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          <Link
            href="/search"
            className="flex h-11 w-11 items-center justify-center rounded-full text-ink transition hover:bg-white"
            aria-label="Search products"
          >
            <Search className="h-5 w-5" strokeWidth={2.2} aria-hidden="true" />
          </Link>
          <Link
            href="/alerts"
            className="flex h-11 w-11 items-center justify-center rounded-full text-ink transition hover:bg-white"
            aria-label="Price alerts"
          >
            <Bell className="h-5 w-5" strokeWidth={2.2} aria-hidden="true" />
          </Link>
          <Link
            href="/alerts"
            className="hidden rounded-full bg-accent px-6 py-2.5 text-[14px] font-bold text-ink transition hover:bg-[#f0cf2f] sm:inline-flex"
          >
            Sign In
          </Link>
          <button
            type="button"
            className="flex h-11 w-11 items-center justify-center rounded-full text-ink transition hover:bg-white md:hidden"
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? (
              <X className="h-5 w-5" aria-hidden="true" />
            ) : (
              <Menu className="h-5 w-5" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      {open && (
        <div id="mobile-nav" className="border-t border-line bg-cream md:hidden">
          <nav
            aria-label="Mobile"
            className="container-page flex flex-col gap-1 py-4"
          >
            {navItems.map((item) => {
              const active = isActive(item);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={closeMenu}
                  aria-current={active ? "page" : undefined}
                  className={`rounded-xl px-3 py-3 text-[16px] font-semibold text-ink ${
                    active ? "bg-white" : "hover:bg-white"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
            <Link
              href="/alerts"
              onClick={closeMenu}
              className="rounded-xl px-3 py-3 text-[16px] font-semibold text-ink hover:bg-white"
            >
              Price Alerts
            </Link>
            <Link
              href="/about"
              onClick={closeMenu}
              className="rounded-xl px-3 py-3 text-[16px] font-semibold text-ink hover:bg-white"
            >
              About Us
            </Link>
            <Link
              href="/alerts"
              onClick={closeMenu}
              className="mt-1 rounded-full bg-accent px-5 py-3 text-center text-[15px] font-bold text-ink"
            >
              Sign In
            </Link>
          </nav>
        </div>
      )}
    </header>
  );
}
