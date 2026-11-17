import { afterEach, describe, expect, it, vi } from 'vitest';
import { ROOM_FULL_HOST_TEXT, ROOM_FULL_PLAN_TEXT, hideRoomFullModal, isRoomFullClose, roomFullInfo, roomFullTitle, showRoomFullModal } from '../../src/room-full';

afterEach(() => { hideRoomFullModal(); document.body.innerHTML = ''; });

describe('«Комната заполнена»', () => {
  it('коды отказа по местам', () => {
    expect(isRoomFullClose(4402)).toBe(true);
    expect(isRoomFullClose(4430)).toBe(true);
    expect(isRoomFullClose(4503)).toBe(false);
    expect(roomFullInfo({ code: 4503 })).toBeNull();
  });

  it('лимит автора (4430) и лимит тарифа (4402): N из N и пояснение', () => {
    expect(roomFullInfo({ code: 4430, denied: { reason: 'room-full', maxGuests: 3, planLimited: false } })).toEqual({ maxGuests: 3, planLimited: false });
    expect(roomFullInfo({ code: 4402, denied: { reason: 'free-limit-reached', maxGuests: 1, planLimited: true } })).toEqual({ maxGuests: 1, planLimited: true });
    // без пакета denied (ретранслятор): тариф — по коду, без чисел
    expect(roomFullInfo({ code: 4402 })).toEqual({ planLimited: true });
    expect(roomFullInfo({ code: 4430 })).toEqual({ planLimited: false });
    expect(roomFullTitle(3)).toBe('В комнате сейчас максимум участников (3 из 3)');
    expect(roomFullTitle()).toBe('В комнате сейчас максимум участников');
  });

  it('окно: заголовок, текст и кнопки', () => {
    const retry = vi.fn();
    const ro = vi.fn();
    showRoomFullModal({ maxGuests: 2, planLimited: false, onRetry: retry, onReadOnly: ro });
    const m = document.getElementById('room-full-modal')!;
    expect(m.getAttribute('role')).toBe('dialog');
    expect(m.querySelector('h2')!.textContent).toBe('В комнате сейчас максимум участников (2 из 2)');
    expect(m.querySelector('.room-full-text')!.textContent).toBe(ROOM_FULL_HOST_TEXT);
    m.querySelector<HTMLButtonElement>('.room-full-readonly')!.click();
    expect(ro).toHaveBeenCalledTimes(1);
    expect(document.getElementById('room-full-modal')).toBeNull();
  });

  it('без «только для чтения»: только «Попробовать снова»', () => {
    const retry = vi.fn();
    showRoomFullModal({ planLimited: true, onRetry: retry });
    const m = document.getElementById('room-full-modal')!;
    expect(m.querySelector('.room-full-text')!.textContent).toBe(ROOM_FULL_PLAN_TEXT);
    expect(m.querySelector('.room-full-readonly')).toBeNull();
    m.querySelector<HTMLButtonElement>('.room-full-retry')!.click();
    expect(retry).toHaveBeenCalledTimes(1);
    expect(document.getElementById('room-full-modal')).toBeNull();
  });

  it('повторный показ заменяет окно', () => {
    showRoomFullModal({ planLimited: true, onRetry: () => {} });
    showRoomFullModal({ planLimited: false, onRetry: () => {} });
    expect(document.querySelectorAll('#room-full-modal')).toHaveLength(1);
  });
});
