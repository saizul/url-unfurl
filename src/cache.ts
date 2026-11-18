import type { CacheLike } from './types.js';

export interface LruCacheOptions {
  /** Maximum number of entries. Default 100. */
  max?: number;
  /** Time to live in milliseconds. 0 (the default) keeps entries until they are evicted. */
  ttl?: number;
  /** Clock used for expiry. Default `Date.now`. */
  now?: () => number;
}

/** A tiny least-recently-used cache with optional expiry, built on `Map` insertion order. */
export class LruCache<V> implements CacheLike<V> {
  readonly max: number;
  readonly ttl: number;
  private readonly now: () => number;
  private readonly map = new Map<string, { value: V; expires: number }>();

  constructor(options: LruCacheOptions = {}) {
    this.max = Math.max(1, Math.floor(options.max ?? 100));
    this.ttl = Math.max(0, options.ttl ?? 0);
    this.now = options.now ?? Date.now;
  }

  get size(): number {
    return this.map.size;
  }

  get(key: string): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (entry.expires !== 0 && entry.expires <= this.now()) {
      this.map.delete(key);
      return undefined;
    }
    // Move to the most recently used position.
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  set(key: string, value: V): this {
    this.map.delete(key);
    this.map.set(key, { value, expires: this.ttl === 0 ? 0 : this.now() + this.ttl });
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value as string;
      this.map.delete(oldest);
    }
    return this;
  }

  delete(key: string): boolean {
    return this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }
}
