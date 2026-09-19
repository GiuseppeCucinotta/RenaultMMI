export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Polls `predicate` until true (or throws after `timeoutMs`). */
export async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  label = "condition",
  timeoutMs = 5000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await sleep(20);
  }
  throw new Error(`timed out waiting for ${label}`);
}

export interface ApiResult<T> {
  status: number;
  body: T;
}

export async function apiGet<T>(url: string): Promise<ApiResult<T>> {
  return readResponse<T>(await fetch(url));
}

export async function apiPost<T>(url: string, payload: unknown): Promise<ApiResult<T>> {
  return readResponse<T>(
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

async function readResponse<T>(response: Response): Promise<ApiResult<T>> {
  return { status: response.status, body: (await response.json()) as T };
}
