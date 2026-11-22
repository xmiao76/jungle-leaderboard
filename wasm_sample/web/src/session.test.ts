import { beforeAll, describe, expect, it } from 'vitest';
import { initWeb, web } from '../../tests/support';
import { Session, type AiRequest, type SessionEvent, type SessionOptions } from './session';

beforeAll(initWeb);

function setup(options: Partial<SessionOptions> = {}, first: 0 | 1 = 0) {
  const engine = new web.Game(first);
  const requests: AiRequest[] = [];
  const events: SessionEvent[] = [];
  const session = new Session(
    engine,
    { mode: 'human-ai', level: 1, humanSide: 0, seed: 7, budget: 500, ...options },
    (r) => requests.push(r),
    (e) => events.push(e),
  );
  /** Answer a request the way the worker would. */
  const answer = (request: AiRequest) => ({ id: request.id, index: web.choose(request.snapshot, request.budget, request.seed, request.level), ms: 1 });
  return { engine, session, requests, events, answer };
}

describe('Session', () => {
  it('lets the human move first when the human plays the first side', () => {
    const { session, requests } = setup();
    session.advance();
    expect(requests).toHaveLength(0);
    expect(session.isHumanTurn()).toBe(true);
    expect(session.humanMove(42, 35)).toBe(true);
    session.advance();
    expect(requests).toHaveLength(1);
  });

  it('lets the AI move first when the AI plays the first side', () => {
    const { session, requests, answer, engine } = setup({ humanSide: 1 }, 0);
    session.advance();
    expect(requests).toHaveLength(1);
    expect(session.receive(answer(requests[0]!))).toBe(true);
    expect(engine.rev()).toBe(1);
    expect(session.isHumanTurn()).toBe(true);
  });

  it('refuses illegal human moves and moves out of turn', () => {
    const { session, engine } = setup();
    expect(session.humanMove(42, 44)).toBe(false);
    expect(session.humanMove(14, 15)).toBe(false);
    expect(engine.rev()).toBe(0);
  });

  it('undo returns to the human’s previous turn (2 plies)', () => {
    const { session, requests, answer, engine } = setup();
    session.humanMove(42, 35);
    session.advance();
    session.receive(answer(requests[0]!));
    expect(engine.rev()).toBe(2);
    expect(session.undo()).toBe(2);
    expect(engine.rev()).toBe(0);
    expect(session.isHumanTurn()).toBe(true);
  });

  it('undo during the AI’s thought abandons its search and ignores its late reply', () => {
    const { session, requests, answer, engine, events } = setup();
    session.humanMove(42, 35);
    session.advance();
    const stale = requests[0]!;
    expect(session.thinking).toBe(true);
    expect(session.undo()).toBe(1);
    expect(engine.rev()).toBe(0);
    expect(session.thinking).toBe(false);
    expect(session.receive(answer(stale))).toBe(false);
    expect(engine.rev()).toBe(0);
    expect(events.filter((e) => e.type === 'moved')).toHaveLength(1);
  });

  it('a new request after undo gets a new id; only it is accepted', () => {
    const { session, requests, answer, engine } = setup();
    session.humanMove(42, 35);
    session.advance();
    session.undo();
    session.humanMove(48, 41);
    session.advance();
    expect(requests).toHaveLength(2);
    expect(requests[1]!.id).not.toBe(requests[0]!.id);
    expect(session.receive(answer(requests[0]!))).toBe(false);
    expect(session.receive(answer(requests[1]!))).toBe(true);
    expect(engine.rev()).toBe(2);
  });

  it('gives Hard a one-second wall-clock deadline, and only Hard', () => {
    const before = Date.now();
    const hard = setup({ mode: 'ai-ai', level: 2 });
    hard.session.advance();
    const deadline = hard.requests[0]!.deadlineEpochMs!;
    expect(deadline).toBeGreaterThanOrEqual(before + 1000);
    expect(deadline).toBeLessThanOrEqual(Date.now() + 1000);

    const medium = setup({ mode: 'ai-ai', level: 1 });
    medium.session.advance();
    expect(medium.requests[0]!.deadlineEpochMs).toBeUndefined();
  });

  it('cancel (restart) drops the outstanding request', () => {
    const { session, requests, answer } = setup({ mode: 'ai-ai' });
    session.advance();
    session.cancel();
    expect(session.receive(answer(requests[0]!))).toBe(false);
  });

  it('AI vs AI completes a whole game and undo works only while paused', () => {
    const { session, requests, answer, events, engine } = setup({ mode: 'ai-ai', budget: 200 });
    session.advance();
    for (let i = 0; i < 400 && !session.over; i += 1) {
      session.receive(answer(requests.at(-1)!));
      session.advance();
    }
    expect(session.over).toBe(true);
    expect(events.at(-1)).toEqual({ type: 'over' });
    expect(session.canUndo()).toBe(true); // finished games can be stepped back
    const rev = engine.rev();
    expect(session.undo()).toBe(1);
    expect(engine.rev()).toBe(rev - 1);
  });

  // Regression (review): ids restarted at 1 for every session, so the previous game's late
  // reply could be accepted by the new game.
  it('never accepts a reply from a previous game, even with a matching position', () => {
    const old = setup({ mode: 'ai-ai' });
    old.session.advance();
    old.session.cancel();
    const next = setup({ mode: 'ai-ai' });
    next.session.advance();
    expect(next.requests[0]!.id).not.toBe(old.requests[0]!.id);
    expect(next.session.receive(old.answer(old.requests[0]!))).toBe(false);
    expect(next.engine.rev()).toBe(0);
    expect(next.session.receive(next.answer(next.requests[0]!))).toBe(true);
  });

  it('falls back to the first legal move when the AI fails, instead of stalling', () => {
    const { session, requests, engine } = setup({ mode: 'ai-ai' });
    const first = Array.from(engine.legal().slice(0, 2));
    session.advance();
    expect(session.fail(requests[0]!.id)).toBe(true);
    expect(engine.rev()).toBe(1);
    expect(Array.from(engine.history())).toEqual(first);
    expect(session.thinking).toBe(false);
  });

  it('undo after an AI-vs-AI game ends leaves it paused rather than replaying a move', () => {
    const { session, requests, answer } = setup({ mode: 'ai-ai', budget: 200 });
    session.advance();
    for (let i = 0; i < 400 && !session.over; i += 1) {
      session.receive(answer(requests.at(-1)!));
      session.advance();
    }
    const asked = requests.length;
    session.undo();
    expect(session.paused).toBe(true);
    session.advance();
    expect(requests).toHaveLength(asked);
  });

  it('in AI vs AI, undo is refused while running', () => {
    const { session, requests, answer } = setup({ mode: 'ai-ai', budget: 200 });
    session.advance();
    session.receive(answer(requests[0]!));
    expect(session.canUndo()).toBe(false);
    session.paused = true;
    expect(session.canUndo()).toBe(true);
  });
});
