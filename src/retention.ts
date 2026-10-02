/** Bounds retained analytics data before serializing or capturing host objects. */
export const MAX_RETAINED_BYTES = 1024 * 1024;
export const MAX_VALUE_BYTES = 32 * 1024;
export function ownedSnapshot<T>(value: T): { value: T; bytes: number } | null {
  try {
    let remaining = MAX_VALUE_BYTES - 64;
    let nodes = 1024;
    const seen = new Set<object>();
    const take = (bytes: number): void => { remaining -= bytes; if (remaining < 0) throw new Error('Analytics value exceeds budget'); };
    const copy = (input: unknown, depth: number): unknown => {
      if (--nodes < 0 || depth > 16) throw new Error('Analytics value exceeds complexity budget');
      if (input === null || typeof input === 'boolean' || typeof input === 'number') { take(16); return input; }
      if (typeof input === 'string') { take(input.length * 2 + 8); return input; }
      if (typeof input !== 'object') return undefined;
      if (seen.has(input)) throw new Error('Cyclic analytics value');
      seen.add(input);
      let result: unknown;
      if (input instanceof Date) result = input.toISOString();
      else if (Array.isArray(input)) {
        if (input.length > nodes) throw new Error('Analytics array exceeds budget');
        take(input.length * 2);
        result = input.map((entry) => copy(entry, depth + 1));
      } else {
        const object: Record<string, unknown> = Object.create(null);
        for (const key in input) {
          if (!Object.prototype.hasOwnProperty.call(input, key)) continue;
          take(key.length * 2 + 8);
          object[key] = copy((input as Record<string, unknown>)[key], depth + 1);
        }
        result = object;
      }
      seen.delete(input);
      return result;
    };
    const json = JSON.stringify(copy(value, 0));
    if (!json || json.length * 2 + 64 > MAX_VALUE_BYTES) return null;
    // Parsing our bounded serialization detaches nested host objects and string slices.
    return { value: JSON.parse(json) as T, bytes: json.length * 2 + 64 };
  } catch { return null; }
}
