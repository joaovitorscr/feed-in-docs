const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;

// Without a token, as in forks and local clones, the app runs with analytics off.
if (token) {
  // Dynamic because a static import puts about 100 KB of gzipped JS ahead of hydration.
  // Importing posthog-js statically anywhere else in the app brings that cost back.
  void import("posthog-js").then(({ default: posthog }) => {
    posthog.init(token, {
      api_host: "/ingest",
      ui_host: "https://us.posthog.com",
      defaults: "2026-08-30",
    });
  });
}
