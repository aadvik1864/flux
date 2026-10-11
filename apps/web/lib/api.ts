export class ApiError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
    credentials: "same-origin",
    cache: "no-store",
    signal: init.signal ?? AbortSignal.timeout(45_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body?.message;
    throw new ApiError(typeof message === "string" ? message : "The request failed. Try again", response.status);
  }
  return body as T;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Try again";
}

export function safeRedirect(path: string | null): string {
  return path && path.startsWith("/") && !path.startsWith("//") && !/[\\\u0000-\u0020]/.test(path) ? path : "/";
}
