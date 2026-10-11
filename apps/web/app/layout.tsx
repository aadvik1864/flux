import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SessionProvider } from "../components/session";
import { ColorThemeProvider } from "../components/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: "Flux — a shared space for your next idea",
  description: "Work together on shared documents. A foundation for safe experiments and decisions that stay connected.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en" suppressHydrationWarning><body><ColorThemeProvider><SessionProvider>{children}</SessionProvider></ColorThemeProvider></body></html>;
}
