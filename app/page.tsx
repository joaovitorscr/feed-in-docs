"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import {
  ArrowRight,
  Check,
  Clipboard,
  Download,
  FileText,
  RotateCcw,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ThemeToggle } from "@/components/theme-toggle";

gsap.registerPlugin(useGSAP);

type Result = { text: string; count: number; failed: number };
type Phase = "idle" | "loading" | "result";

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

function hostOf(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export default function Page() {
  const [url, setUrl] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [loadingUrl, setLoadingUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.from("[data-header]", {
          y: -16,
          autoAlpha: 0,
          duration: 0.6,
          ease: "power3.out",
        });
        gsap.from("[data-footer]", { autoAlpha: 0, duration: 0.8, delay: 0.4 });
        gsap.to("[data-blob]", {
          y: 36,
          scale: 1.06,
          duration: 11,
          yoyo: true,
          repeat: -1,
          ease: "sine.inOut",
          stagger: 2,
        });
      });
    },
    { scope: appRef },
  );

  async function leaveStage() {
    if (!stageRef.current) return;
    await gsap.to(stageRef.current, {
      autoAlpha: 0,
      y: -18,
      scale: 0.99,
      duration: 0.28,
      ease: "power2.in",
    });
  }

  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (phase !== "idle") return;
    setError("");
    setCopied(false);
    setLoadingUrl(url);
    const request = fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    await leaveStage();
    setPhase("loading");
    try {
      const response = await request;
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not generate llms.txt.");
      setResult(data);
      await leaveStage();
      setPhase("result");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not generate llms.txt.");
      await leaveStage();
      setPhase("idle");
    }
  }

  async function reset() {
    await leaveStage();
    setResult(null);
    setError("");
    setCopied(false);
    setPhase("idle");
  }

  async function copy() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.text);
    } catch {
      const helper = document.createElement("textarea");
      helper.value = result.text;
      helper.style.position = "fixed";
      helper.style.opacity = "0";
      document.body.appendChild(helper);
      helper.select();
      document.execCommand("copy");
      helper.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
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
    <div ref={appRef} className="relative min-h-screen">
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <div className="fid-grid absolute inset-0" />
        <div data-blob className="fid-blob fid-blob-lg -top-40 left-1/2 -translate-x-1/2" />
        <div data-blob className="fid-blob fid-blob-md -left-40 top-1/2" />
        <div data-blob className="fid-blob fid-blob-md top-1/3 -right-40" />
      </div>

      <main className="relative mx-auto flex min-h-screen w-full max-w-3xl flex-col px-5 py-6 sm:px-8 sm:py-8">
        <header
          data-header
          className="flex items-center justify-between text-sm font-semibold tracking-tight"
        >
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <FileText className="size-4" />
            </span>
            feed in docs
          </div>
          <ThemeToggle />
        </header>

        <section className="flex flex-1 flex-col justify-center py-16">
          {phase === "idle" && (
            <div ref={stageRef}>
              <IdleStage url={url} onUrlChange={setUrl} error={error} onSubmit={generate} />
            </div>
          )}
          {phase === "loading" && (
            <div ref={stageRef}>
              <LoadingStage url={loadingUrl} />
            </div>
          )}
          {phase === "result" && result && (
            <div ref={stageRef}>
              <ResultStage
                result={result}
                sourceUrl={loadingUrl}
                copied={copied}
                onCopy={copy}
                onDownload={download}
                onReset={reset}
              />
            </div>
          )}
        </section>

        <footer data-footer className="border-t py-5 text-xs text-muted-foreground">
          A small tool for making documentation easier to find. Press{" "}
          <kbd className="rounded border bg-muted px-1 font-mono">d</kbd> to toggle the theme.
        </footer>
      </main>
    </div>
  );
}

