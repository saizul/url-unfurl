import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decodeEntities, scanHtml } from '../src/index.js';

describe('scanHtml', () => {
  it('reads meta, link and base tags with any attribute quoting', () => {
    const r = scanHtml(`<meta a="1" b='2' c=3 d e = "5"><LINK REL=icon HREF=/x.png/><base href="/b/">`);
    assert.deepEqual(r.tags, [
      { name: 'meta', attrs: { a: '1', b: '2', c: '3', d: '', e: '5' } },
      { name: 'link', attrs: { rel: 'icon', href: '/x.png/' } },
      { name: 'base', attrs: { href: '/b/' } },
    ]);
  });

  it('keeps the first value of a repeated attribute and decodes entities', () => {
    const r = scanHtml('<meta content="a &amp; b" content="second" name="x">');
    assert.deepEqual(r.tags[0]?.attrs, { content: 'a & b', name: 'x' });
  });

  it('ignores markup inside comments, scripts, styles and textareas', () => {
    const r = scanHtml(`
      <!-- <meta name="a" content="comment"> -->
      <script>var s = "<meta name='b' content='script'>"; if (a < b) {}</script>
      <style>/* <link rel=icon href=x> */</style>
      <textarea><meta name="c"></textarea>
      <meta name="real" content="yes">`);
    assert.deepEqual(r.tags, [{ name: 'meta', attrs: { name: 'real', content: 'yes' } }]);
  });

  it('closes raw text elements case-insensitively', () => {
    const r = scanHtml('<SCRIPT>x = "<meta name=a>"</ScRiPt ><meta name="b">');
    assert.deepEqual(
      r.tags.map((t) => t.attrs.name),
      ['b'],
    );
  });

  it('takes the first title outside of svg', () => {
    assert.equal(
      scanHtml('<svg><title>icon</title></svg><title>Page</title><title>Late</title>').title,
      'Page',
    );
    assert.equal(scanHtml('<title>A &amp; B</title>').title, 'A & B');
    assert.equal(scanHtml('<title>Unclosed').title, 'Unclosed');
  });

  it('collects html attributes and JSON-LD scripts', () => {
    const r = scanHtml(
      '<html lang="de" dir=ltr><script type=" Application/LD+JSON ">{"@type":"Thing"}</script><script>x</script>',
    );
    assert.deepEqual(r.htmlAttrs, { lang: 'de', dir: 'ltr' });
    assert.deepEqual(r.jsonLd, ['{"@type":"Thing"}']);
  });

  it('survives truncated and malformed input without throwing', () => {
    for (const input of [
      '',
      '<',
      '<meta',
      '<meta name="x',
      '<!--',
      '<!doctype',
      '</',
      '< meta>',
      '<1>',
      '<script>',
    ]) {
      assert.doesNotThrow(() => scanHtml(input), input);
    }
    assert.deepEqual(scanHtml('< meta name="x">').tags, []);
  });

  it('runs in linear time on adversarial input', () => {
    const big = `${'<a '.repeat(50_000)}${'<!--'.repeat(20_000)}${'<meta x="'.repeat(20_000)}`;
    const start = performance.now();
    scanHtml(big);
    assert.ok(performance.now() - start < 2000);
  });
});

describe('decodeEntities', () => {
  it('decodes named, decimal and hex references', () => {
    assert.equal(
      decodeEntities('&lt;b&gt; &quot;x&quot; &#39;y&#39; &#x1F600; &hellip;'),
      '<b> "x" \'y\' 😀 …',
    );
  });

  it('decodes legacy entities without a semicolon only', () => {
    assert.equal(decodeEntities('&copy 2026 &amp &hellip'), '© 2026 & &hellip');
  });

  it('maps C1 controls like windows-1252 and replaces invalid code points', () => {
    assert.equal(decodeEntities('&#150;&#x92;&#0;&#xD800;&#x110000;'), '–’���');
  });

  it('leaves unknown entities alone', () => {
    assert.equal(decodeEntities('&unknown; & &;'), '&unknown; & &;');
  });
});
