// «Привлечь внимание» (SPEC_COMMENTS §5): частицы, пакет хабу и уведомление у получателя.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attractAttention, receiveAttention, ATTENTION_NOTICE_MS } from '../../src/attention';
import { burst, flightFrames, liveParticles, resetBursts, BURST_COUNT_CSS, BURST_COUNT_SMALL } from '../../src/reaction-burst';
import { clearNotices, notices } from '../../src/notify-center';
import { setAnnotView } from '../../src/annot-prefs';
import { addElement, blankProject, openProject, state } from '../../src/state';
import type { ShapeEl } from '../../src/types';

const rect = (id: string, extra: Partial<ShapeEl> = {}): ShapeEl =>
  ({ id, type: 'shape', shape: 'rect', x: 100, y: 100, w: 200, h: 100, color: '#000', width: 2, text: 'Задача', ...extra });

beforeEach(() => {
  document.body.innerHTML = '<div id="canvas-wrap"></div>';
  document.body.className = 'no-motion'; // «Обычные»: частицы — CSS
  resetBursts();
  clearNotices();
  openProject(blankProject('Тест'));
  state.view = 'board';
  state.linkMode = null;
  state.camera = { x: 0, y: 0, zoom: 1 };
  addElement(rect('a', { reactions: { '👍': ['u1'] } }));
});
afterEach(() => { vi.useRealTimers(); document.body.className = ''; });

describe('частицы', () => {
  it('«Обычные» — CSS-частицы с эмодзи текстом; «Выкл» — без частиц; маленькие — свой счёт', () => {
    expect(burst('<b>👍</b>', { x: 10, y: 10 })).toBe(true);
    const ps = document.querySelectorAll('#burst-layer .burst-p.burst-css');
    expect(ps).toHaveLength(BURST_COUNT_CSS);
    expect(ps[0].textContent).toBe('<b>👍</b>');
    expect(document.querySelector('#burst-layer b')).toBeNull();
    resetBursts();
    burst('👍', { x: 0, y: 0, angle: 0, small: true });
    expect(liveParticles()).toBe(BURST_COUNT_SMALL);
    resetBursts();
    document.body.className = 'no-ui-anim';
    expect(burst('👍', { x: 0, y: 0 })).toBe(false);
    expect(liveParticles()).toBe(0);
  });

  it('кадры полёта: из точки старта, с подскоком масштаба и угасанием к концу', () => {
    const f = flightFrames(100, 50, 0, 200, 0, 1000, 30, 20);
    expect(f[0]).toMatchObject({ offset: 0, opacity: 0 });
    expect(String(f[0].transform)).toContain('translate(90.0px, 40.0px)');
    expect(f[f.length - 1]).toMatchObject({ offset: 1, opacity: 0 });
    expect(Math.max(...f.map(k => k.opacity as number))).toBe(1);
  });
});

describe('привлечь внимание', () => {
  it('щелчок — частицы из объекта; скрытые реакции — без частиц; повтор сразу — без новых', () => {
    attractAttention('a', '👍');
    expect(liveParticles()).toBe(BURST_COUNT_CSS);
    attractAttention('a', '👍');
    expect(liveParticles()).toBe(BURST_COUNT_CSS);
    resetBursts();
    setAnnotView({ reactions: false });
    attractAttention('a', '🔥');
    expect(liveParticles()).toBe(0);
    setAnnotView({ reactions: true });
  });

  it('получатель: частицы на своей странице, уведомление с эмодзи и «Перейти»; повтор от того же — без нового уведомления', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_000_000);
    receiveAttention({ pageId: state.pageId, elId: 'a', emoji: '👍', by: 7 });
    expect(liveParticles()).toBe(BURST_COUNT_CSS);
    expect(notices()).toHaveLength(1);
    const n = notices()[0];
    expect(n).toMatchObject({ title: 'Участник', emoji: '👍', kind: 'system' });
    expect(n.body).toBe('привлекает внимание · Фигура «Задача»');
    expect(n.action?.label).toBe('Перейти');
    receiveAttention({ pageId: state.pageId, elId: 'a', emoji: '❤️', by: 7 });
    expect(notices()).toHaveLength(1);
    vi.setSystemTime(1_000_000 + ATTENTION_NOTICE_MS);
    receiveAttention({ pageId: state.pageId, elId: 'a', emoji: '❤️', by: 7 });
    expect(notices()).toHaveLength(2);
    // неизвестная страница — ничего
    receiveAttention({ pageId: 'нет', elId: 'a', emoji: '❤️', by: 8 });
    expect(notices()).toHaveLength(2);
  });

  it('курсор отправителя краевой — из него ещё маленькие реакции внутрь экрана', async () => {
    const presence = await import('../../src/collab-presence');
    const spy = vi.spyOn(presence, 'edgePointerOf').mockImplementation(uid => (uid === 9 ? { x: 0, y: 200, angle: Math.PI } : null));
    receiveAttention({ pageId: state.pageId, elId: 'a', emoji: '🔥', by: 9 });
    expect(liveParticles()).toBe(BURST_COUNT_CSS + BURST_COUNT_SMALL);
    // маленькие летят вправо — от левого края внутрь
    const small = [...document.querySelectorAll<HTMLElement>('#burst-layer .burst-p')].slice(-BURST_COUNT_SMALL);
    expect(small.every(p => parseFloat(p.style.getPropertyValue('--dx')) > 0)).toBe(true);
    spy.mockRestore();
  });
});

