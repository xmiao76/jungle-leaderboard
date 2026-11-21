/// <reference lib="webworker" />
/**
 * Dedicated loader worker: everything between "bytes selected" and "ready to
 * instantiate" runs here, off the UI thread, before any guest code executes.
 */
import { $init as bindgenReady, generate } from '@bytecodealliance/jco-transpile/component';
import { print } from '@bytecodealliance/jco-transpile/wasm-tools';
import { contractIssues } from '../loader/contract';
import { packTranspiled, TRANSPILE_NAME } from '../loader/guest';
import { sha256Hex } from '../loader/hash';
import { MAX_UPLOAD_BYTES } from '../loader/limits';
import { extractContract } from '../loader/signature';
import { isComponentBinary, isCoreModuleBinary, stripCoreModules } from '../loader/strip';
import type { LoaderReply, LoaderStage, ValidateRequest } from '../protocol/messages';

declare const self: DedicatedWorkerGlobalScope;

function post(message: LoaderReply): void {
  // Several module views may share one buffer; a transfer list must not repeat it.
  const buffers = message.type === 'VALIDATED' && message.artifact
    ? new Set(Object.values(message.artifact.modules).map((m) => m.buffer as ArrayBuffer))
    : new Set<ArrayBuffer>();
  self.postMessage(message, [...buffers]);
}

function errorText(err: unknown): string {
  const payload = (err as { payload?: unknown } | null)?.payload;
  if (typeof payload === 'string') return payload;
  return err instanceof Error ? err.message : String(err);
}

async function validate(msg: ValidateRequest): Promise<void> {
  const { requestId } = msg;
  const bytes = new Uint8Array(msg.bytes);
  let sha256: string | null = null;
  const reject = (stage: LoaderStage, reasons: string[]) => post({ type: 'REJECTED', requestId, stage, sha256, reasons });
  const progress = (stage: LoaderStage) => post({ type: 'PROGRESS', requestId, stage });

  progress('size');
  if (bytes.length === 0) return reject('size', ['The file is empty.']);
  if (bytes.length > MAX_UPLOAD_BYTES) {
    return reject('size', [`The file is ${(bytes.length / 1048576).toFixed(1)} MiB; the limit is ${MAX_UPLOAD_BYTES / 1048576} MiB.`]);
  }

  progress('header');
  if (isCoreModuleBinary(bytes)) {
    return reject('header', [
      'This is a core WebAssembly module, not a Component Model component. ' +
        'Wrap it with `wasm-tools component new` (or your toolchain’s component build) against wit/jungle.wit.',
    ]);
  }
  if (!isComponentBinary(bytes)) return reject('header', ['This file is not a WebAssembly component (bad magic or layer header).']);

  progress('hash');
  sha256 = await sha256Hex(bytes);

  progress('contract');
  try {
    const issues = contractIssues(extractContract(await print(stripCoreModules(bytes))));
    if (issues.length > 0) return reject('contract', issues);
  } catch (err) {
    return reject('contract', [`The component could not be parsed: ${errorText(err)}`]);
  }

  if (msg.skipTranspile) {
    post({ type: 'VALIDATED', requestId, sha256, size: bytes.length, artifact: null });
    return;
  }
  progress('transpile');
  try {
    await bindgenReady;
    const out = generate(bytes, {
      name: TRANSPILE_NAME,
      instantiation: { tag: 'async' },
      noTypescript: true,
      noNodejsCompat: true,
    });
    post({ type: 'VALIDATED', requestId, sha256, size: bytes.length, artifact: packTranspiled(out.files) });
  } catch (err) {
    reject('transpile', [`jco could not transpile this component: ${errorText(err)}`]);
  }
}

self.onmessage = (event: MessageEvent<ValidateRequest>) => {
  validate(event.data).catch((err: unknown) => {
    // Never leave the host waiting for its deadline (e.g. crypto.subtle on an insecure origin).
    post({ type: 'REJECTED', requestId: event.data.requestId, stage: 'hash', sha256: null, reasons: [`The loader failed: ${errorText(err)}`] });
  });
};
