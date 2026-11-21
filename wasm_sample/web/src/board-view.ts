// Board presentation and input. Pixels and pointer always use the same flip mapping:
// both come from jungle-core (render / square_at_pixel), so they can never disagree.
import { square_at_pixel } from './pkg/jungle_web.js';

export const WIDTH = 448;
export const HEIGHT = 576;

export class BoardView {
  private readonly ctx: CanvasRenderingContext2D;
  flipped = false;
  /** Keyboard cursor, as a board square. */
  cursor = 45;

  constructor(
    readonly canvas: HTMLCanvasElement,
    private readonly cursorEl: HTMLElement,
    private readonly onSquare: (square: number) => void,
  ) {
    this.ctx = canvas.getContext('2d')!;
    canvas.addEventListener('click', (event) => {
      const square = this.squareFromClient(event.clientX, event.clientY);
      if (square >= 0) {
        this.cursor = square;
        this.placeCursor(false);
        this.onSquare(square);
      }
    });
    canvas.addEventListener('keydown', (event) => this.onKey(event));
    canvas.addEventListener('focus', () => this.placeCursor(true));
    canvas.addEventListener('blur', () => this.cursorEl.classList.remove('visible'));
  }

  present(rgba: Uint8Array): void {
    const pixels = new Uint8ClampedArray(rgba.buffer as ArrayBuffer, rgba.byteOffset, rgba.byteLength);
    this.ctx.putImageData(new ImageData(pixels, WIDTH, HEIGHT), 0, 0);
  }

  /** Map a viewport point to a board square through the canvas scale and the flip. */
  squareFromClient(clientX: number, clientY: number): number {
    const rect = this.canvas.getBoundingClientRect();
    const x = Math.floor(((clientX - rect.left) / rect.width) * WIDTH);
    const y = Math.floor(((clientY - rect.top) / rect.height) * HEIGHT);
    return square_at_pixel(x, y, this.flipped);
  }

  /** The view cell (0 = top-left as displayed) of a square. */
  private cellOf(square: number): number {
    return this.flipped ? 62 - square : square;
  }

  private onKey(event: KeyboardEvent): void {
    const moves: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    const delta = moves[event.key];
    if (delta) {
      event.preventDefault();
      const cell = this.cellOf(this.cursor);
      const row = Math.min(8, Math.max(0, Math.floor(cell / 7) + delta[0]));
      const col = Math.min(6, Math.max(0, (cell % 7) + delta[1]));
      const next = row * 7 + col;
      this.cursor = this.flipped ? 62 - next : next;
      this.placeCursor(true);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.onSquare(this.cursor);
    }
  }

  placeCursor(visible: boolean): void {
    const cell = this.cellOf(this.cursor);
    this.cursorEl.style.left = `${((cell % 7) / 7) * 100}%`;
    this.cursorEl.style.top = `${(Math.floor(cell / 7) / 9) * 100}%`;
    this.cursorEl.classList.toggle('visible', visible);
  }
}
