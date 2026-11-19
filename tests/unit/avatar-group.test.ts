// Аватар, группа аватаров и меню аватара (src/avatar.ts, src/avatar-group.ts, src/avatar-menu.ts),
// пункты меню в присутствии (src/collab-presence.ts) и видимость чужих курсоров (src/cursor-visibility.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createUserAvatar, updateUserAvatar, type AvatarData } from '../../src/avatar';
import { createAvatarGroup, type AvatarGroupItem } from '../../src/avatar-group';
import { avatarMenuOpen, closeAvatarMenu, openAvatarMenu } from '../../src/avatar-menu';
import { avatarData, avatarStatus, groupItems, participantMenuEntries, selfMenuEntries } from '../../src/collab-presence';
import {
  cursorShown, onCursorVisibility, othersCursorsHidden, resetCursorVisibility, setOthersCursorsHidden, setUserCursorHidden, userCursorHidden,
} from '../../src/cursor-visibility';
import type { CollabUser } from '../../src/collab';
import { state } from '../../src/state';

const frame = () => new Promise(r => requestAnimationFrame(() => r(null)));
const data = (extra: Partial<AvatarData> = {}): AvatarData => ({ name: 'Капибара Иванова', bg: '#123456', fg: '#ffffff', cursorId: 'mint', status: 'online', ...extra });
const user = (extra: Partial<CollabUser> = {}): CollabUser => ({
  userId: 2, name: 'Капибара', color: '#e03131', host: false, away: false, cursor: null, pageId: 'p1', selection: [],
  rights: { default: 'edit', pages: {} }, ...extra,
});
/** В jsdom нет PointerEvent: обычное событие с pointerType. */
const pe = (type: string, init: { pointerType?: string; bubbles?: boolean } = {}): Event =>
  Object.assign(new MouseEvent(type, { bubbles: init.bubbles ?? false }), { pointerType: init.pointerType ?? 'mouse' });
const x = (el: HTMLElement): number => Number(/translateX\(([-\d.]+)px\)/.exec(el.style.transform)?.[1] ?? NaN);

function setMode(mode: 'off' | 'normal' | 'enhanced'): void {
  document.body.classList.toggle('no-ui-anim', mode === 'off');
  document.body.classList.toggle('no-motion', mode !== 'enhanced');
}

beforeEach(() => {
  setMode('off');
  setOthersCursorsHidden(false);
  resetCursorVisibility();
  state.project = { id: 'x', name: 'П', createdAt: 0, updatedAt: 0, pages: [{ id: 'p1', name: 'Алгебра', grid: 'square', elements: [] }] };
  state.pageId = 'p1';
});
afterEach(() => {
  closeAvatarMenu(true);
  document.body.textContent = '';
  setMode('enhanced');
});

describe('аватар', () => {
  it('инициалы, цвета, курсор каталога, статус и подпись; имя — только текстом', () => {
    const b = createUserAvatar(data({ name: '<img src=x onerror=alert(1)> Енот' }), 'presence-avatar');
    expect(b.querySelector('.ua-circle')!.textContent).toBe('IS');
    expect(b.querySelector('img')).toBeNull();
    expect(b.querySelector('.ua-cursor svg')).not.toBeNull();
    expect((b.querySelector('.ua-status') as HTMLElement).hidden).toBe(true);
    expect(b.classList.contains('presence-avatar')).toBe(true);
    expect(b.getAttribute('aria-label')).toBe('<img src=x onerror=alert(1)> Енот');
  });

  it('обновление на месте: «Отошёл» — серый круг и значок; скрытый курсор и скрытая страница — классы', () => {
    const b = createUserAvatar(data());
    const circle = b.querySelector('.ua-circle');
    updateUserAvatar(b, data({ status: 'away', cursorHidden: true, title: 'Капибара · Отошёл' }));
    expect(b.querySelector('.ua-circle')).toBe(circle);
    expect(b.classList.contains('away')).toBe(true);
    expect(b.classList.contains('cursor-off')).toBe(true);
    const st = b.querySelector('.ua-status') as HTMLElement;
    expect(st.hidden).toBe(false);
    expect(st.dataset.status).toBe('away');
    expect(b.title).toBe('Капибара · Отошёл');
    updateUserAvatar(b, data({ status: 'hidden-page' }));
    expect(b.classList.contains('on-hidden')).toBe(true);
    expect(b.classList.contains('away')).toBe(false);
  });
});

