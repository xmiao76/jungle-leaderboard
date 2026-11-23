/**
 * Publish one program that passed the upload round: `POST /api/catalog` (server/catalog-upload.ts).
 * The server re-checks what it can without running the program and answers 201 (published),
 * 200 (these exact bytes were already published) or a 4xx/5xx with its reasons.
 */
import type { Metadata } from '../referee/types';
import { encodeReportHeader, UPLOAD_HEADERS } from './upload-protocol';

export type PublishOutcome = { readonly ok: true; readonly existing: boolean } | { readonly ok: false; readonly reasons: readonly string[] };

export interface PublishInput {
  readonly bytes: Uint8Array;
  readonly sha256: string;
  readonly metadata: Metadata;
  /** The upload round's report, stored with the entry for display. */
  readonly report: unknown;
  readonly turnstileToken: string;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

async function refusalReasons(response: Response): Promise<string[]> {
  const body = (await response.json().catch(() => null)) as { reasons?: unknown } | null;
  const reasons = Array.isArray(body?.reasons) ? body.reasons.filter((r): r is string => typeof r === 'string') : [];
  return reasons.length > 0 ? reasons : [`The Arena refused the upload (HTTP ${response.status}).`];
}

export async function publishEntrant(input: PublishInput, endpoint: URL, fetcher: typeof fetch = fetch): Promise<PublishOutcome> {
  let response: Response;
  try {
    response = await fetcher(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/wasm',
        [UPLOAD_HEADERS.sha256]: input.sha256,
        [UPLOAD_HEADERS.report]: encodeReportHeader({ metadata: input.metadata, report: input.report }),
        [UPLOAD_HEADERS.turnstileToken]: input.turnstileToken,
      },
      body: input.bytes as BodyInit,
    });
  } catch (err) {
    return { ok: false, reasons: [`The Arena could not be reached: ${message(err)}`] };
  }
  if (response.status === 201 || response.status === 200) return { ok: true, existing: response.status === 200 };
  return { ok: false, reasons: await refusalReasons(response) };
}
