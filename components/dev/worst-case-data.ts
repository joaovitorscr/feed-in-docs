import { escapeMarkdown, truncate } from "@/lib/text";

/**
 * Fixtures for the dev-only data toggle. Each one stands in for POST /api/generate.
 * Every `text` value is shaped like generateLlmsTxt output, including its cleaning and its limits
 * (title 100 chars, description 180 chars), so the data is what the real generator can emit.
 */

export type Scenario = {
  label: string;
  /** Typed into the real form, so it reaches the page the way a user's URL does. */
  url: string;
  respond: () => Promise<Response> | Response;
};

const json = (body: unknown, status = 200) => Response.json(body, { status });

function llmsTxt(project: string, summary: string, lines: string[]) {
  return [`# ${project}`, "", `> ${summary}`, "", "## Documentation", "", ...lines, ""].join("\n");
}

function page(title: string, url: string, description = "") {
  const label = escapeMarkdown(truncate(title.replace(/\s*:+\s*/g, " "), 100));
  const summary = description ? `: ${escapeMarkdown(truncate(description, 180))}` : "";
  return `- [${label}](${url})${summary}`;
}

const DEMO_URL = "https://acme.example.com/docs";
const DEMO_TEXT = llmsTxt("Acme Docs", "Guides and API reference for Acme.", [
  page("Introduction", `${DEMO_URL}/introduction`, "What Acme is and who it is for."),
  page("Quickstart", `${DEMO_URL}/quickstart`, "Send your first request in five minutes."),
  page("Authentication", `${DEMO_URL}/authentication`, "Create and rotate API keys."),
  page("Webhooks", `${DEMO_URL}/webhooks`, "Receive events from Acme."),
]);

const WORST_ORIGIN = "https://developer-documentation.northwind-industries-holdings.example.com";
const WORST_URL = `${WORST_ORIGIN}/en-US/platform/v12/documentation/reference/authentication/service-accounts/rotating-credentials-without-downtime`;
const WORST_PAGE = `${WORST_ORIGIN}/en-US/platform/v12/documentation`;
const LONG_DESCRIPTION =
  "Rotate service account credentials without dropping in-flight requests, including the overlap window, the audit log entries it writes, and what happens when a rotation fails partway";

const WORST_LINES = [
  page(
    "useState<T>() [legacy] & friends",
    `${WORST_PAGE}/reference/hooks/use-state.md`,
    LONG_DESCRIPTION,
  ),
  page(
    "Configuring single sign-on with SAML 2.0 for enterprise workspaces that use more than one identity provider",
    `${WORST_PAGE}/guides/enterprise/identity/configuring-single-sign-on-with-saml-for-multiple-identity-providers.md`,
    LONG_DESCRIPTION,
  ),
  // The emoji straddles the 180-char description limit, so the limit must drop all of it.
  page(
    "Release notes",
    `${WORST_PAGE}/changelog`,
    `${"What shipped this quarter across the platform, the SDKs, and the command line tools, with migration notes for every breaking change we made to the public API since v11. ".padEnd(179, "-")}🚀 and more`,
  ),
  page("Middleware: Rewrites", `${WORST_PAGE}/guides/middleware-rewrites`),
  page("FAQ", `${WORST_PAGE}/faq`),
  page(
    "快速入门指南",
    `${WORST_PAGE}/zh-CN/kuai-su-ru-men`,
    "了解如何在五分钟内创建第一个工作区并发送第一个请求。",
  ),
  page(
    "البدء السريع",
    `${WORST_PAGE}/ar/getting-started`,
    "تعرّف على كيفية إنشاء مساحة العمل الأولى وإرسال أول طلب.",
  ),
  page(
    "Hướng dẫn cài đặt nhanh",
    `${WORST_PAGE}/vi/huong-dan`,
    "Đặng Thị Ngọc Hân viết về cách cài đặt.",
  ),
  page("<script>alert(1)</script> &amp; **bold**", `${WORST_PAGE}/escaping`, "Line one Line two"),
];

function padTo(count: number, lines: string[]) {
  const rest = Array.from({ length: Math.max(0, count - lines.length) }, (_, index) =>
    page(
      `Reference page ${index + 1}, generated from the OpenAPI schema for the admin endpoints`,
      `${WORST_PAGE}/reference/admin/endpoints/page-${index + 1}.md`,
      LONG_DESCRIPTION,
    ),
  );
  return [...lines, ...rest];
}

const WORST_PROJECT = "Northwind Platform Docs";
const WORST_SUMMARY = "Documentation for Northwind Platform Docs.";

const LINK = "http://localhost:3000/l/9f8e7d6c5b4a3210/llms.txt";

/** The largest result that fits Vercel's 4.5 MB function response limit, with no page cap. */
const HUGE_COUNT = 10_500;

export const SCENARIOS: Record<string, Scenario> = {
  demo: {
    label: "Demo data",
    url: DEMO_URL,
    respond: () => json({ text: DEMO_TEXT, count: 4, failed: 0, link: LINK }),
  },
  worst: {
    label: "Worst case",
    url: WORST_URL,
    respond: () =>
      json({
        text: llmsTxt(WORST_PROJECT, WORST_SUMMARY, padTo(1284, WORST_LINES)),
        count: 1284,
        failed: 37,
        link: LINK,
      }),
  },
  one: {
    label: "One",
    url: `${WORST_ORIGIN}/docs/`,
    respond: () =>
      json({
        text: llmsTxt(WORST_ORIGIN.slice(8), `Documentation for ${WORST_ORIGIN.slice(8)}.`, [
          page("Home", `${WORST_ORIGIN}/docs/`),
        ]),
        count: 1,
        failed: 1,
        link: LINK,
      }),
  },
  failing: {
    label: "Mostly failed",
    url: DEMO_URL,
    respond: () =>
      json({
        text: llmsTxt("Acme Docs", "Documentation for Acme Docs.", [
          page("Sign in", `${DEMO_URL}/`),
        ]),
        count: 1,
        failed: 1283,
        link: LINK,
      }),
  },
  huge: {
    label: "10,500 rows",
    url: WORST_URL,
    respond: () =>
      json({
        text: llmsTxt(WORST_PROJECT, WORST_SUMMARY, padTo(HUGE_COUNT, WORST_LINES)),
        count: HUGE_COUNT,
        failed: 412,
        link: LINK,
      }),
  },
  nolink: {
    label: "No link",
    url: DEMO_URL,
    respond: () => json({ text: DEMO_TEXT, count: 4, failed: 0, link: null }),
  },
  loading: {
    label: "Loading",
    url: WORST_URL,
    respond: () => new Promise<Response>(() => {}),
  },
  timeout: {
    label: "Timeout",
    url: WORST_URL,
    // What Vercel returns when the crawl outlives the function, which no page cap makes reachable.
    respond: () =>
      new Response(
        "An error occurred with your deployment\n\nFUNCTION_INVOCATION_TIMEOUT\n\niad1::abcde-1234567890\n",
        { status: 504, headers: { "Content-Type": "text/plain" } },
      ),
  },
  offline: {
    label: "Offline",
    url: DEMO_URL,
    respond: () => Promise.reject(new TypeError("Failed to fetch")),
  },
  unreachable: {
    label: "Unreachable",
    url: WORST_URL,
    respond: () =>
      json({ error: "Could not connect to this website. Check the URL and try again." }, 400),
  },
};
