'use client';

function unavailable() {
  return new Error(
    'The complete browser backup operation could not be confirmed. Keep the backup copy.',
  );
}

/** Bound file reads, hashing and storage together; late work must not start another transaction. */
export function backupOperation<T>(
  signal: AbortSignal,
  run: (signal: AbortSignal, check: () => void) => Promise<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const deadline = performance.now() + 30_000;
    let settled = false;
    const finish = (result: { value: T } | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      controller.abort();
      if (result) resolve(result.value);
      else reject(unavailable());
    };
    const cancel = () => finish(null);
    const timer = setTimeout(cancel, 30_000);
    const check = () => {
      if (settled || signal.aborted || controller.signal.aborted || performance.now() >= deadline)
        throw unavailable();
    };
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) {
      cancel();
      return;
    }
    void Promise.resolve()
      .then(() => {
        check();
        return run(controller.signal, check);
      })
      .then(
        (value) => {
          try {
            check();
            finish({ value });
          } catch {
            finish(null);
          }
        },
        () => finish(null),
      );
  });
}
export async function backupHash(raw: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
