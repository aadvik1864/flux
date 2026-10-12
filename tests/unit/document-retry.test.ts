import { describe, expect, it } from "vitest";
import { ApiError } from "../../apps/web/lib/api";
import { documentRetryDelay, isDocumentAccessError } from "../../apps/web/lib/document-retry";
import { ribbonMotionBlend } from "../../apps/web/lib/ribbon-motion";

describe("document recovery", () => {
  it("separates denied access from transient outages and capacity limits", () => {
    for (const status of [401, 403, 404, 410]) expect(isDocumentAccessError(new ApiError("denied", status))).toBe(true);
    for (const status of [408, 429, 500, 502, 503, 504]) expect(isDocumentAccessError(new ApiError("busy", status))).toBe(false);
    expect(isDocumentAccessError(new TypeError("Failed to fetch"))).toBe(false);
  });
  it("caps reconnect backoff", () => {
    expect([0, 1, 2, 3, 4, 5, 100].map(documentRetryDelay)).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
  });
  it("settles the ribbon within wall-clock time even at very low frame rates", () => {
    expect(ribbonMotionBlend(100, 100)).toBeGreaterThan(ribbonMotionBlend(100, 16));
    expect(ribbonMotionBlend(1200, 500)).toBe(1);
    expect(ribbonMotionBlend(5000, 5000)).toBe(1);
    expect(ribbonMotionBlend(0, -1)).toBe(0);
  });
});
