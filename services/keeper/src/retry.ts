export interface RetryOptions {
  attempts?: number;
  baseMs?: number;
  maxMs?: number;
  /** Return false for errors that will never succeed on retry (e.g. program constraint failures). */
  retryable?: (e: unknown) => boolean;
  onRetry?: (e: unknown, attempt: number, delayMs: number) => void;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Exponential backoff with full jitter. */
export async function withRetry<T>(fn: (attempt: number) => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const { attempts = 5, baseMs = 300, maxMs = 8_000, retryable = isTransientError, onRetry, sleep = defaultSleep } = opts;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (e) {
      lastErr = e;
      if (attempt === attempts || !retryable(e)) break;
      const delay = Math.floor(Math.random() * Math.min(maxMs, baseMs * 2 ** (attempt - 1)));
      onRetry?.(e, attempt, delay);
      await sleep(delay);
    }
  }
  throw lastErr;
}

/** RPC / network failures are transient; program errors are not. */
export function isTransientError(e: unknown): boolean {
  const msg = String((e as Error)?.message ?? e);
  if (/custom program error|Error Code:|AnchorError|ConstraintSeeds|already in use/i.test(msg)) return false;
  return /429|5\d\d|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|fetch failed|socket hang up|Blockhash not found|block height exceeded|timed out|Node is behind|TransactionExpired/i.test(
    msg,
  );
}

/** Extracts an Anchor error name (e.g. "RoundStillOpen") from a failed transaction. */
export function anchorErrorName(e: unknown): string | null {
  const text = [String((e as any)?.message ?? e), ...(((e as any)?.logs as string[]) ?? [])].join("\n");
  return /Error Code: (\w+)/.exec(text)?.[1] ?? null;
}
