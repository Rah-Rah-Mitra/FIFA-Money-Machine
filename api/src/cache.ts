// ponytail: in-memory Map + TTL. Keys are bounded by #videos (~64), so no eviction.
// Ceiling: swap for lru-cache or Redis if the keyspace or process count grows.
type Entry = { value: unknown; expires: number };
const store = new Map<string, Entry>();

export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as T;
  const value = await fn();
  store.set(key, { value, expires: Date.now() + ttlMs });
  return value;
}

export function clearCache(): void {
  store.clear();
}
