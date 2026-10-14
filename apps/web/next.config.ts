import type { NextConfig } from "next";
import { resolve } from "node:path";

const config: NextConfig = {
  transpilePackages: ["@flux/shared", "@flux/document-model"],
  poweredByHeader: false,
  output: process.env.FLUX_STANDALONE === "true" ? "standalone" : undefined,
  outputFileTracingRoot: resolve(__dirname, "../.."),
  async rewrites() {
    if (process.env.VERCEL === "1" || process.env.FLUX_SHOWCASE_ONLY === "true") return [];
    return [{
      source: "/api/:path*",
      destination: `${process.env.API_INTERNAL_URL ?? "http://localhost:4000"}/:path*`,
    }];
  },
};

export default config;
