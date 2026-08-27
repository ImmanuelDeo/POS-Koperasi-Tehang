/**
 * Bounded In-Memory LRU Cache for POS & Catalog Projections
 * Prevents memory leaks and maintains ultra-fast (< 1ms) lookups for scanned items.
 */

export class LruCache<K, V> {
  private capacity: number;
  private cache = new Map<K, { value: V; expiresAt: number }>();
  private defaultTtlMs: number;

  constructor(capacity = 150, defaultTtlMs = 60000) {
    this.capacity = capacity;
    this.defaultTtlMs = defaultTtlMs;
  }

  get(key: K): V | undefined {
    const item = this.cache.get(key);
    if (!item) return undefined;

    if (Date.now() > item.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }

    // Refresh LRU order (delete and re-insert)
    this.cache.delete(key);
    this.cache.set(key, item);
    return item.value;
  }

  set(key: K, value: V, ttlMs?: number): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.capacity) {
      // Remove oldest (first) item
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, {
      value,
      expiresAt: Date.now() + (ttlMs || this.defaultTtlMs),
    });
  }

  has(key: K): boolean {
    return this.get(key) !== undefined;
  }

  delete(key: K): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }
}

// Global bounded in-memory cache instance for products
export const productCache = new LruCache<string, any>(150, 120000); // 150 items, 2 mins TTL
