import { Geist_Mono, Onest } from "next/font/google";
import dynamic from "next/dynamic";
import type { Metadata, Viewport } from "next";

import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AUTHOR_URL, SITE_DESCRIPTION, SITE_TITLE, SITE_URL } from "@/lib/site";
import { cn } from "@/lib/utils";

// A static import would ship the fixtures in a production chunk even though it never renders.
const DataToggle =
  process.env.NODE_ENV === "development"
    ? dynamic(() => import("@/components/dev/data-toggle").then((module) => module.DataToggle))
    : null;

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_TITLE,
    template: "%s | Feed in Docs",
  },
  description: SITE_DESCRIPTION,
  applicationName: "Feed in Docs",
  authors: [{ name: "joaovitorscr", url: AUTHOR_URL }],
  creator: "joaovitorscr",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#091723" },
  ],
};

const onest = Onest({
  subsets: ["latin"],
  variable: "--font-sans",
  fallback: ["system-ui", "sans-serif"],
});

// Not preloaded: mono text only appears below the fold, so it shouldn't compete with the hero.
const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  preload: false,
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn("antialiased", fontMono.variable, "font-sans", onest.variable)}
    >
      <body>
        <ThemeProvider>
          <TooltipProvider>
            {children}
            {DataToggle && <DataToggle />}
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
