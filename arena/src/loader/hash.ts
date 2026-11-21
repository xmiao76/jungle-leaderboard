/** SHA-256 of raw bytes as lowercase hex, via Web Crypto (browsers, workers, Node). */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function shortHash(sha256: string): string {
  return sha256.slice(0, 12);
}
