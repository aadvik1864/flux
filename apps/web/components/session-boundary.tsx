"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { SessionProvider } from "./session";

export function SessionBoundary({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return pathname === "/demo" ? children : <SessionProvider>{children}</SessionProvider>;
}
