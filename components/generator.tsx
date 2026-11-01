"use client";

import { FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  CircleQuestionMark,
  Clipboard,
  Download,
  Link2,
  RotateCcw,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { FeedbackForm } from "@/components/feedback-form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { badgeVariants } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CodeBlock, CodeBlockContent } from "@/components/ui/code-block";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Item, ItemActions, ItemContent, ItemGroup, ItemTitle } from "@/components/ui/item";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type Result = { text: string; count: number; failed: number; link: string | null };
type Phase = "idle" | "loading" | "result";
type CopyTarget = "link" | "text";
type CopyFeedback = { target: CopyTarget; ok: boolean };

const EXAMPLES = [
  { label: "Next.js", url: "https://nextjs.org/docs" },
  { label: "Tailwind CSS", url: "https://tailwindcss.com/docs" },
  { label: "AI SDK", url: "https://ai-sdk.dev/docs" },
];

const LOADING_MESSAGES = [
  "Reading the sitemap",
  "Following documentation links",
  "Extracting titles and descriptions",
  "Composing your llms.txt",
];

/** The API reports no progress, so the timer stops on the crawl, which takes nearly all the time. */
const CRAWL_STEP = 1;

/** Kept visible by MiddleTruncate: the end of a URL is what tells two docs sections apart. */
const URL_TAIL_LENGTH = 16;

/** Lets labels wrap inside the button when a large text setting outgrows the column. */
const ACTION_CLASS = "h-auto min-h-12 whitespace-normal";

const numberFormat = new Intl.NumberFormat();

function formatElapsed(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const seconds = totalSeconds % 60;
  if (hours) return `${hours}h ${minutes}m`;
  return minutes ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

/** Vercel's own failures are plain text, so these statuses have no JSON error to show. */
function statusMessage(status: number) {
  if (status === 413) return "This site's index is too large. Try a narrower URL.";
  if (status === 504) return "This site took too long to crawl. Try a narrower URL.";
  return "Could not generate llms.txt. Try again in a moment.";
}

async function requestLlmsTxt(url: string): Promise<Result> {
  let response: Response;
  try {
    response = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
  } catch {
    throw new Error("Could not reach Feed in Docs. Check your connection and try again.");
  }
  const body = await response.text();
  let data: (Result & { error?: string }) | null = null;
  try {
    data = JSON.parse(body);
  } catch {
    /* Reported below from the status code. */
  }
  if (!response.ok || !data) throw new Error(data?.error || statusMessage(response.status));
  return data;
}

async function writeToClipboard(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const helper = document.createElement("textarea");
    helper.value = value;
    helper.style.position = "fixed";
    helper.style.opacity = "0";
    document.body.appendChild(helper);
    helper.select();
    const copied = document.execCommand("copy");
    helper.remove();
    return copied;
  }
}

/** The interactive tool. It sits in its own client module so the page can stay a server component. */
export function Generator() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [copyFeedback, setCopyFeedback] = useState<CopyFeedback | null>(null);
  const copyTimer = useRef<number>(undefined);

  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (phase !== "idle") return;
    // Read from the form, not state: browsers restore this field on refresh before React hydrates.
    const url = String(new FormData(event.currentTarget).get("url") ?? "");
    setError("");
    setCopyFeedback(null);
    setSourceUrl(url);
    setPhase("loading");
    try {
      setResult(await requestLlmsTxt(url));
      setPhase("result");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not generate llms.txt.");
      setPhase("idle");
    }
  }

  function reset() {
    setResult(null);
    setError("");
    setCopyFeedback(null);
    setPhase("idle");
  }

  async function copy(target: CopyTarget) {
    const value = target === "link" ? result?.link : result?.text;
    if (!value) return;
    const ok = await writeToClipboard(value);
    window.clearTimeout(copyTimer.current);
    setCopyFeedback({ target, ok });
    copyTimer.current = window.setTimeout(() => setCopyFeedback(null), 2000);
  }

  function download() {
    if (!result) return;
    const blob = new Blob([result.text], { type: "text/plain;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = "llms.txt";
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(href), 1000);
  }

  return (
    <Card variant="panel" className="mx-auto w-full max-w-page">
      {phase === "result" && result ? (
        <ResultStage
          result={result}
          sourceUrl={sourceUrl}
          copyFeedback={copyFeedback}
          onCopy={copy}
          onDownload={download}
          onReset={reset}
        />
      ) : phase === "idle" ? (
        <IdleStage defaultUrl={sourceUrl} error={error} onSubmit={generate} />
      ) : (
        <LoadingStage url={sourceUrl} />
      )}
    </Card>
  );
}

