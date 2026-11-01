import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { SiteHeader } from "@/components/site-header";
import { buttonVariants } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

export const metadata: Metadata = {
  title: "Page not found",
  description: "This page doesn't exist on Feed in Docs.",
};

/** Next.js renders this with a 404 status for every URL that matches no route. */
export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="flex w-full flex-1 flex-col px-6 py-10 md:py-16">
        <Empty className="p-0">
          <EmptyHeader className="max-w-lg">
            <EmptyMedia className="type-stat text-rank dark:text-brand">404</EmptyMedia>
            <EmptyTitle>
              <h1 className="type-headline-lg">This page doesn&apos;t exist</h1>
            </EmptyTitle>
            <EmptyDescription>
              <p className="type-body-lg">
                Check the URL for typos, or head back and generate a new llms.txt.
              </p>
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Link href="/" className={buttonVariants()}>
              <ArrowLeft data-icon="inline-start" />
              Back to home
            </Link>
          </EmptyContent>
        </Empty>
      </main>
    </div>
  );
}