describe('группа аватаров', () => {
  const items = (n: number, onActivate?: (b: HTMLElement) => void): AvatarGroupItem[] =>
    Array.from({ length: n }, (_, i) => ({ key: `u${i}`, data: data({ name: `Участник ${i}` }), onActivate }));

  it('свёрнутая — тесно и без перекрытия; наведение мышью раскрывает, уход — сворачивает', () => {
    vi.useFakeTimers();
    try {
      const g = createAvatarGroup({ size: 26, tight: 3, open: 10 });
      document.body.append(g.el);
      g.set(items(3));
      const nodes = [...g.el.querySelectorAll<HTMLElement>('.user-avatar')];
      expect(nodes.map(x)).toEqual([0, 29, 58]);
      expect(g.interactive()).toBe(false);
      expect(g.el.style.width).toBe(`${58 + 26 + 4}px`);
      g.el.dispatchEvent(pe('pointerenter'));
      expect(g.interactive()).toBe(true);
      expect(nodes.map(x)).toEqual([0, 36, 72]);
      g.el.dispatchEvent(pe('pointerleave'));
      vi.advanceTimersByTime(300);
      expect(g.interactive()).toBe(false);
    } finally { vi.useRealTimers(); }
  });

  it('нажатие по свёрнутой (планшет) только раскрывает; второе — действие аватара', () => {
    const got: string[] = [];
    const g = createAvatarGroup();
    document.body.append(g.el);
    g.set(items(2, b => got.push(b.title)));
    const second = g.node('u1')!;
    second.click();
    expect(got).toEqual([]);
    expect(g.interactive()).toBe(true);
    second.click();
    expect(got).toEqual(['Участник 1']);
    // нажатие мимо сворачивает
    document.body.dispatchEvent(pe('pointerdown', { bubbles: true }));
    expect(g.interactive()).toBe(false);
  });

  it('один аватар — действие сразу; hold не даёт свернуться, пока открыто меню', () => {
    const got: number[] = [];
    const g = createAvatarGroup();
    document.body.append(g.el);
    g.set([{ key: 'me', data: data(), onActivate: () => got.push(1) }]);
    expect(g.interactive()).toBe(true);
    g.node('me')!.click();
    expect(got).toEqual([1]);
    g.set(items(3));
    g.el.dispatchEvent(pe('pointerenter'));
    g.hold(true);
    document.body.dispatchEvent(pe('pointerdown', { bubbles: true }));
    expect(g.interactive()).toBe(true);
    g.hold(false);
    expect(g.interactive()).toBe(false);
  });

  it('обновление по ключу не пересоздаёт узел; счётчик «+N»; ушедший удаляется («Выкл» — сразу)', () => {
    const g = createAvatarGroup();
    document.body.append(g.el);
    g.set(items(2));
    const first = g.node('u0');
    g.set([...items(2).map(i => ({ ...i, data: data({ name: 'Новое имя', status: 'away' as const }) })), { key: 'more', more: { count: 3, title: 'А, Б, В' } }]);
    expect(g.node('u0')).toBe(first);
    expect(first!.classList.contains('away')).toBe(true);
    expect(g.node('more')!.textContent).toBe('+3');
    g.set(items(1));
    expect(g.el.querySelectorAll('.ag-item')).toHaveLength(1);
  });

  it('«Обычные»: CSS-переходы, новый — ag-enter, ушедший уходит анимацией', () => {
    vi.useFakeTimers();
    try {
      setMode('normal');
      const g = createAvatarGroup();
      document.body.append(g.el);
      g.set(items(1));
      expect(g.el.classList.contains('ag-css')).toBe(true);
      g.set(items(2));
      expect(g.node('u1')!.classList.contains('ag-enter')).toBe(true);
      g.set(items(1));
      expect(g.el.querySelector('.ag-leave')).not.toBeNull();
      vi.advanceTimersByTime(200);
      expect(g.el.querySelectorAll('.ag-item')).toHaveLength(1);
    } finally { vi.useRealTimers(); }
  });

  it('«Улучшенные»: пружины доводят аватары до мест раскрытой стопки', async () => {
    setMode('enhanced');
    const g = createAvatarGroup({ size: 26, tight: 3, open: 10 });
    document.body.append(g.el);
    g.set(items(3));
    g.el.dispatchEvent(pe('pointerenter'));
    const last = g.node('u2')!;
    for (let i = 0; i < 240 && x(last) !== 72; i++) await frame();
    expect(x(last)).toBe(72);
    expect(g.el.classList.contains('ag-css')).toBe(false);
  });
});

