// Эффекты персональных курсоров, курсор над холстом и иконка «Выделения» на панели.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_PARTICLES, fxEnabled, fxForget, fxMove, particleCount, resetFxForTests, stepParticles, type Particle } from '../../src/cursor-fx';
import { resetProfileForTests, setProfile } from '../../src/profile';
import { clearServerPlan } from '../../src/plan';
import { toolDef, TOOL_DEFS } from '../../src/toolbar';
import { cursorSvg } from '../../src/cursors';

beforeEach(() => {
  localStorage.clear();
  clearServerPlan();
  resetProfileForTests();
  resetFxForTests();
  document.body.className = '';
  document.body.innerHTML = '<div id="canvas-wrap"></div>';
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  vi.stubEnv('DEV', false); // в Vitest import.meta.env.DEV = true — это dev-режим с правом на Pro-курсоры
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('слой эффектов курсора', () => {
  it('шлейф рождает частицы по пути, классический курсор — нет', () => {
    fxMove('me', 0, 0, 'default');
    fxMove('me', 50, 0, 'default');
    expect(particleCount()).toBe(0);
    fxMove('me', 0, 0, 'flame');
    expect(particleCount()).toBe(0); // первая точка — только запоминается
    fxMove('me', 40, 0, 'flame', () => 0.5);
    expect(particleCount()).toBe(8);
  });

  it('свечение не рисуется на слое (оно вшито в SVG)', () => {
    fxMove('me', 0, 0, 'neon');
    fxMove('me', 40, 0, 'neon');
    expect(particleCount()).toBe(0);
  });

  it('скачок курсора и забытый курсор не дают шлейфа', () => {
    fxMove('u1', 0, 0, 'flame');
    fxMove('u1', 900, 900, 'flame');
    expect(particleCount()).toBe(0);
    fxForget('u1');
    fxMove('u1', 905, 900, 'flame');
    expect(particleCount()).toBe(0);
  });

  it('частиц не больше лимита', () => {
    let x = 0;
    fxMove('me', x, 0, 'flame');
    for (let i = 0; i < 100; i++) { x += 40; fxMove('me', x, 0, 'flame'); }
    expect(particleCount()).toBe(MAX_PARTICLES);
  });

  it('выключено при «Motion анимации» = выкл и при уменьшении движения', () => {
    document.body.classList.add('no-motion');
    expect(fxEnabled()).toBe(false);
    fxMove('me', 0, 0, 'flame');
    fxMove('me', 40, 0, 'flame');
    expect(particleCount()).toBe(0);
    document.body.classList.remove('no-motion');
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    expect(fxEnabled()).toBe(false);
  });

  it('частицы стареют и исчезают', () => {
    const list: Particle[] = [{ x: 0, y: 0, vx: 100, vy: 0, life: 100, max: 100, size: 2, color: '#fff', shape: 'dot' }];
    stepParticles(list, 50);
    expect(list[0].x).toBeCloseTo(5);
    expect(list[0].life).toBe(50);
    stepParticles(list, 60);
    expect(list).toHaveLength(0);
  });
});

describe('иконка «Выделения» на панели', () => {
  it('показывает выбранный курсор и меняется вместе с профилем', () => {
    expect(toolDef('select').icon).toBe(cursorSvg('default', { size: 24, className: 'cursor-icon' }));
    setProfile({ cursorId: 'mint' });
    expect(toolDef('select').icon).toContain('#0b4f3c');
    expect(TOOL_DEFS.find(t => t.id === 'select')!.icon).toContain('#96f2d7');
    // Pro-курсор без права — на панели классический
    setProfile({ cursorId: 'gold' });
    expect(toolDef('select').icon).toBe(cursorSvg('default', { size: 24, className: 'cursor-icon' }));
    expect(toolDef('select').title).toBe('Выделение и перемещение');
  });
});
