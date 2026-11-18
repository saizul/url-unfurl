# Security policy

## Supported versions

Only the latest release receives fixes.

## Reporting a vulnerability

Please do **not** open a public issue for security problems. Use GitHub's
private vulnerability reporting ("Report a vulnerability" under the
repository's **Security** tab). You will get an answer within a week.

## Scope

url-unfurl fetches URLs that usually come from untrusted users, so the
following are treated as vulnerabilities:

- **SSRF bypasses.** Any URL that makes `unfurl()` (with default options)
  connect to a private, loopback, link-local, unique-local, CGNAT, multicast
  or reserved address, whether through an IP notation, an IPv6 form that
  embeds an IPv4 address, a hostname, a redirect, or the oEmbed request.
- **Limit bypasses.** Responses that make `unfurl()` read much more than
  `maxBytes`, run much longer than `timeout`, or follow more than
  `maxRedirects` redirects.
- **Parser complexity.** HTML input that makes `parseHtml()` or `scanHtml()`
  take far more than linear time or memory, or throw.
- **Unsafe URLs in the output.** Any URL field in the result that is not
  `http:` or `https:`.

## Known limitations (not vulnerabilities)

- **DNS rebinding.** The guard resolves the hostname and `fetch` resolves it
  again to connect. A domain whose DNS answers change between the two
  lookups can reach an internal address. Run unfurling in a network that
  cannot reach internal services, or pass a `fetch` that goes through an
  egress proxy. A pinned-connection fetch is on the roadmap; reports with a
  practical fix are very welcome.
- **Output is untrusted text.** Titles, descriptions and `oEmbed.data.html`
  come from third-party pages. Escaping them when rendering, and sandboxing
  embed HTML, is the caller's job.
- Options that turn checks off (`allowPrivateNetworks`, `allowAddress`, a
  custom `lookup` or `fetch`) are the caller's responsibility.
