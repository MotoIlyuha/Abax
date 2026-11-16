// Каталог персональных курсоров: белый список, право по тарифу, контраст и SVG из констант.
import { describe, expect, it } from 'vitest';
import {
  CURSOR_IDS, CURSOR_PRESETS, DEFAULT_CURSOR_ID, canUseCursor, cleanCursorId, contrastRatio, cursorCss, cursorPreset, cursorSvg, isCursorId,
} from '../../src/cursors';

describe('каталог курсоров', () => {
  it('6 бесплатных и не меньше 6 Pro, идентификаторы уникальны', () => {
    expect(CURSOR_PRESETS.filter(p => p.tier === 'free')).toHaveLength(6);
    expect(CURSOR_PRESETS.filter(p => p.tier === 'pro').length).toBeGreaterThanOrEqual(6);
    expect(new Set(CURSOR_IDS).size).toBe(CURSOR_IDS.length);
    for (const id of CURSOR_IDS) expect(id).toMatch(/^[a-z][a-z0-9-]{1,23}$/);
  });

  it('классический курсор: белый с тёмным контуром, выделение — фирменный синий', () => {
    const d = cursorPreset(DEFAULT_CURSOR_ID);
    expect(d).toMatchObject({ id: 'default', tier: 'free', fill: '#ffffff', selectionColor: '#3273f5' });
    expect(contrastRatio(d.outline, '#ffffff')).toBeGreaterThan(10);
    // цвет курсора и цвет выделения — разные вещи
    expect(d.fill).not.toBe(d.selectionColor);
  });

  it('контраст: выделение к белому ≥ 3:1, текст бейджа ≥ 4.5:1', () => {
    for (const p of CURSOR_PRESETS) {
      expect(contrastRatio(p.selectionColor, '#ffffff'), p.id).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(p.badgeText, p.badgeBg), p.id).toBeGreaterThanOrEqual(4.5);
      for (const c of [p.fill, p.outline, p.selectionColor, p.badgeBg, p.badgeText, p.effectColor]) expect(c).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('у каждого Pro — узор и эффект, у бесплатных эффекта нет', () => {
    for (const p of CURSOR_PRESETS) {
      if (p.tier === 'pro') {
        expect(p.pattern, p.id).toBeTruthy();
        expect(p.effect, p.id).not.toBe('none');
      } else {
        expect(p.effect, p.id).toBe('none');
      }
    }
  });

  it('белый список и неизвестные значения', () => {
    expect(isCursorId('neon')).toBe(true);
    expect(isCursorId('nope')).toBe(false);
    expect(isCursorId(5)).toBe(false);
    expect(isCursorId('__proto__')).toBe(false);
    expect(cursorPreset('nope').id).toBe('default');
    expect(cursorPreset(null).id).toBe('default');
  });

  it('право по тарифу и очистка входящего идентификатора', () => {
    expect(canUseCursor('mint', 'free')).toBe(true);
    expect(canUseCursor('neon', 'free')).toBe(false);
    expect(canUseCursor('neon', 'pro')).toBe(true);
    expect(canUseCursor('neon', 'tutor')).toBe(true);
    expect(canUseCursor('nope', 'pro')).toBe(false);
    expect(cleanCursorId('neon', true)).toBe('neon');
    expect(cleanCursorId('neon', false)).toBe('default');
    expect(cleanCursorId('mint', false)).toBe('mint');
    expect(cleanCursorId('<svg onload=x>', true)).toBeUndefined();
    expect(cleanCursorId(undefined, true)).toBeUndefined();
  });

  it('SVG: корректная разметка без чужих данных, уникальные id узоров', () => {
    const parser = new DOMParser();
    for (const p of CURSOR_PRESETS) {
      const s = cursorSvg(p.id);
      const doc = parser.parseFromString(s, 'image/svg+xml');
      expect(doc.querySelector('parsererror'), p.id).toBeNull();
      expect(doc.documentElement.getAttribute('viewBox')).toBe('0 0 32 32');
      expect(s).not.toMatch(/<script|on[a-z]+=|href=/i);
      for (const el of doc.querySelectorAll('[id]')) expect(el.id.startsWith(`abc-${p.id}-`), p.id).toBe(true);
    }
    // неизвестный идентификатор не попадает в разметку
    expect(cursorSvg('"><script>')).toBe(cursorSvg('default'));
    expect(cursorSvg('mint', { size: 20, className: 'cursor-icon' })).toMatch(/^<svg[^>]*class="cursor-icon"[^>]*width="20"/);
  });

  it('CSS-курсор: data URL с горячей точкой и запасной стрелкой', () => {
    const css = cursorCss('neon');
    expect(css).toMatch(/^url\("data:image\/svg\+xml,%3Csvg.*"\) 3 2, default$/);
    expect(css).not.toContain('"<');
  });
});
