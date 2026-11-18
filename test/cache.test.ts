import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cacheKey, LruCache } from '../src/index.js';

describe('LruCache', () => {
  it('evicts the least recently used entry', () => {
    const c = new LruCache<number>({ max: 2 });
    c.set('a', 1).set('b', 2);
    assert.equal(c.get('a'), 1); // a is now the most recent
    c.set('c', 3);
    assert.equal(c.has('b'), false);
    assert.equal(c.get('a'), 1);
    assert.equal(c.get('c'), 3);
    assert.equal(c.size, 2);
  });

  it('expires entries after the ttl', () => {
    let now = 1000;
    const c = new LruCache<string>({ ttl: 50, now: () => now });
    c.set('k', 'v');
    now += 49;
    assert.equal(c.get('k'), 'v');
    now += 1;
    assert.equal(c.get('k'), undefined);
    assert.equal(c.size, 0);
  });

  it('overwrites, deletes and clears', () => {
    const c = new LruCache<number>({ max: 0 });
    assert.equal(c.max, 1);
    c.set('a', 1).set('a', 2);
    assert.equal(c.get('a'), 2);
    assert.equal(c.delete('a'), true);
    c.set('b', 1);
    c.clear();
    assert.equal(c.size, 0);
  });

  it('keys URLs without their fragment', () => {
    assert.equal(cacheKey('https://a.example/p?q=1#top'), 'https://a.example/p?q=1');
  });
});
