import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // No X-Powered-By version fingerprint on responses.
  poweredByHeader: false,
  images: {
    // No remotePatterns on purpose: every image the app ships is local
    // (/images/...). A wildcard here would let the optimizer fetch any host
    // on the internet at our expense — the classic accidental open proxy.
    // 75 is the only quality any component requests; keeping a second entry
    // here would just invite quality={100} hero images (779 KB) back in.
    qualities: [75],
  },
  async headers() {
    // Content-Security-Policy is production-only: next dev needs an
    // eval/ws-capable policy for HMR, and next start never serves it. Every
    // source below is load-bearing — script-src 'unsafe-inline' because the
    // App Router ships its flight/bootstrap as inline scripts (hashes change
    // per render), style-src 'unsafe-inline' because React style attributes
    // need it, va.vercel-scripts.com only for the analytics script in dev.
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://va.vercel-scripts.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self'",
      "font-src 'self'",
      "connect-src 'self' https://va.vercel-scripts.com",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'self'",
    ].join("; ");

    const securityHeaders: { key: string; value: string }[] = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "SAMEORIGIN" },
      {
        key: "Referrer-Policy",
        value: "strict-origin-when-cross-origin",
      },
      {
        key: "Permissions-Policy",
        value: "camera=(), microphone=(), geolocation=()",
      },
      { key: "X-Download-Options", value: "noopen" },
      { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
      // HTTPS-only header: ignored over plain-HTTP responses, so local
      // http://localhost development is unaffected.
      {
        key: "Strict-Transport-Security",
        value: "max-age=31536000; includeSubDomains",
      },
    ];

    if (process.env.NODE_ENV === "production") {
      securityHeaders.push({ key: "Content-Security-Policy", value: csp });
    }

    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
