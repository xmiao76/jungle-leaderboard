/**
 * "On this device" persistence: imported binaries by content hash, transpiled outputs
 * by hash + loader version, and replays. Falls back to memory (and says so) when
 * IndexedDB is unavailable — private windows, blocked site data, or quota errors.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { TranspiledEntrant } from '../loader/guest';
import type { Metadata } from '../referee/types';
import type { ReplayV1 } from '../replay/schema';

export interface StoredPackage {
  readonly sha256: string;
  readonly size: number;
  readonly fileName: string;
  readonly metadata: Metadata;
  readonly importedAt: string;
  readonly bytes: Uint8Array;
}

export interface StoredTranspile extends TranspiledEntrant {
  readonly key: string;
  readonly sha256: string;
  readonly loaderVersion: string;
}

interface ArenaSchema extends DBSchema {
  packages: { key: string; value: StoredPackage };
  transpiled: { key: string; value: StoredTranspile };
  replays: { key: string; value: ReplayV1; indexes: { createdAt: string } };
}

export interface ArenaStore {
  /** False when storage is unavailable and everything lives only in this tab. */
  readonly persistent: boolean;
  /** Why storage is unavailable, for the notice shown to the visitor. */
  readonly unavailableReason: string | null;
  listPackages(): Promise<StoredPackage[]>;
  getPackage(sha256: string): Promise<StoredPackage | null>;
  putPackage(pkg: StoredPackage): Promise<void>;
  deletePackage(sha256: string): Promise<void>;
  getTranspiled(sha256: string, loaderVersion: string): Promise<StoredTranspile | null>;
  putTranspiled(sha256: string, loaderVersion: string, artifact: TranspiledEntrant): Promise<void>;
  listReplays(): Promise<ReplayV1[]>;
  getReplay(id: string): Promise<ReplayV1 | null>;
  putReplay(replay: ReplayV1): Promise<void>;
  deleteReplay(id: string): Promise<void>;
}

const DB_NAME = 'jungle-arena';
const DB_VERSION = 1;
const OPEN_TIMEOUT_MS = 5_000;

export const transpileKey = (sha256: string, loaderVersion: string) => `${sha256}|${loaderVersion}`;

class IndexedStore implements ArenaStore {
  readonly persistent = true;
  readonly unavailableReason = null;

  constructor(private readonly db: IDBPDatabase<ArenaSchema>) {}

  async listPackages() {
    return this.db.getAll('packages');
  }
  async getPackage(sha256: string) {
    return (await this.db.get('packages', sha256)) ?? null;
  }
  async putPackage(pkg: StoredPackage) {
    await this.db.put('packages', pkg);
  }
  async deletePackage(sha256: string) {
    const tx = this.db.transaction(['packages', 'transpiled'], 'readwrite');
    await tx.objectStore('packages').delete(sha256);
    for (const key of await tx.objectStore('transpiled').getAllKeys()) {
      if (key.startsWith(`${sha256}|`)) await tx.objectStore('transpiled').delete(key);
    }
    await tx.done;
  }
  async getTranspiled(sha256: string, loaderVersion: string) {
    return (await this.db.get('transpiled', transpileKey(sha256, loaderVersion))) ?? null;
  }
  async putTranspiled(sha256: string, loaderVersion: string, artifact: TranspiledEntrant) {
    await this.db.put('transpiled', { ...artifact, key: transpileKey(sha256, loaderVersion), sha256, loaderVersion });
  }
  async listReplays() {
    return (await this.db.getAllFromIndex('replays', 'createdAt')).reverse();
  }
  async getReplay(id: string) {
    return (await this.db.get('replays', id)) ?? null;
  }
  async putReplay(replay: ReplayV1) {
    await this.db.put('replays', replay);
  }
  async deleteReplay(id: string) {
    await this.db.delete('replays', id);
  }
}

export class MemoryStore implements ArenaStore {
  readonly persistent = false;
  private packages = new Map<string, StoredPackage>();
  private transpiled = new Map<string, StoredTranspile>();
  private replays = new Map<string, ReplayV1>();

