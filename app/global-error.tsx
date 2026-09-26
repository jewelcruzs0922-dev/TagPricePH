"use client";

/**
 * Last-resort boundary: fires only when the root layout itself fails, so it
 * has to render its own <html>/<body>. Same rule as app/error.tsx — the
 * exception is logged, never shown to the visitor.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  console.error("global error:", error.digest ?? error.name);
  return (
    <html lang="en-PH">
      <body
        style={{
          margin: 0,
          fontFamily: "system-ui, sans-serif",
          background: "#FAF8F1",
          color: "#172033",
          display: "flex",
          minHeight: "100vh",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          padding: "24px",
        }}
      >
        <div>
          <h1 style={{ fontSize: "26px", margin: 0 }}>
            TagPricePH is having trouble
          </h1>
          <p style={{ marginTop: "12px", color: "#475467" }}>
            We couldn&apos;t load the site right now. Please try again.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: "20px",
              padding: "12px 24px",
              borderRadius: "9999px",
              border: "none",
              background: "#F4D84A",
              color: "#172033",
              fontWeight: 700,
              cursor: "pointer",
              minHeight: "44px",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
