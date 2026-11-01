const CONSENT_KEY = "analytics-consent";

const LOCAL_HOSTS = ["localhost", "127.0.0.1"];

type Consent = "granted" | "denied";

const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;

/** Without a token, as in forks and preview deployments, there's no analytics and nothing to ask. */
export const analyticsEnabled = Boolean(token);

let sdk: Promise<typeof import("posthog-js")> | undefined;
// Keeps the visitor's answer for this page view when the browser blocks localStorage.
let sessionChoice: Consent | null = null;
let reviewing = false;
const listeners = new Set<() => void>();

function storedConsent() {
  try {
    const stored = localStorage.getItem(CONSENT_KEY);
    return stored === "granted" || stored === "denied" ? stored : null;
  } catch {
    return null;
  }
}

function currentConsent() {
  return sessionChoice ?? storedConsent();
}

/**
 * Loads PostHog once the visitor has accepted. Nothing reaches PostHog before that.
 * Keep posthog-js behind this import: a static one puts about 100 KB of gzipped JS ahead of hydration.
 */
export function startAnalytics() {
  if (!token || LOCAL_HOSTS.includes(location.hostname) || currentConsent() !== "granted") return;
  sdk ??= import("posthog-js");
  void sdk.then(({ default: posthog }) => {
    if (currentConsent() !== "granted") return;
    if (!posthog.__loaded) {
      posthog.init(token, {
        api_host: "/ingest",
        ui_host: "https://us.posthog.com",
        defaults: "2026-08-30",
      });
    } else if (posthog.has_opted_out_capturing()) {
      posthog.opt_in_capturing();
    }
  });
}

/** Opt-out alone leaves PostHog's cookies and storage in place, so this clears them too. */
function stopAnalytics() {
  void sdk?.then(({ default: posthog }) => {
    if (!posthog.__loaded) return;
    posthog.opt_out_capturing();
    posthog.persistence?.clear();
    posthog.sessionPersistence?.clear();
  });
}

export function subscribeToConsent(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function isConsentPending() {
  return analyticsEnabled && (reviewing || currentConsent() === null);
}

/** Reopens the banner so a visitor can change their answer. */
export function reviewConsent() {
  reviewing = true;
  listeners.forEach((listener) => listener());
}

export function setConsent(choice: Consent) {
  sessionChoice = choice;
  reviewing = false;
  try {
    localStorage.setItem(CONSENT_KEY, choice);
  } catch {
    /* sessionChoice still holds the answer for this page view. */
  }
  if (choice === "granted") startAnalytics();
  else stopAnalytics();
  listeners.forEach((listener) => listener());
}