  constructor(readonly unavailableReason: string | null = null) {}

  async listPackages() {
    return [...this.packages.values()];
  }
  async getPackage(sha256: string) {
    return this.packages.get(sha256) ?? null;
  }
  async putPackage(pkg: StoredPackage) {
    this.packages.set(pkg.sha256, pkg);
  }
  async deletePackage(sha256: string) {
    this.packages.delete(sha256);
    for (const key of this.transpiled.keys()) if (key.startsWith(`${sha256}|`)) this.transpiled.delete(key);
  }
  async getTranspiled(sha256: string, loaderVersion: string) {
    return this.transpiled.get(transpileKey(sha256, loaderVersion)) ?? null;
  }
  async putTranspiled(sha256: string, loaderVersion: string, artifact: TranspiledEntrant) {
    const key = transpileKey(sha256, loaderVersion);
    this.transpiled.set(key, { ...artifact, key, sha256, loaderVersion });
  }
  async listReplays() {
    return [...this.replays.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async getReplay(id: string) {
    return this.replays.get(id) ?? null;
  }
  async putReplay(replay: ReplayV1) {
    this.replays.set(replay.id, replay);
  }
  async deleteReplay(id: string) {
    this.replays.delete(id);
  }
}

export async function openArenaStore(factory: IDBFactory | null = globalThis.indexedDB ?? null): Promise<ArenaStore> {
  if (!factory) return new MemoryStore('This browser does not provide IndexedDB.');
  try {
    const opening = openDB<ArenaSchema>(DB_NAME, DB_VERSION, {
      upgrade(database) {
        database.createObjectStore('packages', { keyPath: 'sha256' });
        database.createObjectStore('transpiled', { keyPath: 'key' });
        database.createObjectStore('replays', { keyPath: 'id' }).createIndex('createdAt', 'createdAt');
      },
    });
    // An open blocked by another tab never settles on its own; do not let it hang the Arena.
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('opening the database timed out')), OPEN_TIMEOUT_MS));
    return new IndexedStore(await Promise.race([opening, timeout]));
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return new MemoryStore(`Local storage is unavailable (${detail}). Imports and replays last only until this tab closes; download replays to keep them.`);
  }
}

/** Wrap a store so a failing write degrades to memory instead of stopping a match. */
export class ResilientStore implements ArenaStore {
  private fallback: MemoryStore | null = null;
  private reason: string | null;

  constructor(private readonly primary: ArenaStore) {
    this.reason = primary.unavailableReason;
  }

  get persistent(): boolean {
    return this.primary.persistent && this.fallback === null;
  }
  get unavailableReason(): string | null {
    return this.reason;
  }

  private async guard<T>(op: (store: ArenaStore) => Promise<T>): Promise<T> {
    if (this.fallback) return op(this.fallback);
    try {
      return await op(this.primary);
    } catch (err) {
      this.fallback = new MemoryStore();
      this.reason = `Saving to this device failed (${err instanceof Error ? err.message : String(err)}). New data is kept in memory only.`;
      return op(this.fallback);
    }
  }

  listPackages = () => this.guard((s) => s.listPackages());
  getPackage = (sha: string) => this.guard((s) => s.getPackage(sha));
  putPackage = (pkg: StoredPackage) => this.guard((s) => s.putPackage(pkg));
  deletePackage = (sha: string) => this.guard((s) => s.deletePackage(sha));
  getTranspiled = (sha: string, v: string) => this.guard((s) => s.getTranspiled(sha, v));
  putTranspiled = (sha: string, v: string, a: TranspiledEntrant) => this.guard((s) => s.putTranspiled(sha, v, a));
  listReplays = () => this.guard((s) => s.listReplays());
  getReplay = (id: string) => this.guard((s) => s.getReplay(id));
  putReplay = (r: ReplayV1) => this.guard((s) => s.putReplay(r));
  deleteReplay = (id: string) => this.guard((s) => s.deleteReplay(id));
}