function IdleStage({
  url,
  onUrlChange,
  error,
  onSubmit,
}: {
  url: string;
  onUrlChange: (value: string) => void;
  error: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.from("[data-entrance]", {
          y: 26,
          autoAlpha: 0,
          duration: 0.7,
          stagger: 0.09,
          ease: "power3.out",
        });
        const alert = rootRef.current?.querySelector("[data-alert]");
        if (alert) {
          gsap.fromTo(
            alert,
            { autoAlpha: 0, y: 8 },
            { autoAlpha: 1, y: 0, duration: 0.35, ease: "power2.out", delay: 0.25 },
          );
          gsap.to(alert, {
            keyframes: { x: [0, -7, 7, -4, 4, 0] },
            duration: 0.5,
            ease: "power1.inOut",
            delay: 0.3,
          });
        }
      });
    },
    { scope: rootRef },
  );

  function pickExample(example: string) {
    onUrlChange(example);
    inputRef.current?.focus();
  }

  return (
    <div ref={rootRef} className="max-w-2xl">
      <p
        data-entrance
        className="mb-5 inline-flex items-center gap-2 rounded-full border bg-card/60 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur"
      >
        <span className="size-1.5 rounded-full bg-emerald-500" />
        llms.txt index generator
      </p>
      <h1 data-entrance className="text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
        Docs in.{" "}
        <span className="bg-gradient-to-b from-foreground to-muted-foreground bg-clip-text text-transparent">
          llms.txt
        </span>{" "}
        out.
      </h1>
      <p data-entrance className="mt-5 max-w-xl text-base leading-7 text-muted-foreground">
        Paste a documentation URL. We&apos;ll crawl the site, collect every page, and compose a
        concise index you can paste straight into your agent&apos;s context.
      </p>

      <form data-entrance onSubmit={onSubmit} className="mt-9 space-y-3">
        <Label htmlFor="docs-url">Documentation URL</Label>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Input
            ref={inputRef}
            id="docs-url"
            type="url"
            required
            placeholder="https://example.com/docs"
            value={url}
            onChange={(event) => onUrlChange(event.target.value)}
            className="h-12 flex-1 text-base"
            autoComplete="url"
          />
          <Button type="submit" className="h-12 px-6 text-base">
            Generate llms.txt
            <ArrowRight className="size-4 transition-transform group-hover/button:translate-x-0.5" />
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-1 text-xs text-muted-foreground">
          <span>No page cap, no account needed. Try:</span>
          {EXAMPLES.map((example) => (
            <button
              key={example.url}
              type="button"
              onClick={() => pickExample(example.url)}
              className="rounded-full border bg-card/60 px-2.5 py-1 transition-colors hover:border-ring hover:bg-muted"
            >
              {example.label}
            </button>
          ))}
        </div>
      </form>

      {error && (
        <p
          data-alert
          role="alert"
          className="mt-6 flex items-start gap-2.5 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}

function LoadingStage({ url }: { url: string }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const messageRef = useRef<HTMLSpanElement>(null);
  const elapsedRef = useRef<HTMLSpanElement>(null);
  const [messageIndex, setMessageIndex] = useState(0);

  useEffect(() => {
    const id = window.setInterval(
      () => setMessageIndex((index) => (index + 1) % LOADING_MESSAGES.length),
      2600,
    );
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

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.from("[data-entrance]", {
          y: 18,
          autoAlpha: 0,
          duration: 0.5,
          stagger: 0.08,
          ease: "power3.out",
        });
        gsap.to("[data-pulse]", {
          scale: 1.1,
          duration: 0.9,
          yoyo: true,
          repeat: -1,
          ease: "sine.inOut",
        });
      });
    },
    { scope: rootRef },
  );

  useGSAP(
    () => {
      gsap.fromTo(
        messageRef.current,
        { autoAlpha: 0, y: 6 },
        { autoAlpha: 1, y: 0, duration: 0.35, ease: "power2.out" },
      );
    },
    { dependencies: [messageIndex] },
  );

  return (
    <div
      ref={rootRef}
      className="mx-auto max-w-xl rounded-2xl border bg-card/60 p-6 shadow-sm backdrop-blur sm:p-8"
    >
      <div data-entrance className="flex items-center gap-4">
        <span
          data-pulse
          className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground"
        >
          <FileText className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-medium tracking-tight">Indexing {hostOf(url)}</h2>
          <p className="truncate text-xs text-muted-foreground">{url}</p>
        </div>
        <span ref={elapsedRef} className="text-xs text-muted-foreground tabular-nums">
          0s
        </span>
      </div>

      <div
        data-entrance
        aria-hidden
        className="relative mt-7 h-1 w-full overflow-hidden rounded-full bg-muted"
      >
        <div className="fid-shimmer absolute inset-y-0 w-1/3 rounded-full bg-foreground/20" />
      </div>

      <p aria-live="polite" className="mt-3 text-sm text-muted-foreground">
        <span ref={messageRef} className="inline-block">
          {LOADING_MESSAGES[messageIndex]}…
        </span>
      </p>
    </div>
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
  copied: boolean;
  onCopy: () => void;
  onDownload: () => void;
  onReset: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const countRef = useRef<HTMLSpanElement>(null);
  const copiedIconRef = useRef<SVGSVGElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.from("[data-entrance]", {
          y: 20,
          autoAlpha: 0,
          duration: 0.6,
          stagger: 0.09,
          ease: "power3.out",
        });
        const counter = { n: 0 };
        gsap.to(counter, {
          n: result.count,
          duration: 1,
          ease: "power2.out",
          onUpdate: () => {
            if (countRef.current) {
              countRef.current.textContent = String(Math.round(counter.n));
            }
          },
        });
      });
      mm.add("(prefers-reduced-motion: reduce)", () => {
        if (countRef.current) countRef.current.textContent = String(result.count);
      });
    },
    { scope: rootRef },
  );

  useGSAP(
    () => {
      if (copied && copiedIconRef.current) {
        gsap.fromTo(
          copiedIconRef.current,
          { scale: 0.4 },
          { scale: 1, duration: 0.5, ease: "back.out(2.5)" },
        );
      }
    },
    { dependencies: [copied], scope: rootRef },
  );

  return (
    <div
      ref={rootRef}
      role="status"
      aria-label="Generated llms.txt"
      className="rounded-2xl border bg-card/60 p-5 shadow-sm backdrop-blur sm:p-7"
    >
      <div data-entrance className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold tracking-tight">Your llms.txt is ready</h2>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">Indexed from {sourceUrl}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs font-medium">
          <span className="inline-flex items-center gap-1.5 rounded-full border bg-muted/60 px-3 py-1">
            <span ref={countRef} className="tabular-nums font-semibold">
              0
            </span>
            pages
          </span>
          {result.failed > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full border bg-muted/60 px-3 py-1 text-muted-foreground">
              <TriangleAlert className="size-3.5" />
              {result.failed} unreadable
            </span>
          )}
        </div>
      </div>

      <Textarea
        data-entrance
        readOnly
        value={result.text}
        aria-label="llms.txt content"
        className="mt-5 max-h-96 min-h-72 resize-y font-mono text-xs leading-6"
      />

      <div data-entrance className="mt-5 flex flex-wrap items-center gap-3">
        <Button type="button" onClick={onCopy} className="px-5">
          {copied ? (
            <Check ref={copiedIconRef} className="size-4" />
          ) : (
            <Clipboard className="size-4" />
          )}
          {copied ? "Copied" : "Copy text"}
        </Button>
        <Button type="button" variant="outline" onClick={onDownload}>
          <Download className="size-4" />
          Download
        </Button>
        <Button type="button" variant="ghost" onClick={onReset} className="ml-auto">
          <RotateCcw className="size-4" />
          Start over
        </Button>
      </div>
    </div>
  );
}
