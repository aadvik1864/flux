import type { Metadata } from "next";
import type { ReactNode } from "react";
import localFont from "next/font/local";
import { headers } from "next/headers";
import { SessionBoundary } from "../components/session-boundary";
import { ColorThemeProvider } from "../components/theme";
import "./globals.css";

const sora = localFont({ src: "./fonts/SoraLatin.woff2", variable: "--font-sora", weight: "100 800", display: "swap" });
const sourceSans = localFont({ src: "./fonts/SourceSans3Latin.woff2", variable: "--font-source-sans", weight: "200 900", display: "swap" });

export const metadata: Metadata = {
  title: "Flux — a shared space for your next idea",
  description: "Work together on shared documents. A foundation for safe experiments and decisions that stay connected.",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en" className={`${sora.variable} ${sourceSans.variable}`} suppressHydrationWarning>
      <body>
        <ColorThemeProvider nonce={nonce}>
          <SessionBoundary>{children}</SessionBoundary>
        </ColorThemeProvider>
      </body>
    </html>
  );
}
