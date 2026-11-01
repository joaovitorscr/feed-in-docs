import type { Metadata } from "next";

import { Generator } from "@/components/generator";
import { SiteHeader } from "@/components/site-header";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  CodeBlock,
  CodeBlockContent,
  CodeBlockHeader,
  CodeBlockTitle,
} from "@/components/ui/code-block";
import { Kbd } from "@/components/ui/kbd";
import { REPO_URL, SITE_DESCRIPTION, SITE_TITLE, SITE_URL } from "@/lib/site";

// Lives here, not in the root layout, because layout metadata also applies to 404 responses.
export const metadata: Metadata = {
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "Feed in Docs",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    locale: "en_US",
  },
  twitter: { card: "summary_large_image" },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "Feed in Docs",
  url: SITE_URL,
  description: SITE_DESCRIPTION,
  applicationCategory: "DeveloperApplication",
  operatingSystem: "Web",
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
};

const EXAMPLE = `# Acme

> Build and deploy Acme apps.

## Documentation

- [Introduction](https://acme.dev/docs): Build and deploy Acme apps.
- [Getting started](https://acme.dev/docs/getting-started.md): Install the CLI and deploy your first app.
- [Configuration](https://acme.dev/docs/configuration): Every option in acme.config.ts.`;

const STEPS = [
  {
    title: "Paste a docs URL",
    body: "The crawler stays on that site and inside one section, so /en/docs/guides/intro covers /en/docs/.",
  },
  {
    title: "We crawl the site",
    body: "It reads /sitemap.xml and any nested sitemaps, then follows links from each page. A site with no sitemap still works through links alone.",
  },
  {
    title: "Take your llms.txt",
    body: "Each page becomes one line with its title and a description of up to 180 characters. Copy the link, copy the text, or download the file.",
  },
];

const LINK_CLASS = "underline underline-offset-3 hover:text-foreground";

const QUESTIONS = [
  {
    question: "Is Feed in Docs free?",
    answer:
      "Yes. There's no account and no page cap. A very large site can hit the server's time limit, so try a narrower URL if a crawl fails.",
  },
  {
    question: "What's in the file?",
    answer:
      "A title, a short summary, and one line per page with a link and a description. It's an index, not a copy of your docs.",
  },
  {
    question: "How do I give it to my agent?",
    answer:
      "Paste the link into your agent's context, or save the text as a file in your project. The agent reads the index and fetches the pages it needs.",
  },
  {
    question: "Why did it find so few pages?",
    answer:
      "The crawler doesn't run JavaScript. A site that builds its navigation in the browser and has no sitemap yields few pages. The page count shows what the crawler reached, not the size of the docs.",
  },
  {
    question: "Who can see a saved link?",
    answer:
      "Anyone who has the link. We mark saved files noindex, so search engines leave them out. Generating the same docs again refreshes the file at the same link.",
  },
  {
    question: "Is there an API?",
    answer: (
      <>
        Yes. POST a JSON body with a <code className="font-mono">url</code> to{" "}
        <code className="font-mono">/api/generate</code> and you get back the text, the page counts,
        and the link. The{" "}
        <a href={`${REPO_URL}#api`} className={LINK_CLASS}>
          README has a curl example
        </a>
        .
      </>
    ),
  },
];

export default function Page() {
  return (
    <div className="flex min-h-screen flex-col">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      <SiteHeader />

      <main className="flex w-full flex-1 flex-col gap-20 px-6 py-10 md:gap-section md:py-16">
        <Generator />

        <section className="mx-auto grid w-full max-w-page items-center gap-8 md:grid-cols-2 md:gap-16">
          <div className="flex flex-col gap-4">
            <h2 className="type-headline-lg">What is llms.txt?</h2>
            <p className="type-body-lg text-muted-foreground">
              <a href="https://llmstxt.org" className={LINK_CLASS}>
                llms.txt
              </a>{" "}
              is a proposed standard for a Markdown file that lists a site&apos;s pages with a short
              description of each. A language model reads it to find the right page without parsing
              HTML.
            </p>
            <p className="type-body-lg text-muted-foreground">
              Most docs sites don&apos;t publish one, so coding agents guess at URLs. Feed in Docs
              crawls the site and writes the file for you.
            </p>
          </div>
          <CodeBlock>
            <CodeBlockHeader>
              <CodeBlockTitle>llms.txt</CodeBlockTitle>
            </CodeBlockHeader>
            <CodeBlockContent wrap className="data-wrap:wrap-anywhere">
              {EXAMPLE}
            </CodeBlockContent>
          </CodeBlock>
        </section>

        <section className="mx-auto flex w-full max-w-page flex-col gap-8">
          <div className="flex flex-col gap-4 text-center">
            <h2 className="type-headline-lg">How to generate llms.txt</h2>
            <p className="type-body-lg text-muted-foreground">
              No install and no account. You only need a URL.
            </p>
          </div>
          <ol className="grid gap-6 md:grid-cols-3">
            {STEPS.map((step, index) => (
              <li key={step.title}>
                <Card className="h-full">
                  <CardHeader>
                    <span className="type-caption text-rank dark:text-brand">Step {index + 1}</span>
                    <CardTitle>
                      <h3>{step.title}</h3>
                    </CardTitle>
                    <CardDescription>{step.body}</CardDescription>
                  </CardHeader>
                </Card>
              </li>
            ))}
          </ol>
        </section>

        <section className="mx-auto flex w-full max-w-page flex-col gap-8">
          <h2 className="text-center type-headline-lg">Common questions</h2>
          <div className="grid gap-x-16 gap-y-8 md:grid-cols-2">
            {QUESTIONS.map(({ question, answer }) => (
              <div key={question} className="flex flex-col gap-2">
                <h3 className="type-headline-md">{question}</h3>
                <p className="text-muted-foreground">{answer}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="mx-auto flex w-full max-w-page flex-col gap-1 px-6 pb-8 type-caption text-muted-foreground sm:flex-row sm:items-center sm:justify-between md:px-16">
        <p>
          A small tool for making documentation easier to find.{" "}
          <a href={REPO_URL} className={LINK_CLASS}>
            GitHub
          </a>{" "}
          ·{" "}
          <a href="/llms.txt" className={LINK_CLASS}>
            llms.txt
          </a>
        </p>
        <p>
          Press <Kbd>d</Kbd> to toggle the theme.
        </p>
      </footer>
    </div>
  );
}
