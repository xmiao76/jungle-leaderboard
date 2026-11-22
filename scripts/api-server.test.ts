import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { assertPortFree, isArenaCatalog, portFrom } from './api-server';

let other: Server | null = null;
afterEach(async () => {
  await new Promise((r) => (other ? other.close(r) : r(undefined)));
  other = null;
});

/** Another program on a port, like a second project's dev server. */
async function occupy(): Promise<number> {
  other = createServer((_req, res) => res.writeHead(404, { 'content-type': 'text/plain' }).end('not here'));
  await new Promise<void>((r) => other!.listen(0, '127.0.0.1', r));
  return (other.address() as { port: number }).port;
}

describe('assertPortFree', () => {
  it('fails at once, naming the port and how to pick another, when another program holds it', async () => {
    const port = await occupy();
    await expect(assertPortFree(port)).rejects.toThrow(new RegExp(`port ${port} is already in use.*--port`));
  });

  it('passes for a free port', async () => {
    const port = await occupy();
    await new Promise((r) => other!.close(r));
    other = null;
    await expect(assertPortFree(port)).resolves.toBeUndefined();
  });
});

describe('isArenaCatalog', () => {
  it('accepts only a successful answer in the catalog format', () => {
    expect(isArenaCatalog(200, { format: 'jungle-arena-catalog', version: 1, entries: [] })).toBe(true);
    expect(isArenaCatalog(404, { format: 'jungle-arena-catalog' })).toBe(false);
    expect(isArenaCatalog(200, '<!doctype html>')).toBe(false);
    expect(isArenaCatalog(200, null)).toBe(false);
  });
});

describe('portFrom', () => {
  it('lets a later --port override the default, then ARENA_API_PORT, then 8788', () => {
    expect(portFrom(['--port', '8788', '--port', '8790'], {})).toBe(8790);
    expect(portFrom([], { ARENA_API_PORT: '8791' })).toBe(8791);
    expect(portFrom([], {})).toBe(8788);
  });

  it('rejects a port that is not a number in range', () => {
    expect(() => portFrom(['--port', 'abc'], {})).toThrow(/port/);
    expect(() => portFrom(['--port', '70000'], {})).toThrow(/port/);
  });
});
