import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // No remotePatterns on purpose: every image the app ships is local
    // (/images/...). A wildcard here would let the optimizer fetch any host
    // on the internet at our expense — the classic accidental open proxy.
    qualities: [75, 100],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
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
        ],
      },
    ];
  },
};

export default nextConfig;
