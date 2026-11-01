"use client";

import { type FormEvent, useState, useSyncExternalStore } from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel, FieldTitle } from "@/components/ui/field";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { isAnalyticsAccepted, subscribeToConsent, trackEvent } from "@/lib/analytics";

const REASON_MAX_LENGTH = 500;

/**
 * Asks whether a generated llms.txt was helpful and sends the answer to PostHog as `llms_txt_feedback`.
 * Hidden until the visitor accepts analytics, because the banner promises nothing is collected otherwise.
 */
export function FeedbackForm({
  sourceUrl,
  pageCount,
  failedCount,
}: {
  sourceUrl: string;
  pageCount: number;
  failedCount: number;
}) {
  const accepted = useSyncExternalStore(subscribeToConsent, isAnalyticsAccepted, () => false);
  const [rating, setRating] = useState<string>();
  const [sent, setSent] = useState(false);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    trackEvent("llms_txt_feedback", {
      helpful: rating === "yes",
      reason: String(new FormData(event.currentTarget).get("reason") ?? "").trim(),
      source_url: sourceUrl,
      page_count: pageCount,
      failed_count: failedCount,
    });
    setSent(true);
  }

  if (!accepted) return null;

  return (
    <>
      <Separator />
      {sent ? (
        <p className="text-muted-foreground">Thanks for your feedback.</p>
      ) : (
        <form onSubmit={submit}>
          <FieldGroup className="gap-4">
            <Field orientation="responsive">
              <FieldTitle id="feedback-question">Was this llms.txt helpful?</FieldTitle>
              {/* Ignores deselecting, which would remove the textarea and whatever was typed in it. */}
              <ToggleGroup
                aria-labelledby="feedback-question"
                variant="outline"
                size="sm"
                value={rating ? [rating] : []}
                onValueChange={(values) => values[0] && setRating(values[0])}
              >
                <ToggleGroupItem value="yes">
                  <ThumbsUp data-icon="inline-start" />
                  Yes
                </ToggleGroupItem>
                <ToggleGroupItem value="no">
                  <ThumbsDown data-icon="inline-start" />
                  No
                </ToggleGroupItem>
              </ToggleGroup>
            </Field>
            {rating && (
              <>
                <Field>
                  <FieldLabel htmlFor="feedback-reason">
                    {rating === "yes" ? "What made it helpful?" : "What went wrong?"} (optional)
                  </FieldLabel>
                  <Textarea id="feedback-reason" name="reason" maxLength={REASON_MAX_LENGTH} />
                </Field>
                <Button type="submit" size="sm" className="self-start">
                  Send feedback
                </Button>
              </>
            )}
          </FieldGroup>
        </form>
      )}
    </>
  );
}
