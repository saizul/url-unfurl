/** Machine-readable reasons an unfurl can fail. */
export type UnfurlErrorCode =
  | 'INVALID_URL'
  | 'BLOCKED_URL'
  | 'DNS_ERROR'
  | 'TIMEOUT'
  | 'ABORTED'
  | 'TOO_MANY_REDIRECTS'
  | 'HTTP_ERROR'
  | 'UNSUPPORTED_CONTENT_TYPE'
  | 'FETCH_FAILED';

/** The only error type `unfurl()` rejects with. */
export class UnfurlError extends Error {
  override readonly name = 'UnfurlError';
  readonly code: UnfurlErrorCode;
  /** The URL that was being fetched when the error happened. */
  readonly url: string | undefined;
  /** The HTTP status, for `HTTP_ERROR`. */
  readonly status: number | undefined;

  constructor(
    code: UnfurlErrorCode,
    message: string,
    details: { url?: string; status?: number; cause?: unknown } = {},
  ) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.code = code;
    this.url = details.url;
    this.status = details.status;
  }
}
