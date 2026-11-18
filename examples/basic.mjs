// Runs offline against the local build: npm run build && node examples/basic.mjs
import { isPrivateAddress, LruCache, parseHtml } from '../dist/esm/index.js';

const html = `<!doctype html>
<html lang="en">
<head>
  <title>Fallback title</title>
  <meta property="og:title" content="Hello &amp; welcome">
  <meta property="og:description" content="An example page.">
  <meta property="og:image" content="/cover.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="theme-color" content="#0f172a">
  <link rel="icon" href="/icon.svg" type="image/svg+xml">
  <link rel="alternate" type="application/json+oembed" href="/oembed?url=%2Fpost">
  <script type="application/ld+json">{"@type":"BlogPosting","author":{"@type":"Person","name":"Sam"},"datePublished":"2026-11-18"}</script>
</head>
<body></body>
</html>`;

const preview = parseHtml(html, 'https://blog.example.com/post');
console.log({
  title: preview.title,
  description: preview.description,
  image: preview.images[0],
  favicon: preview.favicon,
  themeColor: preview.themeColor,
  author: preview.author,
  oEmbed: preview.oEmbed?.json,
});

const cache = new LruCache({ max: 2, ttl: 60_000 });
cache.set('a', 1).set('b', 2).set('c', 3);
console.log('cache keeps the two most recent:', cache.has('a'), cache.has('c'));

console.log('169.254.169.254 private?', isPrivateAddress('169.254.169.254'));
console.log('::ffff:127.0.0.1 private?', isPrivateAddress('::ffff:127.0.0.1'));
