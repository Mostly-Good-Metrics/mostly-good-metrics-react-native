// Internal bound for unresponsive native plugin promises. Timing out does not
// cancel native I/O, so callers must quarantine writes rather than retry them.
export const NATIVE_TIMEOUT_MS = 5000;
export class NativeTimeoutError extends Error {}

export function withNativeDeadline<T>(operation: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new NativeTimeoutError('Native SDK operation timed out')), NATIVE_TIMEOUT_MS);
    (timer as unknown as { unref?: () => void }).unref?.();
    try {
      Promise.resolve(operation()).then(
        (value) => { clearTimeout(timer); resolve(value); },
        (error) => { clearTimeout(timer); reject(error); }
      );
    } catch (error) {
      clearTimeout(timer);
      reject(error);
    }
  });
}
