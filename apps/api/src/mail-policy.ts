export const MAX_MAIL_ATTEMPTS = 12;
export const MAX_MAIL_RESENDS = 3;

export function mailFailure(error: unknown, attempts: number) {
  const value = error as { code?: unknown; responseCode?: unknown } | null;
  if (value?.code === "EAUTH") return { quarantine: true, kind: "smtp_auth" };
  if (typeof value?.responseCode === "number" && value.responseCode >= 500 && value.responseCode <= 599) return { quarantine: true, kind: "smtp_rejected" };
  if (attempts >= MAX_MAIL_ATTEMPTS) return { quarantine: true, kind: "retry_exhausted" };
  return { quarantine: false, kind: "smtp_temporary" };
}

export function mailRetryDelay(attempts: number) {
  return Math.min(3600, 2 ** Math.min(attempts, 12)) * 1000;
}
