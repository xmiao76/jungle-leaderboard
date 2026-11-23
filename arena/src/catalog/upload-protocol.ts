/**
 * The wire format of `POST /api/catalog`, shared by the Upload page and the server
 * (server/catalog-upload.ts): the raw `application/wasm` body plus these headers.
 */
export const UPLOAD_HEADERS = {
  sha256: 'X-Entrant-Sha256',
  report: 'X-Entrant-Report',
  turnstileToken: 'X-Turnstile-Token',
} as const;

/** base64url (no padding) of the UTF-8 JSON, as the X-Entrant-Report header carries it. */
export function encodeReportHeader(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
