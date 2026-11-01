"use client";

import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  analyticsEnabled,
  isConsentPending,
  reviewConsent,
  setConsent,
  subscribeToConsent,
} from "@/lib/analytics";

/** Asks before any analytics load. The server renders nothing because the answer is in localStorage. */
export function ConsentBanner() {
  const pending = useSyncExternalStore(subscribeToConsent, isConsentPending, () => false);
  if (!pending) return null;

  return (
    <section
      aria-label="Analytics cookies"
      className="fixed inset-x-2 bottom-2 z-50 mx-auto max-w-xl motion-safe:rise sm:inset-x-4 sm:bottom-4"
    >
      <Card size="sm" variant="navy" className="shadow-md">
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
          <p className="flex-1 type-caption text-muted-foreground">
            Feed in Docs would like to use cookies to collect usage data and improve the product.
            Nothing is collected if you decline.
          </p>
          <div className="flex gap-2">
            <Button size="sm" className="flex-1" onClick={() => setConsent("granted")}>
              Accept
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="flex-1"
              onClick={() => setConsent("denied")}
            >
              Decline
            </Button>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

/** Footer link that lets a visitor change their answer, as easily as they gave it. */
export function CookieSettings() {
  if (!analyticsEnabled) return null;

  return (
    <>
      {" · "}
      <Button
        variant="link"
        className="h-auto border-0 p-0 align-baseline font-medium text-inherit underline underline-offset-3 hover:text-foreground"
        onClick={reviewConsent}
      >
        Cookie settings
      </Button>
    </>
  );
}
