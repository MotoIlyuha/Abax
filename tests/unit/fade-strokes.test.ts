import { afterEach, expect, it, vi } from 'vitest';
import { setFadeStrokeEnd, state } from '../../src/state';
import type { FadeStroke } from '../../src/types';

function stroke(endT: number | null, by?: number): FadeStroke {
  return { color: '#000000', width: 5, pts: [], endT, by };
}

afterEach(() => {
  state.fadeStrokes = [];
  vi.restoreAllMocks();
});

it('повторное касание сохраняет только ещё видимые штрихи того же автора', () => {
  vi.spyOn(performance, 'now').mockReturnValue(3000);
  const recent = stroke(1001);
  const expired = stroke(1000);
  const remote = stroke(2000, 42);
  state.fadeStrokes = [recent, expired, remote];

  setFadeStrokeEnd(undefined, null);
  const next = stroke(null);
  state.fadeStrokes.push(next);
  expect(recent.endT).toBeNull();
  expect(expired.endT).toBe(1000);
  expect(remote.endT).toBe(2000);

  setFadeStrokeEnd(undefined, 6000);
  expect(recent.endT).toBe(6000);
  expect(next.endT).toBe(6000);
  expect(expired.endT).toBe(1000);
  expect(remote.endT).toBe(2000);
});