describe('видимость чужих курсоров', () => {
  it('по одному и все сразу; подписчики узнают об изменениях', () => {
    const fn = vi.fn();
    const off = onCursorVisibility(fn);
    setUserCursorHidden(5, true);
    expect(cursorShown(5)).toBe(false);
    expect(cursorShown(6)).toBe(true);
    setOthersCursorsHidden(true);
    expect(cursorShown(6)).toBe(false);
    setOthersCursorsHidden(false);
    resetCursorVisibility();
    expect(userCursorHidden(5)).toBe(false);
    expect(othersCursorsHidden()).toBe(false);
    expect(fn).toHaveBeenCalledTimes(4);
    off();
  });
});

describe('меню аватара', () => {
  it('статус и данные аватара участника', () => {
    expect(avatarStatus({ away: true })).toBe('away');
    expect(avatarStatus({ away: true, hiddenPage: true })).toBe('hidden-page');
    setUserCursorHidden(2, true);
    expect(avatarData(user()).cursorHidden).toBe(true);
    expect(avatarData(user(), true).cursorHidden).toBe(false);
    expect(avatarData(user(), true).title).toBe('Вы — Капибара');
  });

  it('состав группы: я первым, потом другие и «+N»', () => {
    const me = user({ userId: 1, name: 'Я' });
    const others = Array.from({ length: 7 }, (_, i) => user({ userId: 10 + i, name: `У${i}` }));
    const list = groupItems([me, ...others], me);
    expect(list.map(i => i.key)).toEqual(['u1', 'u10', 'u11', 'u12', 'u13', 'u14', 'more']);
    expect(list[0].data!.self).toBe(true);
    expect(list.at(-1)!.more).toEqual({ count: 2, title: 'У5, У6' });
  });

  it('свой аватар: профиль и «Скрыть курсоры других»; без права звать — без «Позвать всех»', () => {
    const ids = selfMenuEntries(document.body).map(e => (e.kind === 'sep' ? '-' : e.id));
    expect(ids).toEqual(['profile', 'hide-cursors']);
  });

  it('чужой аватар без прав автора: перейти, скрыть курсор, следить (скоро); убрать и позвать — нет', () => {
    const entries = participantMenuEntries(user());
    expect(entries.map(e => (e.kind === 'sep' ? '-' : e.id))).toEqual(['goto', 'hide-cursor', 'follow']);
    const follow = entries.find(e => e.kind !== 'sep' && e.id === 'follow');
    expect(follow).toMatchObject({ disabled: true, badge: 'Скоро' });
    // все курсоры скрыты — свой переключатель недоступен и включён
    setOthersCursorsHidden(true);
    expect(participantMenuEntries(user()).find(e => e.kind === 'switch')).toMatchObject({ checked: true, disabled: true });
    // участник на скрытой странице — перейти нельзя
    expect(participantMenuEntries(user({ hiddenPage: true, pageId: null }))[0]).toMatchObject({ id: 'goto', disabled: true });
  });

  it('разметка: шапка с именем текстом, опасный пункт — с подтверждением, Escape закрывает', () => {
    const anchor = document.createElement('button');
    document.body.append(anchor);
    const run = vi.fn();
    const closed = vi.fn();
    const menu = openAvatarMenu({
      anchor, face: data({ name: '<b>Енот</b>' }), name: '<b>Енот</b>', sub: 'страница «Алгебра»', onClose: closed,
      entries: [
        { kind: 'switch', id: 'hide-cursor', label: 'Скрыть курсор', icon: '', checked: false, onChange: () => {} },
        { kind: 'sep' },
        { kind: 'action', id: 'remove', label: 'Убрать', icon: '', danger: true, confirm: 'Точно?', run },
      ],
    });
    expect(menu.querySelector('.avatar-menu-name')!.textContent).toBe('<b>Енот</b>');
    expect(menu.querySelector('b')).toBeNull();
    expect(anchor.getAttribute('aria-expanded')).toBe('true');
    const remove = menu.querySelector<HTMLButtonElement>('[data-action="remove"]')!;
    remove.click();
    expect(run).not.toHaveBeenCalled();
    expect(remove.textContent).toContain('Точно?');
    remove.click();
    expect(run).toHaveBeenCalledTimes(1);
    expect(closed).toHaveBeenCalledTimes(1);
    expect(avatarMenuOpen()).toBe(false);

    openAvatarMenu({ anchor, face: data(), name: 'Енот', sub: '', entries: [], onClose: closed });
    expect(avatarMenuOpen()).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(avatarMenuOpen()).toBe(false);
    expect(closed).toHaveBeenCalledTimes(2);
  });
});
