import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";

import { Providers } from "@/components/providers";
import { resolveLanguage } from "@/i18n/resources";

import "./globals.css";

export const metadata: Metadata = {
  title: "CherryChat",
  description: "A focused web app for AI conversations.",
  applicationName: "CherryChat",
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0d12" },
  ],
};

interface RootLayoutProps {
  children: ReactNode;
}

export default async function RootLayout({ children }: RootLayoutProps) {
  const requestHeaders = await headers();
  const initialLanguage = resolveLanguage(
    requestHeaders.get("accept-language"),
  );
  const nonce = requestHeaders.get("x-nonce") ?? undefined;

  return (
    <html lang={initialLanguage} suppressHydrationWarning>
      <body>
        <Providers initialLanguage={initialLanguage} nonce={nonce}>
          {children}
        </Providers>
      </body>
    </html>
  );
}
