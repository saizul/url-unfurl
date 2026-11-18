// The package also works with require(). Run after `npm run build`:
//   node examples/commonjs.cjs
const { parseHtml, isPrivateAddress } = require('../dist/cjs/index.js');

const r = parseHtml(
  '<title>From CommonJS</title><link rel="apple-touch-icon" href="/t.png">',
  'https://example.com/',
);
console.log(r.title, r.favicon);
console.log(isPrivateAddress('10.0.0.1'), isPrivateAddress('1.1.1.1'));
