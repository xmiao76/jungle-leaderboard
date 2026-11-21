import { FRAME_BYTES, FRAME_HEIGHT, FRAME_WIDTH } from './limits';

export interface Frame {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
  /** Bytes the guest actually presented, when `rgba` holds a capped copy. */
  readonly presentedBytes?: number;
}

export type FrameCheck = { readonly ok: true; readonly frame: Frame } | { readonly ok: false; readonly reason: string };

/** Each render call must synchronously present exactly one 448×576 RGBA8 frame. */
export function checkRenderFrames(frames: readonly Frame[]): FrameCheck {
  if (frames.length === 0) return { ok: false, reason: 'render() returned without presenting a frame.' };
  if (frames.length > 1) return { ok: false, reason: `render() presented ${frames.length} frames; exactly one is required.` };
  return checkFrame(frames[0]!);
}

export function checkFrame(frame: Frame): FrameCheck {
  if (frame.width !== FRAME_WIDTH || frame.height !== FRAME_HEIGHT) {
    return { ok: false, reason: `Frame is ${frame.width}×${frame.height}; the contract requires ${FRAME_WIDTH}×${FRAME_HEIGHT}.` };
  }
  const bytes = frame.presentedBytes ?? frame.rgba.byteLength;
  if (bytes !== FRAME_BYTES || frame.rgba.byteLength !== FRAME_BYTES) {
    return { ok: false, reason: `Frame has ${bytes} bytes; ${FRAME_WIDTH}×${FRAME_HEIGHT} RGBA8 needs ${FRAME_BYTES}.` };
  }
  return { ok: true, frame };
}
