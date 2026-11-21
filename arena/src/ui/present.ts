import { checkFrame, type Frame } from '../loader/frame';

/**
 * Canvas 2D presentation path. The frame is verified again on the main thread before
 * it touches a canvas, whatever the worker already checked.
 */
export function presentFrame(canvas: HTMLCanvasElement, frame: Frame): boolean {
  const check = checkFrame(frame);
  const ctx = canvas.getContext('2d');
  if (!check.ok || !ctx) return false;
  if (canvas.width !== frame.width) canvas.width = frame.width;
  if (canvas.height !== frame.height) canvas.height = frame.height;
  const pixels = new Uint8ClampedArray(frame.rgba.buffer as ArrayBuffer, frame.rgba.byteOffset, frame.rgba.byteLength);
  ctx.putImageData(new ImageData(pixels, frame.width, frame.height), 0, 0);
  return true;
}
