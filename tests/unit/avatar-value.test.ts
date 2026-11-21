// Значение аватара (src/avatar-value.ts) и его зеркало для хаба Electron (electron/room-avatar.cjs).
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import * as ts from '../../src/avatar-value';
import { clampView, coverScale, cropSource, zoomAt } from '../../src/avatar-crop';
import { diffUsers, userEventText } from '../../src/activity-pills';

const require = createRequire(import.meta.url);
const cjs = require('../../electron/room-avatar.cjs');

const photo = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
const samples: unknown[] = [
  null, '', '😀', '👨‍👩‍👧‍👦', '🇷🇺', '1️⃣', '❤️', '👍🏽', 'a', 'привет', '😀 ', ' 😀', '<b>', '😀a', '123',
  '😀'.repeat(17), photo, 'data:image/png;base64,iVBORw0KGgo=', 'data:image/webp;base64,UklGR',
  'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/jpeg;base64,<script>', `data:image/jpeg;base64,${'A'.repeat(ts.MAX_AVATAR_PHOTO)}`,
  'https://example.com/a.png', 5, {}, undefined,
];

describe('значение аватара', () => {
  it('смайлы - только символы эмодзи', () => {
    for (const ok of ['😀', '👨‍👩‍👧‍👦', '🇷🇺', '1️⃣', '❤️', '👍🏽']) expect(ts.isAvatarEmoji(ok)).toBe(true);
    for (const bad of ['', 'a', 'привет', '😀 ', '<b>', '😀a', '123', '😀'.repeat(17), 5]) expect(ts.isAvatarEmoji(bad)).toBe(false);
  });

  it('фото - только data:image jpeg/png/webp в base64 и не длиннее предела', () => {
    expect(ts.isAvatarPhoto(photo)).toBe(true);
    expect(ts.isAvatarPhoto('data:image/svg+xml;base64,PHN2Zz4=')).toBe(false);
    expect(ts.isAvatarPhoto('data:image/jpeg;base64,<script>')).toBe(false);
    expect(ts.isAvatarPhoto(`data:image/jpeg;base64,${'A'.repeat(ts.MAX_AVATAR_PHOTO)}`)).toBe(false);
  });

  it('cleanAvatar: null и пустое - буквы, неподходящее - undefined; ключ снимка - без фото', () => {
    expect(ts.cleanAvatar(null)).toBeNull();
    expect(ts.cleanAvatar('')).toBeNull();
    expect(ts.cleanAvatar('🦊')).toBe('🦊');
    expect(ts.cleanAvatar('лиса')).toBeUndefined();
    expect(ts.avatarKey('🦊', 3)).toBe('🦊');
    expect(ts.avatarKey(photo, 3)).toBe('photo:3');
    expect(ts.avatarKey(null, 3)).toBeNull();
    expect(ts.PHOTO_KEY.test('photo:3')).toBe(true);
  });

  it('зеркало electron/room-avatar.cjs отвечает так же', () => {
    expect(cjs.MAX_AVATAR_PHOTO).toBe(ts.MAX_AVATAR_PHOTO);
    expect(cjs.MAX_AVATAR_EMOJI).toBe(ts.MAX_AVATAR_EMOJI);
    for (const v of samples) {
      expect(cjs.cleanAvatar(v)).toEqual(ts.cleanAvatar(v));
      expect(cjs.isAvatarPhoto(v)).toBe(ts.isAvatarPhoto(v));
      expect(cjs.isAvatarEmoji(v)).toBe(ts.isAvatarEmoji(v));
    }
    expect(cjs.avatarKey(photo, 2)).toBe(ts.avatarKey(photo, 2));
  });
});

describe('обрезка под круг', () => {
  it('фото всегда закрывает круг: масштаб не меньше нужного, сдвиг ограничен', () => {
    const w = 800, h = 400;
    const min = coverScale(w, h, 200);
    expect(min).toBe(0.5);
    const v = clampView({ scale: 0.1, cx: 1000, cy: -500 }, w, h, 240, 200);
    expect(v.scale).toBe(0.5);
    // левый край фото не правее круга (отступ 20), верх — не ниже
    expect(v.cx - (w * v.scale) / 2).toBeLessThanOrEqual(20);
    expect(v.cy - (h * v.scale) / 2).toBeCloseTo(20);
    expect(clampView({ scale: 100, cx: 120, cy: 120 }, w, h, 240, 200).scale).toBe(2.5);
  });

  it('видимый в круге квадрат и масштаб вокруг точки', () => {
    const v = clampView({ scale: 0.5, cx: 120, cy: 120 }, 800, 400, 240, 200);
    const src = cropSource(v, 800, 400, 240, 200);
    expect(src.side).toBe(400);
    expect(src.sx).toBeCloseTo(200);
    expect(src.sy).toBeCloseTo(0);
    const z = zoomAt({ scale: 1, cx: 100, cy: 100 }, 2, 50, 50);
    expect(z).toEqual({ scale: 2, cx: 150, cy: 150 });
  });
});

describe('пилюля «сменил аватар»', () => {
  it('первое сообщение об аватаре - не смена; дальше - пилюля', () => {
    const before = [{ userId: 1, name: 'Аня' }];
    expect(diffUsers(before, [{ userId: 1, name: 'Аня', avatar: '🦊' }], 0)).toEqual([]);
    const evs = diffUsers([{ userId: 1, name: 'Аня', avatar: '🦊' }], [{ userId: 1, name: 'Аня', avatar: 'photo:1' }], 0);
    expect(evs).toEqual([{ kind: 'avatar', user: { userId: 1, name: 'Аня', avatar: 'photo:1' } }]);
    expect(userEventText(evs[0])).toBe('Аня сменил аватар');
    expect(diffUsers([{ userId: 1, name: 'Аня', avatar: 'photo:1' }], [{ userId: 1, name: 'Аня', avatar: null }], 0)).toHaveLength(1);
    // свой аватар — без пилюли
    expect(diffUsers([{ userId: 0, name: 'Я', avatar: null }], [{ userId: 0, name: 'Я', avatar: '🐼' }], 0)).toEqual([]);
  });
});