function IdleStage({
  defaultUrl,
  error,
  onSubmit,
}: {
  defaultUrl: string;
  error: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  function pickExample(example: string) {
    if (!inputRef.current) return;
    inputRef.current.value = example;
    inputRef.current.focus();
  }

  return (
    <CardContent className="mx-auto flex w-full max-w-3xl flex-col items-center gap-8 text-center motion-safe:rise">
      <div className="flex w-full flex-col items-center gap-4">
        <h1 className="type-display text-balance wrap-anywhere">
          Docs in. <br />
          llms.txt out.
        </h1>
        <p className="max-w-xl type-body-lg text-muted-foreground">
          Paste a documentation URL. We&apos;ll crawl the site, collect every page, and compose a
          concise index you can paste straight into your agent&apos;s context.
        </p>
      </div>

      <form onSubmit={onSubmit} className="w-full">
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="docs-url" className="sr-only">
              Documentation URL
            </FieldLabel>
            <InputGroup className="h-16">
              <InputGroupInput
                ref={inputRef}
                id="docs-url"
                name="url"
                type="url"
                required
                placeholder="https://example.com/docs"
                defaultValue={defaultUrl}
                autoComplete="url"
                className="max-sm:pl-3"
              />
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  type="submit"
                  variant="default"
                  size="sm"
                  className="max-sm:size-12 max-sm:px-0!"
                >
                  <span className="sr-only sm:not-sr-only">Generate llms.txt</span>
                  <ArrowRight data-icon="inline-end" />
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
            <div className="flex flex-wrap items-center justify-center gap-2 text-muted-foreground">
              <span>No page cap, no account needed. Try:</span>
              {EXAMPLES.map((example) => (
                <Button
                  key={example.url}
                  type="button"
                  variant="secondary"
                  size="xs"
                  onClick={() => pickExample(example.url)}
                >
                  {example.label}
                </Button>
              ))}
            </div>
          </Field>
        </FieldGroup>
      </form>

      {error && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </CardContent>
  );
}

function LoadingStage({ url }: { url: string }) {
  const elapsedRef = useRef<HTMLSpanElement>(null);
  const [step, setStep] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setStep((index) => Math.min(index + 1, CRAWL_STEP)), 2600);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const startedAt = Date.now();
    const id = window.setInterval(() => {
      if (elapsedRef.current) {
        elapsedRef.current.textContent = formatElapsed(Math.round((Date.now() - startedAt) / 1000));
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <CardContent className="mx-auto flex w-full max-w-2xl flex-col gap-6 motion-safe:rise">
      <div className="flex min-w-0 flex-col gap-2 text-center">
        <h2 className="type-headline-lg wrap-anywhere">Indexing your docs</h2>
        <MiddleTruncate text={url} className="text-muted-foreground" />
      </div>

      <ItemGroup className="gap-2">
        {LOADING_MESSAGES.map((message, index) => {
          const active = index === step;
          return (
            <Item
              key={message}
              role="listitem"
              aria-current={active ? "step" : undefined}
              className={cn(active ? "bg-background" : "opacity-30")}
            >
              <ItemContent>
                <span className={cn("type-caption", active && "text-rank dark:text-brand")}>
                  Step {index + 1}
                </span>
                <ItemTitle className="text-xl font-bold wrap-anywhere">{message}</ItemTitle>
              </ItemContent>
              {active && (
                <ItemActions>
                  <Spinner aria-hidden className="size-5" />
                </ItemActions>
              )}
            </Item>
          );
        })}
      </ItemGroup>

      <p className="text-center text-muted-foreground">
        <span ref={elapsedRef} className="tabular-nums">
          0s
        </span>{" "}
        so far. Large sites can take a few minutes.
      </p>

      <p aria-live="polite" className="sr-only">
        {LOADING_MESSAGES[step]}
      </p>
    </CardContent>
  );
}

/** Pass `href` to make the URL a link. It opens a new tab because the result only lives in state. */
function MiddleTruncate({
  text,
  prefix,
  href,
  className,
}: {
  text: string;
  prefix?: string;
  href?: string;
  className?: string;
}) {
  const characters = Array.from(text);
  const start = characters.slice(0, -URL_TAIL_LENGTH).join("");
  const end = characters.slice(-URL_TAIL_LENGTH).join("");
  const label = (
    <>
      <span className="truncate">{start}</span>
      <span className="shrink-0">{end}</span>
    </>
  );
  return (
    <p title={text} className={cn("flex w-full min-w-0 justify-center gap-1", className)}>
      {prefix && <span className="shrink-0">{prefix}</span>}
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="flex min-w-0 underline underline-offset-3 hover:text-foreground"
        >
          {label}
        </a>
      ) : (
        <span className="flex min-w-0">{label}</span>
      )}
    </p>
  );
}

/** A result count whose tooltip says what it measures. */
function CountBadge({
  variant,
  hint,
  children,
}: {
  variant: "brand" | "secondary";
  hint: string;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        aria-description={hint}
        className={cn(badgeVariants({ variant }), "cursor-help")}
      >
        <CircleQuestionMark data-icon="inline-start" />
        {children}
      </TooltipTrigger>
      <TooltipContent>{hint}</TooltipContent>
    </Tooltip>
  );
}

function CopyButton({
  target,
  label,
  icon: Icon,
  variant,
  feedback,
  onCopy,
}: {
  target: CopyTarget;
  label: string;
  icon: LucideIcon;
  variant: "default" | "outline";
  feedback: CopyFeedback | null;
  onCopy: (target: CopyTarget) => void;
}) {
  const active = feedback?.target === target ? feedback : null;
  const StateIcon = active ? (active.ok ? Check : TriangleAlert) : Icon;
  return (
    <Button
      type="button"
      variant={variant}
      className={cn(ACTION_CLASS, "lg:min-w-42")}
      onClick={() => onCopy(target)}
    >
      <StateIcon data-icon="inline-start" />
      {active ? (active.ok ? "Copied" : "Copy failed") : label}
    </Button>
  );
}

function ResultStage({
  result,
  sourceUrl,
  copyFeedback,
  onCopy,
  onDownload,
  onReset,
}: {
  result: Result;
  sourceUrl: string;
  copyFeedback: CopyFeedback | null;
  onCopy: (target: CopyTarget) => void;
  onDownload: () => void;
  onReset: () => void;
}) {
  return (
    <CardContent
      role="status"
      aria-label="Generated llms.txt"
      className="flex w-full flex-col gap-6 motion-safe:rise"
    >
      <div className="flex min-w-0 flex-col items-center gap-3 text-center">
        <h2 className="type-headline-lg wrap-anywhere">Your llms.txt is ready</h2>
        <div className="flex flex-wrap justify-center gap-2">
          <CountBadge variant="brand" hint="Pages we read and listed in this llms.txt.">
            {numberFormat.format(result.count)} {result.count === 1 ? "page" : "pages"} indexed
          </CountBadge>
          {result.failed > 0 && (
            <CountBadge
              variant="secondary"
              hint="Pages we found but couldn't read, so they're not in this llms.txt. They may be broken, blocked, too large, or too slow to load."
            >
              {numberFormat.format(result.failed)} unreadable
            </CountBadge>
          )}
        </div>
        <MiddleTruncate
          text={sourceUrl}
          prefix="Indexed from"
          href={sourceUrl}
          className="text-muted-foreground"
        />
      </div>

      <CodeBlock className="max-h-96 min-h-72 rounded-2xl bg-background text-xs dark:bg-background">
        {/* aria-live opts out of the stage's status role, which would read the whole file aloud. */}
        <CodeBlockContent
          wrap
          role="region"
          aria-label="llms.txt content"
          aria-live="off"
          className="px-5 py-3 leading-6 data-wrap:wrap-anywhere"
        >
          {result.text}
        </CodeBlockContent>
      </CodeBlock>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-center">
        {result.link ? (
          <Input
            readOnly
            value={result.link}
            aria-label="Link to this llms.txt"
            onFocus={(event) => event.currentTarget.select()}
            className="col-span-full font-mono text-xs lg:flex-1"
          />
        ) : (
          <p className="col-span-full text-muted-foreground lg:flex-1">
            We couldn&apos;t save a link this time. You can still copy or download the text.
          </p>
        )}
        {result.link && (
          <CopyButton
            target="link"
            label="Copy link"
            icon={Link2}
            variant="default"
            feedback={copyFeedback}
            onCopy={onCopy}
          />
        )}
        <CopyButton
          target="text"
          label="Copy text"
          icon={Clipboard}
          variant={result.link ? "outline" : "default"}
          feedback={copyFeedback}
          onCopy={onCopy}
        />
        <Button type="button" variant="outline" className={ACTION_CLASS} onClick={onDownload}>
          <Download data-icon="inline-start" />
          Download
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={onReset}
          className={cn(ACTION_CLASS, !result.link && "col-span-full")}
        >
          <RotateCcw data-icon="inline-start" />
          Start over
        </Button>
      </div>

      <FeedbackForm sourceUrl={sourceUrl} pageCount={result.count} failedCount={result.failed} />
    </CardContent>
  );
}
