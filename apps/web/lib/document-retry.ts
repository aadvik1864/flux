import { ApiError } from "./api";

export function isDocumentAccessError(error: unknown): boolean {
  return error instanceof ApiError && [401, 403, 404, 410].includes(error.status);
}

export function documentRetryDelay(attempt: number): number {
  return Math.min(30_000, 1000 * 2 ** Math.min(Math.max(0, attempt), 5));
}
