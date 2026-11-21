/**
 * Worker constructors. The `new URL(…, import.meta.url)` form must stay literal so
 * Vite bundles each worker and keeps its URL relative to the deployed page.
 */
import type { WorkerLike } from './rpc';

export const createSeatWorker = (): WorkerLike =>
  new Worker(new URL('./seat.worker.ts', import.meta.url), { type: 'module', name: 'arena-seat' });

export const createLoaderWorker = (): WorkerLike =>
  new Worker(new URL('./loader.worker.ts', import.meta.url), { type: 'module', name: 'arena-loader' });

export const createRefereeWorker = (): WorkerLike =>
  new Worker(new URL('./referee.worker.ts', import.meta.url), { type: 'module', name: 'arena-referee' });
