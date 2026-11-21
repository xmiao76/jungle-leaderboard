/// <reference lib="webworker" />
/**
 * The trusted referee, isolated from both entrants. It owns the official snapshot:
 * the board, legal-move list, captures, history, quiet counter and adjudication.
 */
import { applyMove, forfeit, initialSnapshot, legalMoves } from '../referee';
import type { Snapshot } from '../referee/types';
import type { RefereeReply, RefereeRequest } from '../protocol/messages';

declare const self: DedicatedWorkerGlobalScope;

let official: Snapshot | null = null;

function reply(message: RefereeReply): void {
  self.postMessage(message);
}

function handle(msg: RefereeRequest): void {
  const { requestId } = msg;
  try {
    if (msg.type === 'NEW_GAME') {
      official = initialSnapshot(msg.firstSide);
    } else {
      if (!official) throw new Error('No game in progress');
      if (msg.rev !== official.rev) throw new Error(`Stale request for rev ${msg.rev}; official rev is ${official.rev}`);
      official = msg.type === 'COMMIT' ? applyMove(official, msg.move) : forfeit(official, msg.loser, msg.reason);
    }
    reply({ type: 'STATE', requestId, snapshot: official, legal: legalMoves(official) });
  } catch (err) {
    reply({ type: 'REFUSED', requestId, message: err instanceof Error ? err.message : String(err) });
  }
}

self.onmessage = (event: MessageEvent<RefereeRequest>) => handle(event.data);
