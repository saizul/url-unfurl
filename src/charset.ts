/** Reads the `charset` parameter of a Content-Type header. */
export function charsetFromContentType(contentType: string | null | undefined): string | undefined {
  const m = /;\s*charset\s*=\s*"?([^";\s]+)"?/i.exec(contentType ?? '');
  return m?.[1]?.toLowerCase();
}

function supported(label: string): string | undefined {
  try {
    return new TextDecoder(label).encoding;
  } catch {
    return undefined;
  }
}

/**
 * Picks the character encoding the way browsers do, simplified: a byte order
 * mark first, then the HTTP header, then a `<meta charset>` or
 * `<meta http-equiv="Content-Type">` in the first 1024 bytes, then UTF-8.
 * Unknown labels are skipped.
 */
export function detectCharset(bytes: Uint8Array, headerCharset?: string): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 'utf-8';
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
  if (headerCharset) {
    const enc = supported(headerCharset);
    if (enc) return enc;
  }
  const head = Buffer.from(bytes.subarray(0, 1024)).toString('latin1');
  const m =
    /<meta[^>]*?\bcharset\s*=\s*["']?\s*([\w.:-]+)/i.exec(head) ??
    /<meta[^>]*?content\s*=\s*["'][^"']*?charset\s*=\s*([\w.:-]+)/i.exec(head);
  if (m?.[1]) {
    const enc = supported(m[1]);
    // A meta tag can never switch to UTF-16: the bytes it was read from are ASCII-compatible.
    if (enc) return enc.startsWith('utf-16') ? 'utf-8' : enc;
  }
  return 'utf-8';
}

/** Decodes bytes with the given encoding, replacing invalid sequences. */
export function decode(bytes: Uint8Array, encoding: string): string {
  return new TextDecoder(encoding, { fatal: false, ignoreBOM: false }).decode(bytes);
}
