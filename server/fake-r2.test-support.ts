/**
 * An in-memory R2 bucket for upload tests.
 *
 * The read-path tests use real local R2 (local-env.test-support.ts), but an upload streams
 * its body, and workerd's R2 put only accepts a known-length stream ("request/response body
 * or readable half of FixedLengthStream"). Under Vitest the handler runs in Node, where
 * neither exists, so a streamed put can never reach real R2 through getPlatformProxy
 * (verified 2026-11-22). This fake keeps the one behaviour the handler relies on from R2:
 * a put with a sha256 option rejects bytes that do not match and stores nothing.
 * The real R2 path is covered over HTTP (wrangler pages dev) instead.
 */
import { createHash } from 'node:crypto';

interface StoredObject {
  readonly bytes: Uint8Array;
  readonly httpMetadata?: { readonly contentType?: string };
}

async function readAll(value: unknown): Promise<Uint8Array> {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (value instanceof ReadableStream) {
    const chunks: Uint8Array[] = [];
    let total = 0;
    for await (const chunk of value as ReadableStream<Uint8Array>) {
      chunks.push(chunk);
      total += chunk.length;
    }
    const out = new Uint8Array(total);
    let at = 0;
    for (const chunk of chunks) {
      out.set(chunk, at);
      at += chunk.length;
    }
    return out;
  }
  throw new Error('FakeR2Bucket.put: unsupported value');
}

export class FakeR2Bucket {
  readonly objects = new Map<string, StoredObject>();

  async put(key: string, value: unknown, options?: { sha256?: string; httpMetadata?: { contentType?: string } }) {
    const bytes = await readAll(value);
    if (options?.sha256 !== undefined) {
      const actual = createHash('sha256').update(bytes).digest('hex');
      if (actual !== options.sha256) {
        // Wording mirrors workerd's rejection, which the handler maps to a client error.
        throw new Error('R2 PUT failed: (10037) The SHA-256 checksum you provided does not match the checksum of the received data.');
      }
    }
    this.objects.set(key, { bytes, httpMetadata: options?.httpMetadata });
    return { key, size: bytes.length, httpEtag: `"fake-${key}"` };
  }

  async get(key: string) {
    const stored = this.objects.get(key);
    if (!stored) return null;
    const { bytes } = stored;
    return {
      key,
      size: bytes.length,
      httpEtag: `"fake-${key}"`,
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      }),
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    };
  }

  async delete(keys: string | string[]): Promise<void> {
    for (const key of Array.isArray(keys) ? keys : [keys]) this.objects.delete(key);
  }

  async list() {
    return { objects: [...this.objects.keys()].map((key) => ({ key })) };
  }

  asBucket(): R2Bucket {
    return this as unknown as R2Bucket;
  }
}
