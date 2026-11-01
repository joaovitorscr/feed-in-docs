import Link from "next/link";

import { ThemeToggle } from "@/components/theme-toggle";

/** Sticky bar for every page. The wordmark links home. */
function SiteHeader() {
  return (
    <header className="sticky top-0 z-10 bg-background/(--nav-glass) shadow-sm backdrop-blur-nav">
      <div className="mx-auto flex h-22 w-full max-w-page items-center justify-between gap-6 px-6 md:px-16">
        <Link href="/" className="min-w-0 text-xl font-extrabold tracking-tight text-brand">
          feed in docs
        </Link>
        <ThemeToggle />
      </div>
    </header>
  );
}

export { SiteHeader };
