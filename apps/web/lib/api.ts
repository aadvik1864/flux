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
  }).catch((error: unknown) => {
    if (init.signal?.aborted) throw error;
    throw new ApiError("Flux did not respond. Wait a moment and try again.", 503);
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || (body === null && response.status !== 204)) {
    const message = body?.message;
    if (typeof message === "string") throw new ApiError(message, response.status);
    if (response.status === 429) {
      throw new ApiError("Flux is temporarily limiting requests. Wait a moment and try again.", 429);
    }
    if (response.status >= 500 || response.ok) {
      throw new ApiError("Flux is temporarily unavailable. Wait a moment and try again.", 503);
    }
    throw new ApiError("The request failed. Try again", response.status);
  }
  return body as T;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Try again";
}

export function safeRedirect(path: string | null): string {
  return path && path.startsWith("/") && !path.startsWith("//") && !/[\\\u0000-\u0020]/.test(path) ? path : "/";
}
