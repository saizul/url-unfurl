import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseHtml, summarizeJsonLd } from '../src/index.js';
import { fixture } from './helpers.js';

describe('parseHtml: article page', () => {
  const r = parseHtml(fixture('article.html'), 'https://news.example.com/news/2026/rocket-launch?ref=home');

  it('prefers Open Graph over Twitter, JSON-LD and <title>', () => {
    assert.equal(r.title, 'Rocket launch & landing — a first');
    assert.equal(r.description, 'The booster landed on its second try.');
    assert.equal(r.siteName, 'Example News');
    assert.equal(r.type, 'article');
  });

  it('resolves the canonical URL and keeps the page URL', () => {
    assert.equal(r.url, 'https://news.example.com/news/2026/rocket-launch?ref=home');
    assert.equal(r.canonical, 'https://news.example.com/news/2026/rocket-launch');
  });

  it('groups structured og:image properties and prefers secure_url', () => {
    assert.deepEqual(r.images, [
      { url: 'https://secure.example.com/rocket.jpg', width: 1200, height: 630, alt: 'A rocket on the pad' },
      { url: 'https://news.example.com/images/second.png', type: 'image/png' },
    ]);
    assert.deepEqual(r.openGraph.image, ['https://cdn.example.com/rocket.jpg', '/images/second.png']);
  });

  it('reads Twitter card tags without the prefix', () => {
    assert.equal(r.twitter.card, 'summary_large_image');
    assert.equal(r.twitter.site, '@examplenews');
    assert.equal(r.twitter.creator, '@ada');
  });

  it('picks the best icon and lists the rest, best first', () => {
    assert.equal(r.favicon, 'https://news.example.com/favicon.svg');
    assert.deepEqual(
      r.icons.map((i) => [i.rel, i.url.replace('https://news.example.com', ''), i.size]),
      [
        ['icon', '/favicon.svg', 1024],
        ['apple-touch-icon', '/apple-touch-icon.png', 180],
        ['icon', '/favicon-32.png', 32],
      ],
    );
  });

  it('reads language, theme color, author, dates, keywords, feeds and the manifest', () => {
    assert.equal(r.lang, 'en-GB');
    assert.equal(r.themeColor, '#fafafa');
    assert.equal(r.author, 'Ada Example');
    assert.equal(r.publishedTime, '2026-11-01T08:00:00Z');
    assert.equal(r.modifiedTime, '2026-11-02T09:30:00Z');
    assert.deepEqual(r.keywords, ['space', 'rockets', 'launch']);
    assert.deepEqual(r.feeds, [
      { url: 'https://news.example.com/feed.xml', type: 'application/rss+xml', title: 'Example News RSS' },
    ]);
    assert.equal(r.manifest, 'https://news.example.com/site.webmanifest');
  });

  it('summarizes JSON-LD with @graph and resolves @id references', () => {
    assert.deepEqual(r.jsonLd, {
      types: ['WebSite', 'Organization', 'Person', 'NewsArticle', 'Article'],
      authors: ['Ada Example', 'Grace Example'],
      type: 'NewsArticle',
      headline: 'JSON-LD headline',
      datePublished: '2026-11-01T08:00:00Z',
      dateModified: '2026-11-02T09:30:00Z',
      image: 'https://cdn.example.com/rocket-ld.jpg',
      publisher: 'Example News Ltd',
    });
  });

  it('has no oEmbed and no response info offline', () => {
    assert.equal(r.oEmbed, undefined);
    assert.equal(r.response, undefined);
  });
});

describe('parseHtml: video page', () => {
  const r = parseHtml(fixture('video.html'), 'https://videosite.example/watch?v=abc123');

  it('discovers oEmbed JSON and XML endpoints', () => {
    assert.deepEqual(r.oEmbed, {
      json: 'https://videosite.example/oembed?url=https%3A%2F%2Fvideosite.example%2Fwatch%3Fv%3Dabc123&format=json',
      title: 'A video',
      xml: 'https://videosite.example/oembed?url=https%3A%2F%2Fvideosite.example%2Fwatch%3Fv%3Dabc123&format=xml',
    });
  });

  it('reads og:video and the player card', () => {
    assert.deepEqual(r.videos, [
      { url: 'https://videosite.example/embed/abc123', type: 'text/html', width: 1280, height: 720 },
    ]);
    assert.equal(r.twitter.player, 'https://videosite.example/embed/abc123');
    assert.equal(r.twitter['player:width'], '1280');
    assert.equal(r.type, 'video.other');
  });

  it('uses JSON-LD for author and date when meta tags are missing', () => {
    assert.equal(r.author, 'Channel Name');
    assert.equal(r.publishedTime, '2026-10-30');
    assert.equal(r.jsonLd?.type, 'VideoObject');
    assert.equal(r.jsonLd?.image, 'https://img.videosite.example/vi/abc123/hq.jpg');
  });

  it('ranks a sized PNG above a .ico', () => {
    assert.equal(r.favicon, 'https://www.videosite.example/img/favicon_144x144.png');
    assert.equal(r.icons[1]?.rel, 'shortcut icon');
    assert.equal(r.themeColor, 'rgba(255, 255, 255, 0.98)');
  });
});

