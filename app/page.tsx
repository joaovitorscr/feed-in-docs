"use client";

import { FormEvent, useState } from "react";
import { ArrowRight, Check, Clipboard, FileText, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Result = { text: string; count: number; limited: boolean };

export default function Page() {
  const [url, setUrl] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setResult(null);
    setCopied(false);
    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not generate llms.txt.");
      setResult(data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not generate llms.txt.");
    } finally {
      setLoading(false);
    }
  }

  async function copy() {
    if (!result) return;
    await navigator.clipboard.writeText(result.text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-5 py-8 sm:px-8 sm:py-12">
      <header className="flex items-center gap-2 text-sm font-semibold tracking-tight">
        <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <FileText className="size-4" />
        </span>
        feed in docs
      </header>

      <section className="flex flex-1 flex-col justify-center py-20">
        <div className="mb-10 max-w-2xl">
          <p className="mb-4 text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Documentation for agents
          </p>
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
            Turn docs into an llms.txt index.
          </h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-muted-foreground">
            Paste a documentation URL. We’ll find pages on that site and make a concise index you
            can copy into your agent’s context.
          </p>
        </div>

        <form onSubmit={generate} className="space-y-3">
          <Label htmlFor="docs-url">Documentation URL</Label>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Input
              id="docs-url"
              type="url"
              required
              placeholder="https://example.com/docs"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              className="h-11 flex-1"
            />
            <Button type="submit" disabled={loading} className="h-11 px-5">
              {loading ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <ArrowRight className="size-4" />
              )}
              {loading ? "Reading docs…" : "Generate llms.txt"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Reads up to 40 pages from the same documentation path. No account needed.
          </p>
        </form>

        {error && (
          <p
            role="alert"
            className="mt-6 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
          >
            {error}
          </p>
        )}

        {result && (
          <section className="mt-10 space-y-3" aria-label="Generated llms.txt">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="font-medium">Your llms.txt</h2>
                <p className="text-xs text-muted-foreground">
                  Indexed {result.count} {result.count === 1 ? "page" : "pages"}
                  {result.limited ? " · reached the 40-page limit" : ""}
                </p>
              </div>
              <Button type="button" variant="outline" onClick={copy}>
                {copied ? <Check className="size-4" /> : <Clipboard className="size-4" />}
                {copied ? "Copied" : "Copy text"}
              </Button>
            </div>
            <Textarea
              readOnly
              value={result.text}
              aria-label="llms.txt content"
              className="min-h-80 resize-y font-mono text-xs leading-6"
            />
          </section>
        )}
      </section>
      <footer className="border-t py-5 text-xs text-muted-foreground">
        A small tool for making documentation easier to find.
      </footer>
    </main>
  );
}
