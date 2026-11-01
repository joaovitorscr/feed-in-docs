import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PostHog's API paths end in a slash, which Next.js would otherwise answer with a redirect.
  skipTrailingSlashRedirect: true,
  // Serves PostHog from our own origin, because tracking blockers are common among developers.
  // Rules run in order, so the asset paths must stay above the catch-all.
  async rewrites() {
    return [
      {
        source: "/ingest/static/:path*",
        destination: "https://us-assets.i.posthog.com/static/:path*",
      },
      {
        source: "/ingest/array/:path*",
        destination: "https://us-assets.i.posthog.com/array/:path*",
      },
      {
        source: "/ingest/:path*",
        destination: "https://us.i.posthog.com/:path*",
      },
    ];
  },
};

export default nextConfig;