describe('parseHtml: minimal and old-style markup', () => {
  const r = parseHtml(fixture('minimal.html'), 'https://www.example.org/page');

  it('falls back to <title> and meta description, decoding entities and collapsing spaces', () => {
    assert.equal(r.title, 'Bonjour le monde été — \u{1F600} © 2026');
    assert.equal(r.description, 'Une page "simple"');
    assert.equal(r.lang, 'fr');
  });

  it('resolves relative URLs against <base href>', () => {
    assert.equal(r.favicon, 'https://cdn.example.org/assets/favicon.ico');
    assert.deepEqual(r.images, [{ url: 'https://cdn.example.org/assets/card.png', alt: 'Une carte' }]);
  });

  it('drops javascript: URLs', () => {
    assert.ok(r.icons.every((i) => i.url.startsWith('https://')));
    assert.equal(r.icons.length, 1);
  });

  it('falls back to /favicon.ico when the page declares no icon', () => {
    const p = parseHtml('<title>x</title>', 'https://a.example/deep/path?q=1');
    assert.equal(p.favicon, 'https://a.example/favicon.ico');
    assert.deepEqual(p.icons, []);
    assert.deepEqual(p.images, []);
    assert.deepEqual(p.keywords, []);
  });
});

describe('parseHtml: tricky markup', () => {
  const r = parseHtml(fixture('tricky.html'), 'https://site.example/dir/page');

  it('ignores comments, CSS and textarea content', () => {
    assert.equal(r.title, 'First wins');
    assert.equal(r.canonical, undefined);
  });

  it('keeps the first of repeated meta tags but records every og value', () => {
    assert.equal(r.description, 'Reversed attributes');
    assert.deepEqual(r.openGraph.title, ['First wins', 'Second']);
  });

  it('drops data: images, resolves protocol-relative URLs and removes duplicates', () => {
    assert.deepEqual(r.images, [{ url: 'https://protocol-relative.example/i.png' }]);
    assert.deepEqual(r.audio, [{ url: 'https://site.example/a.mp3' }]);
  });

  it('reads Content-Language when <html lang> is missing', () => {
    assert.equal(r.lang, 'de-AT');
    assert.equal(r.themeColor, '#abcdef');
  });

  it('skips invalid JSON-LD and unwraps commented JSON-LD', () => {
    assert.equal(r.jsonLd?.type, 'Recipe');
    assert.deepEqual(r.jsonLd?.authors, ['Chef']);
  });

  it('throws on an invalid base URL', () => {
    assert.throws(() => parseHtml('', 'not a url'), TypeError);
  });
});

describe('summarizeJsonLd', () => {
  it('returns undefined when nothing parses', () => {
    assert.equal(summarizeJsonLd([]), undefined);
    assert.equal(summarizeJsonLd(['nope', '{"no":"type"}']), undefined);
  });

  it('prefers specific types over WebPage and site furniture', () => {
    const s = summarizeJsonLd([
      JSON.stringify([
        { '@type': 'WebPage', name: 'Page' },
        { '@type': 'BreadcrumbList' },
        {
          '@type': 'Product',
          name: 'Widget',
          image: { '@type': 'ImageObject', url: 'https://x.example/w.png' },
        },
      ]),
    ]);
    assert.equal(s?.type, 'Product');
    assert.equal(s?.headline, 'Widget');
    assert.equal(s?.image, 'https://x.example/w.png');
  });

  it('falls back to WebPage, strips schema.org prefixes and handles string authors', () => {
    const s = summarizeJsonLd(['{"@type":"http://schema.org/WebPage","name":"Home","author":"Someone"}']);
    assert.equal(s?.type, 'WebPage');
    assert.deepEqual(s?.authors, ['Someone']);
  });
});
