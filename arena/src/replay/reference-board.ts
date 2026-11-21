/**
 * Arena-supplied reference board for replays whose original binary is unavailable.
 * It is deliberately plain and always captioned as a fallback, so it can never be
 * mistaken for an entrant's own renderer.
 */
import { DEN, isWater, TRAPS } from '../referee';
import type { Snapshot } from '../referee/types';

const SQ = 64;
const NAMES = ['Rat', 'Cat', 'Dog', 'Wolf', 'Leopard', 'Tiger', 'Lion', 'Elephant'];
const KINDS = ['rat', 'cat', 'dog', 'wolf', 'leopard', 'tiger', 'lion', 'elephant'];

export function drawReferenceBoard(canvas: HTMLCanvasElement, snapshot: Snapshot, flipped: boolean): void {
  canvas.width = 7 * SQ;
  canvas.height = 9 * SQ;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const cell = (square: number) => {
    const c = flipped ? 62 - square : square;
    return [(c % 7) * SQ, Math.floor(c / 7) * SQ] as const;
  };

  for (let square = 0; square < 63; square += 1) {
    const [x, y] = cell(square);
    const trap = TRAPS.red.has(square) || TRAPS.blue.has(square);
    const den = square === DEN.red || square === DEN.blue;
    ctx.fillStyle = isWater(square) ? '#b9cdd6' : den ? '#d9cfbf' : trap ? '#e3dccf' : '#efebe3';
    ctx.fillRect(x, y, SQ, SQ);
    ctx.strokeStyle = '#c9c1b2';
    ctx.strokeRect(x + 0.5, y + 0.5, SQ - 1, SQ - 1);
    if (trap || den) {
      ctx.fillStyle = '#7a705f';
      ctx.font = '10px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(den ? 'den' : 'trap', x + SQ / 2, y + SQ - 6);
    }
  }

  const last = snapshot.history[snapshot.history.length - 1];
  if (last) {
    ctx.strokeStyle = '#8a6d1d';
    ctx.lineWidth = 3;
    for (const sq of [last.src, last.dst]) {
      const [x, y] = cell(sq);
      ctx.strokeRect(x + 3, y + 3, SQ - 6, SQ - 6);
    }
    ctx.lineWidth = 1;
  }

  snapshot.board.forEach((piece, square) => {
    if (!piece) return;
    const [x, y] = cell(square);
    ctx.beginPath();
    ctx.arc(x + SQ / 2, y + SQ / 2, 24, 0, Math.PI * 2);
    ctx.fillStyle = piece.owner === 'red' ? '#9b3b2f' : '#2f4f8f';
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.fillText(NAMES[KINDS.indexOf(piece.kind)] ?? piece.kind, x + SQ / 2, y + SQ / 2 + 4);
  });

  ctx.fillStyle = 'rgba(30, 26, 20, 0.78)';
  ctx.fillRect(0, 9 * SQ - 26, 7 * SQ, 26);
  ctx.fillStyle = '#ffffff';
  ctx.font = '600 12px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Arena reference board — original renderer unavailable', (7 * SQ) / 2, 9 * SQ - 9);
}
