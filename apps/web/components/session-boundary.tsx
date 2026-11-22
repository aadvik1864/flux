"use client";

import type { ReactNode } from "react";
import { SessionProvider } from "./session";

export function SessionBoundary({ children }: { children: ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
