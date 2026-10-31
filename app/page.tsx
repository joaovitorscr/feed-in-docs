"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  Clipboard,
  Download,
  Link2,
  RotateCcw,
  TriangleAlert,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Item, ItemActions, ItemContent, ItemGroup, ItemTitle } from "@/components/ui/item";
import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";

type Result = { text: string; count: number; failed: number; link: string | null };
type Phase = "idle" | "loading" | "result";
type CopyTarget = "link" | "text";

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

function hostOf(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export default function Page() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [copied, setCopied] = useState<CopyTarget | null>(null);

  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (phase !== "idle") return;
    // Read from the form, not state: browsers restore this field on refresh before React hydrates.
    const url = String(new FormData(event.currentTarget).get("url") ?? "");
    setError("");
    setCopied(null);
    setSourceUrl(url);
    setPhase("loading");
    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not generate llms.txt.");
      setResult(data);
      setPhase("result");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not generate llms.txt.");
      setPhase("idle");
    }
  }

  function reset() {
    setResult(null);
    setError("");
    setCopied(null);
    setPhase("idle");
  }

  async function copy(target: CopyTarget) {
    const value = target === "link" ? result?.link : result?.text;
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const helper = document.createElement("textarea");
      helper.value = value;
      helper.style.position = "fixed";
      helper.style.opacity = "0";
      document.body.appendChild(helper);
      helper.select();
      document.execCommand("copy");
      helper.remove();
    }
    setCopied(target);
    window.setTimeout(() => setCopied(null), 2000);
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
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 bg-background/(--nav-glass) shadow-sm backdrop-blur-nav">
        <div className="mx-auto flex h-22 w-full max-w-page items-center justify-between gap-6 px-6 md:px-16">
          <span className="text-xl font-extrabold tracking-tight whitespace-nowrap text-brand">
            feed in docs
          </span>
          <ThemeToggle />
        </div>
      </header>

      <main className="flex w-full flex-1 flex-col justify-center px-6 py-10 md:py-16">
        <Card variant="panel" className="mx-auto w-full max-w-page">
          {phase === "result" && result ? (
            <ResultStage
              result={result}
              sourceUrl={sourceUrl}
              copied={copied}
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
      </main>

      <footer className="mx-auto flex w-full max-w-page flex-col gap-1 px-6 pb-8 type-caption text-muted-foreground sm:flex-row sm:items-center sm:justify-between md:px-16">
        <p>A small tool for making documentation easier to find.</p>
        <p>
          Press <Kbd>d</Kbd> to toggle the theme.
        </p>
      </footer>
    </div>
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
      <div className="flex flex-col items-center gap-4">
        <h1 className="type-display text-balance">
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
        elapsedRef.current.textContent = `${Math.round((Date.now() - startedAt) / 1000)}s`;
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <CardContent className="mx-auto flex w-full max-w-2xl flex-col gap-6 motion-safe:rise">
      <div className="flex min-w-0 flex-col gap-2 text-center">
        <h2 className="type-headline-lg wrap-anywhere">Indexing {hostOf(url)}</h2>
        <p className="truncate text-muted-foreground">{url}</p>
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
                <ItemTitle className="text-xl font-bold">{message}</ItemTitle>
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

function ResultStage({
  result,
  sourceUrl,
  copied,
  onCopy,
  onDownload,
  onReset,
}: {
  result: Result;
  sourceUrl: string;
  copied: CopyTarget | null;
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
        <h2 className="type-headline-lg">Your llms.txt is ready</h2>
        <div className="flex flex-wrap justify-center gap-2">
          <Badge variant="brand">
            {result.count} {result.count === 1 ? "page" : "pages"} indexed
          </Badge>
          {result.failed > 0 && <Badge variant="secondary">{result.failed} unreadable</Badge>}
        </div>
        <p className="w-full truncate text-muted-foreground">Indexed from {sourceUrl}</p>
      </div>

      <Textarea
        readOnly
        value={result.text}
        aria-label="llms.txt content"
        className="max-h-96 min-h-72 resize-y font-mono text-xs leading-6"
      />

      <div className="flex flex-wrap items-center gap-3">
        {result.link ? (
          <Input
            readOnly
            value={result.link}
            aria-label="Link to this llms.txt"
            onFocus={(event) => event.currentTarget.select()}
            className="basis-full font-mono text-xs lg:flex-1 lg:basis-0"
          />
        ) : (
          <p className="basis-full text-muted-foreground lg:flex-1 lg:basis-0">
            We couldn&apos;t save a link this time. You can still copy or download the text.
          </p>
        )}
        {result.link && (
          <Button type="button" onClick={() => onCopy("link")}>
            {copied === "link" ? (
              <Check data-icon="inline-start" />
            ) : (
              <Link2 data-icon="inline-start" />
            )}
            {copied === "link" ? "Copied" : "Copy link"}
          </Button>
        )}
        <Button
          type="button"
          variant={result.link ? "outline" : "default"}
          onClick={() => onCopy("text")}
        >
          {copied === "text" ? (
            <Check data-icon="inline-start" />
          ) : (
            <Clipboard data-icon="inline-start" />
          )}
          {copied === "text" ? "Copied" : "Copy text"}
        </Button>
        <Button type="button" variant="outline" onClick={onDownload}>
          <Download data-icon="inline-start" />
          Download
        </Button>
        <Button type="button" variant="ghost" onClick={onReset}>
          <RotateCcw data-icon="inline-start" />
          Start over
        </Button>
      </div>
    </CardContent>
  );
}
