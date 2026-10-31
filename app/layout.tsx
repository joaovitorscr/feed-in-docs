import { Geist_Mono, Onest } from "next/font/google";
import type { Metadata, Viewport } from "next";

import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SITE_URL } from "@/lib/site";
import { cn } from "@/lib/utils";

const TITLE = "Feed in Docs — llms.txt generator";
const DESCRIPTION =
  "Paste a documentation URL and get a copyable llms.txt index for your agent's context.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: TITLE,
    template: "%s — Feed in Docs",
  },
  description: DESCRIPTION,
  applicationName: "Feed in Docs",
  keywords: ["llms.txt", "llms", "documentation", "docs", "agent", "AI", "context", "index"],
  authors: [{ name: "joaovitorscr", url: "https://github.com/joaovitorscr" }],
  creator: "joaovitorscr",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "Feed in Docs",
    title: TITLE,
    description: DESCRIPTION,
    locale: "en",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
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

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#091723" },
  ],
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "Feed in Docs",
  url: SITE_URL,
  description: DESCRIPTION,
  applicationCategory: "DeveloperApplication",
  operatingSystem: "Web",
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
};

const onest = Onest({
  subsets: ["latin"],
  variable: "--font-sans",
  fallback: ["system-ui", "sans-serif"],
});

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
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
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        <ThemeProvider>
          <TooltipProvider>
            <Toaster>{children}</Toaster>
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
