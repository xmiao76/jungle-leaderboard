/**
 * Node-only host helpers, used by unit tests and the maintainer catalog command.
 * The browser path does the same steps in loader/seat workers (see src/workers/).
 */
import { readFileSync } from 'node:fs';
import { transpileBytes } from '@bytecodealliance/jco-transpile';
import { print } from '@bytecodealliance/jco-transpile/wasm-tools';
import { contractIssues } from './contract';
import { instantiateGuest, packTranspiled, TRANSPILE_NAME, type GuestGame, type TranspiledEntrant } from './guest';
import { extractContract } from './signature';
import { stripCoreModules } from './strip';

export async function transpileInNode(bytes: Uint8Array): Promise<TranspiledEntrant> {
  const result = await transpileBytes(bytes, {
    name: TRANSPILE_NAME,
    instantiation: 'async',
    emitTypescriptDeclarations: false,
    nodejsCompat: false,
    wasiShim: false,
  });
  return packTranspiled(Object.entries(result.files) as [string, Uint8Array][]);
}

export function importViaDataUrl(js: string) {
  return import(/* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
}

export async function instantiateInNode(bytes: Uint8Array): Promise<GuestGame> {
  return instantiateGuest(await transpileInNode(bytes), importViaDataUrl);
}

export async function contractIssuesInNode(bytes: Uint8Array): Promise<string[]> {
  return contractIssues(extractContract(await print(stripCoreModules(bytes))));
}

export function readBinary(url: URL | string): Uint8Array {
  return new Uint8Array(readFileSync(url));
}
