// Simple LRU cache with TTL support

interface CacheEntry<T> {
  value: T;
  expiry: number;
}

export class Cache<T = any> {
  private cache = new Map<string, CacheEntry<T>>();
  private maxSize: number;

  constructor(maxSize: number = 100) {
    this.maxSize = maxSize;
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    if (Date.now() > entry.expiry) {
      this.cache.delete(key);
      return undefined;
    }

    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T, ttlMs: number): void {
    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }

    this.cache.set(key, {
      value,
      expiry: Date.now() + ttlMs,
    });
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  clear(): void {
    this.cache.clear();
  }
}

// Shared cache instance
export const apiCache = new Cache(200);

// TTL constants (in milliseconds)
export const TTL = {
  GAS: 15 * 1000, // 15 seconds - gas prices change fast
  PRICE: 30 * 1000, // 30 seconds - prices
  TVL: 60 * 1000, // 1 minute - TVL data
  PROTOCOL: 5 * 60 * 1000, // 5 minutes - protocol info
  STATIC: 15 * 60 * 1000, // 15 minutes - rarely changing data
};

// Helper to wrap API calls with caching
export async function cachedFetch<T>(
  key: string,
  ttl: number,
  fetcher: () => Promise<T>,
  noCache: boolean = false
): Promise<T> {
  if (!noCache) {
    const cached = apiCache.get(key);
    if (cached) return cached as T;
  }

  const result = await fetcher();
  apiCache.set(key, result, ttl);
  return result;
}
