"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Search, X, ArrowRight, Link2 } from "lucide-react";
import { isProductUrl } from "@/lib/data/search-core";
import type { Product } from "@/lib/types";
import { formatPeso } from "@/lib/utils/format";
import { getLowestOffer } from "@/lib/pricing";

type SearchBarProps = {
  placeholder?: string;
  autoFocus?: boolean;
  size?: "lg" | "md";
  className?: string;
};

/** Long enough that a fast typist produces one request, not one per letter. */
const SUGGESTION_DEBOUNCE_MS = 150;

export function SearchBar({
  placeholder = "Search products or paste a link…",
  autoFocus = false,
  size = "lg",
  className = "",
}: SearchBarProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [fetchedSuggestions, setFetchedSuggestions] = useState<Product[]>([]);

  const pasted = isProductUrl(query);
  // Pasted links never show product suggestions, and an empty box has nothing
  // to suggest — both gated at render so the effect below never has to write
  // state synchronously to agree with the UI.
  const suggestions = pasted || !query.trim() ? [] : fetchedSuggestions;
  const showPanel = open && (pasted || suggestions.length > 0);

  /**
   * Suggestions are served by `/api/suggestions` rather than filtered here,
   * so the sample catalog never enters the client bundle — the price of
   * instant keystrokes used to be shipping all 150 products to every page.
   * Debounced, abortable, and only the answer to the newest keystroke lands;
   * a failure keeps the previous list instead of flashing the panel shut.
   */
  useEffect(() => {
    const trimmed = query.trim();
    if (pasted || !trimmed) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetch(`/api/suggestions?q=${encodeURIComponent(trimmed)}`, {
        signal: controller.signal,
      })
        .then((response) => (response.ok ? response.json() : []))
        .then((data: unknown) => {
          if (controller.signal.aborted) return;
          setFetchedSuggestions(Array.isArray(data) ? (data as Product[]) : []);
        })
        .catch(() => {
          /* aborted by a newer keystroke, or the request failed */
        });
    }, SUGGESTION_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, pasted]);

  useEffect(() => {
    function onClickOutside(event: MouseEvent) {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function submit(value = query) {
    const trimmed = value.trim();
    if (!trimmed) return;
    setOpen(false);
    router.push(`/search?q=${encodeURIComponent(trimmed)}`);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((prev) => Math.min(prev + 1, suggestions.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((prev) => Math.max(prev - 1, -1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (activeIndex >= 0 && suggestions[activeIndex]) {
        submit(suggestions[activeIndex].name);
      } else {
        submit();
      }
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  const inputSize =
    size === "lg"
      ? "h-[60px] text-[16px] pl-12 pr-[104px] sm:h-[64px]"
      : "h-[48px] text-[16px] pl-11 pr-[104px]";

  return (
    <div ref={boxRef} className={`relative ${className}`}>
      <form
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        className="relative"
      >
        <label htmlFor={`search-${size}`} className="sr-only">
          Search products
        </label>
        <Search
          className="pointer-events-none absolute left-5 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-3"
          aria-hidden="true"
        />
        <input
          id={`search-${size}`}
          ref={inputRef}
          type="search"
          value={query}
          autoFocus={autoFocus}
          autoComplete="off"
          placeholder={placeholder}
          className={`w-full rounded-full border border-line bg-white text-ink placeholder:text-ink-3 shadow-[0_2px_12px_rgba(23,32,51,0.04)] transition focus:border-accent-deep focus:outline-none focus:ring-4 focus:ring-accent/45 ${inputSize}`}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            setActiveIndex(-1);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          aria-controls="search-suggestions"
          aria-autocomplete="list"
        />
        <button
          type="submit"
          className={`absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center justify-center rounded-full bg-accent font-bold text-ink transition hover:bg-[#f0cf2f] ${
            size === "lg" ? "h-[50px] w-[50px] sm:h-[54px] sm:w-[54px]" : "h-11 w-11"
          }`}
          aria-label="Search"
        >
          <ArrowRight className="h-5 w-5" strokeWidth={2.5} aria-hidden="true" />
        </button>
      </form>

      {showPanel && (
        <div
          id="search-suggestions"
          role="listbox"
          className="absolute left-0 right-0 top-[calc(100%+8px)] z-40 max-h-[60vh] overflow-y-auto rounded-2xl border border-line bg-white shadow-[0_16px_40px_rgba(23,32,51,0.12)]"
        >
          {pasted ? (
            <div className="flex items-start gap-3 p-4">
              <span className="mt-0.5 rounded-lg bg-accent-soft p-2 text-ink">
                <Link2 className="h-4 w-4" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold uppercase tracking-wide text-ink-3">
                  Pasted product link
                </p>
                <p className="truncate text-[15px] text-ink-2">{query}</p>
                <button
                  type="button"
                  className="mt-2 rounded-lg py-1 text-[14px] font-semibold text-ink underline decoration-accent decoration-2 underline-offset-4"
                  onClick={() => submit(query)}
                >
                  Look up this product
                </button>
              </div>
            </div>
          ) : (
            <div className="p-2">
              <p className="px-3 py-2 text-[12px] font-semibold uppercase tracking-wide text-ink-3">
                Products
              </p>
              {suggestions.map((product, index) => {
                const lowest = getLowestOffer(product.offers);
                return (
                  <button
                    key={product.id}
                    type="button"
                    role="option"
                    aria-selected={activeIndex === index}
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                      activeIndex === index ? "bg-accent-soft" : "hover:bg-cream"
                    }`}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => {
                      setOpen(false);
                      router.push(`/product/${product.slug}`);
                    }}
                  >
                    <Image
                      src={product.image}
                      alt=""
                      width={40}
                      height={40}
                      className="h-10 w-10 rounded-lg border border-line bg-cream object-cover"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-semibold text-ink">
                        {product.name}
                      </span>
                      <span className="block text-[13px] text-ink-2">
                        {product.brand}
                        {product.sku ? ` · ${product.sku}` : ""}
                      </span>
                    </span>
                    {lowest && (
                      <span className="shrink-0 text-[14px] font-bold text-ink">
                        {formatPeso(lowest.price)}
                      </span>
                    )}
                  </button>
                );
              })}
                <button
                  type="button"
                  className="mt-1 flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-[14px] font-semibold text-ink-2 hover:bg-cream"
                  onClick={() => submit()}
                >
                See all results
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          )}
        </div>
      )}

      {query && (
        <button
          type="button"
          className="absolute right-[60px] top-1/2 -translate-y-1/2 rounded-full p-2.5 text-ink-3 hover:text-ink"
          onClick={() => {
            setQuery("");
            inputRef.current?.focus();
          }}
          aria-label="Clear search"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
