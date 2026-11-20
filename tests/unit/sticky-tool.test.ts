import { beforeEach, describe, expect, it } from 'vitest';
import { clearStickyTool, setStickyTool, stickyTool } from '../../src/sticky-tool';
import { setTool, state } from '../../src/state';

describe('залипающий инструмент', () => {
  beforeEach(() => { clearStickyTool(); setTool('select'); });

  it('включается и снимается явно', () => {
    setStickyTool('rect');
    expect(stickyTool()).toBe('rect');
    clearStickyTool();
    expect(stickyTool()).toBeNull();
  });

  it('снимается выбором другого инструмента, но не повторным выбором того же', () => {
    setTool('rect');
    setStickyTool(state.tool);
    setTool(state.tool);
    expect(stickyTool()).toBe(state.tool);
    setTool('pen');
    expect(stickyTool()).toBeNull();
  });
});
