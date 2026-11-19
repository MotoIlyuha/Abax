import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  STACK_IDLE_MS, STACK_LEAVE_MS, STACK_MAX, STACK_QUIET_MS, clearNotifyStack, initNotifyStack, stackCount, stackShown,
} from '../../src/notify-stack';
import { initNotifyButton, notifyShownCount } from '../../src/notify-button';
import { clearNotices, markRead, notices, pushNotice, setDoNotDisturb, unreadCount, type NoticeIcon } from '../../src/notify-center';

const stack = () => document.getElementById('notify-stack') as HTMLElement;
const btn = () => document.getElementById('btn-notify') as HTMLButtonElement;
const cards = () => [...stack().querySelectorAll<HTMLElement>('.ns-card:not(.ns-leaving)')];
const shownCards = () => cards().filter(c => c.getAttribute('aria-hidden') !== 'true');
const labels = () => shownCards().map(c => c.getAttribute('aria-label'));
/** Передняя карточка — с наибольшим z-index. */
const front = () => shownCards().sort((a, b) => Number(b.style.zIndex) - Number(a.style.zIndex))[0];
const fire = (el: EventTarget, type: string, init: MouseEventInit = {}) => el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, ...init }));
/** Наведение — движением мыши над элементом. */
const enter = (el: Element) => fire(el, 'pointermove', { bubbles: false });
const leave = (el: Element) => fire(el, 'pointerleave', { bubbles: false });
const key = (el: Element, k: string) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

function setup(mode: string): void {
  document.body.className = mode;
  document.body.innerHTML = '<div id="topbar"><div class="topbar-left"><button id="btn-notify"></button></div></div>';
  initNotifyButton();
  initNotifyStack();
}

describe('стопка уведомлений («Выкл»: всё сразу)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setup('no-motion no-ui-anim');
  });
  afterEach(() => {
    clearNotifyStack();
    clearNotices();
    setDoNotDisturb(false);
    localStorage.clear();
    vi.useRealTimers();
    document.body.className = '';
  });

  it('новое уведомление — карточка с аватаром участника, значком события и временем; живая область проговаривает', () => {
    pushNotice({ title: 'Капибара', body: 'присоединился к доске', icon: 'join', level: 'ok', user: { userId: 2, name: 'Капибара', cursorId: 'mint' } });
    expect(stackShown()).toBe(true);
    expect(stack().hidden).toBe(false);
    expect(cards()).toHaveLength(1);
    const card = cards()[0];
    expect(card.getAttribute('aria-label')).toBe('Капибара присоединился к доске');
    expect(card.textContent).toContain('Капибара присоединился к доске');
    expect(card.querySelector('.ns-title')!.textContent).toBe('Капибара');
    expect(card.querySelector('.ns-time')!.textContent).toBe('сейчас');
    const avatar = card.querySelector<HTMLElement>('.ns-media .user-avatar')!;
    expect(avatar.tabIndex).toBe(-1);
    expect(avatar.querySelector('.ua-cursor svg')).not.toBeNull();
    expect(card.querySelector('.ns-ev svg')).not.toBeNull();
    expect(card.classList.contains('ns-ok')).toBe(true);
    expect(document.getElementById('notify-live')!.textContent).toBe('Капибара присоединился к доске');
    expect(document.getElementById('notify-live')!.getAttribute('aria-live')).toBe('polite');
  });

  it('системное без участника — цветной квадрат с иконкой события', () => {
    pushNotice({ level: 'warn', title: 'Соединение прервано, переподключаемся…', icon: 'offline' });
    const card = cards()[0];
    expect(card.classList.contains('ns-warn')).toBe(true);
    expect(card.querySelector('.ns-media.ns-square svg')).not.toBeNull();
    expect(card.querySelector('.ns-title.ns-wrap')).not.toBeNull();
    expect(card.querySelector('.ns-body')).toBeNull();
  });

  it(`не больше ${STACK_MAX}: новое вытесняет самое старое (в центре оно остаётся непрочитанным)`, () => {
    for (let i = 1; i <= 7; i++) pushNotice({ title: `№${i}` });
    expect(stackCount()).toBe(STACK_MAX);
    expect(labels()).toEqual(['№7', '№6', '№5', '№4', '№3']);
    expect(front().getAttribute('aria-label')).toBe('№7');
    expect(unreadCount()).toBe(7);
    // свёрнутая стопка: у задних содержимое гаснет, видны две
    expect(shownCards().filter(c => c.classList.contains('ns-back'))).toHaveLength(4);
  });

  it('через 5 с стопка уходит в кнопку; счётчик досчитывает, когда она долетела', () => {
    pushNotice({ title: 'а' });
    pushNotice({ kind: 'chat', title: 'Лемур', body: 'привет' });
    // пока карточки на экране, кнопка их не считает
    expect(notifyShownCount()).toBe(0);
    vi.advanceTimersByTime(STACK_IDLE_MS - 1);
    expect(stackShown()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(stackShown()).toBe(false);
    expect(stack().hidden).toBe(true);
    expect(stackCount()).toBe(2);
    expect(notifyShownCount()).toBe(2);
    expect(btn().getAttribute('aria-label')).toBe('Чат и уведомления: непрочитанных — 2');
  });

  it('наведение раскрывает и держит стопку; уход мыши — через 600 мс в кнопку', () => {
    pushNotice({ title: 'а' });
    pushNotice({ title: 'б' });
    enter(stack());
    expect(stack().classList.contains('expanded')).toBe(true);
    expect(stack().querySelector('.ns-head-title')!.textContent).toBe('Новые · 2');
    expect(shownCards().some(c => c.classList.contains('ns-back'))).toBe(false);
    vi.advanceTimersByTime(STACK_IDLE_MS * 3);
    expect(stackShown()).toBe(true);
    leave(stack());
    expect(stack().classList.contains('expanded')).toBe(false);
    // 5 с с последнего нового давно прошли — уходит через STACK_LEAVE_MS
    vi.advanceTimersByTime(STACK_LEAVE_MS - 1);
    expect(stackShown()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(stackShown()).toBe(false);
  });

  it('наведение на кнопку ЧУ поднимает ушедшее и раскладывает; уход — обратно через 600 мс', () => {
    pushNotice({ title: 'а' });
    pushNotice({ title: 'б' });
    vi.advanceTimersByTime(STACK_IDLE_MS);
    expect(stackShown()).toBe(false);
    enter(btn());
    expect(stackShown()).toBe(true);
    expect(stack().classList.contains('expanded')).toBe(true);
    expect(labels()).toEqual(['б', 'а']);
    leave(btn());
    vi.advanceTimersByTime(STACK_LEAVE_MS);
    expect(stackShown()).toBe(false);
    // показ не читает
    expect(unreadCount()).toBe(2);
    expect(notifyShownCount()).toBe(2);
  });

  it('пустая стопка из кнопки не поднимается', () => {
    enter(btn());
    expect(stackShown()).toBe(false);
  });

  it('× и Delete убирают карточку и помечают прочитанной; фокус — на следующую', () => {
    pushNotice({ title: 'а' });
    pushNotice({ title: 'б' });
    pushNotice({ title: 'в' });
    enter(stack());
    (front().querySelector('.ns-close') as HTMLButtonElement).click();
    expect(stackCount()).toBe(2);
    expect(notices().find(n => n.title === 'в')!.read).toBe(true);
    expect(unreadCount()).toBe(2);
    const first = front();
    first.focus();
    key(first, 'Delete');
    expect(stackCount()).toBe(1);
    expect(document.activeElement).toBe(front());
    key(front(), 'Backspace');
    expect(stackCount()).toBe(0);
    expect(unreadCount()).toBe(0);
    expect(stack().hidden).toBe(true);
    expect(document.activeElement).toBe(btn());
  });

  it('тихие видны 3.5 с и исчезают: в кнопку не уходят и не копятся', () => {
    pushNotice({ title: 'Вы позвали всех на эту страницу', quiet: true });
    expect(stackShown()).toBe(true);
    expect(notifyShownCount()).toBe(0);
    vi.advanceTimersByTime(STACK_QUIET_MS - 1);
    expect(stackCount()).toBe(1);
    vi.advanceTimersByTime(1);
    expect(stackCount()).toBe(0);
    expect(stackShown()).toBe(false);
    expect(notifyShownCount()).toBe(0);
    // вместе с обычным: тихое уходит раньше, обычное — в кнопку
    pushNotice({ title: 'обычное' });
    pushNotice({ title: 'тихое', quiet: true });
    vi.advanceTimersByTime(STACK_QUIET_MS);
    expect(labels()).toEqual(['обычное']);
    vi.advanceTimersByTime(STACK_IDLE_MS);
    expect(stackShown()).toBe(false);
    expect(stackCount()).toBe(1);
    expect(notifyShownCount()).toBe(1);
  });

  it('«не беспокоить»: стопка не показывается, уведомление сразу в кнопке; тихие — видны', () => {
    setDoNotDisturb(true);
    pushNotice({ title: 'Капибара', body: 'присоединился к доске', user: { name: 'Капибара' } });
    expect(stackShown()).toBe(false);
    expect(stackCount()).toBe(1);
    expect(notifyShownCount()).toBe(1);
    expect(document.getElementById('notify-live')!.textContent).toBe('');
    pushNotice({ title: 'Вы позвали всех на эту страницу', quiet: true });
    expect(stackShown()).toBe(true);
    expect(labels()).toEqual(['Вы позвали всех на эту страницу']);
    vi.advanceTimersByTime(STACK_QUIET_MS);
    expect(stackShown()).toBe(false);
    // наведение на кнопку показывает и то, что пришло при «не беспокоить»
    enter(btn());
    expect(labels()).toEqual(['Капибара присоединился к доске']);
  });

  it('включили «не беспокоить» — стопка сразу уходит в кнопку', () => {
    pushNotice({ title: 'а' });
    setDoNotDisturb(true);
    expect(stackShown()).toBe(false);
    expect(notifyShownCount()).toBe(1);
  });

  it('прочитанное в другом месте (открыли чат) уходит из стопки', () => {
    pushNotice({ kind: 'chat', title: 'Лемур', body: 'привет' });
    pushNotice({ title: 'событие' });
    markRead('chat');
    expect(labels()).toEqual(['событие']);
    clearNotices();
    expect(stackCount()).toBe(0);
  });

  it('щелчок по карточке — её действие, кнопка действия — своё; уведомление прочитано', () => {
    const onClick = vi.fn();
    const run = vi.fn();
    pushNotice({ title: 'щёлкни', onClick });
    fire(front(), 'click');
    expect(onClick).toHaveBeenCalledOnce();
    expect(stackCount()).toBe(0);
    expect(unreadCount()).toBe(0);
    pushNotice({ title: 'с кнопкой', action: { label: 'Перейти', run } });
    (front().querySelector('.ns-action') as HTMLButtonElement).click();
    expect(run).toHaveBeenCalledOnce();
    expect(stackCount()).toBe(0);
  });

  it('чужие данные — только текстом; неизвестный значок — колокольчик; фото — только проверенное', () => {
    pushNotice({ title: '<img src=x onerror="alert(1)">', body: '<b>жирный</b>', icon: 'нет-такого' as NoticeIcon });
    const card = front();
    expect(card.querySelector('img, b, script')).toBeNull();
    expect(card.querySelector('.ns-title')!.textContent).toBe('<img src=x onerror="alert(1)">');
    expect(card.querySelector('.ns-square svg')).not.toBeNull();
    pushNotice({ title: 'Лемур', body: 'x', user: { name: '<i>Лемур</i>', cursorId: '"><script>', avatar: 'javascript:alert(1)' } });
    expect(front().querySelector('img, script, i')).toBeNull();
    expect(front().querySelector('.ua-cursor svg')).not.toBeNull();
    const photo = 'data:image/png;base64,iVBORw0KGgo=';
    pushNotice({ title: 'Мария', body: 'y', user: { name: 'Мария', avatar: photo } });
    expect(front().querySelector<HTMLImageElement>('.ua-circle img')!.getAttribute('src')).toBe(photo);
  });

  it('смахивание: дальше 100 px — убрано и прочитано; ближе и медленно — возвращается', () => {
    pushNotice({ title: 'смахни' });
    const card = front();
    fire(card, 'pointerdown', { button: 0, clientX: 100, clientY: 10 });
    fire(window, 'pointermove', { clientX: 160, clientY: 12 });
    expect(card.style.transform).toContain('translate3d(60.00px');
    fire(window, 'pointerup', { clientX: 160, clientY: 12 });
    expect(stackCount()).toBe(1);
    expect(card.style.transform).toContain('translate3d(0.00px');
    fire(card, 'pointerdown', { button: 0, clientX: 100, clientY: 10 });
    fire(window, 'pointermove', { clientX: 230, clientY: 10 });
    fire(window, 'pointerup', { clientX: 230, clientY: 10 });
    expect(stackCount()).toBe(0);
    expect(unreadCount()).toBe(0);
    // вертикальное движение — не смахивание
    pushNotice({ title: 'вертикаль' });
    fire(front(), 'pointerdown', { button: 0, clientX: 100, clientY: 10 });
    fire(window, 'pointermove', { clientX: 103, clientY: 60 });
    fire(window, 'pointermove', { clientX: 250, clientY: 60 });
    fire(window, 'pointerup', { clientX: 250, clientY: 60 });
    expect(stackCount()).toBe(1);
  });

  it('щелчок по кнопке без чата раскрывает стопку и держит её; повторный — убирает в кнопку', () => {
    pushNotice({ title: 'а' });
    pushNotice({ title: 'б' });
    vi.advanceTimersByTime(STACK_IDLE_MS);
    btn().click();
    expect(stackShown()).toBe(true);
    expect(stack().classList.contains('expanded')).toBe(true);
    vi.advanceTimersByTime(STACK_IDLE_MS * 2);
    expect(stackShown()).toBe(true);
    btn().click();
    expect(stackShown()).toBe(false);
    expect(unreadCount()).toBe(2);
  });

  it('«Скрыть» и Esc убирают раскрытую стопку в кнопку', () => {
    pushNotice({ title: 'а' });
    pushNotice({ title: 'б' });
    enter(stack());
    (stack().querySelector('.ns-hide') as HTMLButtonElement).click();
    expect(stackShown()).toBe(false);
    enter(btn());
    expect(stackShown()).toBe(true);
    key(front(), 'Escape');
    expect(stackShown()).toBe(false);
  });

  it('clearNotifyStack убирает всё сразу, уведомления в центре остаются', () => {
    for (let i = 0; i < 3; i++) pushNotice({ title: `№${i}` });
    clearNotifyStack();
    expect(stackCount()).toBe(0);
    expect(stack().hidden).toBe(true);
    expect(unreadCount()).toBe(3);
    expect(notifyShownCount()).toBe(3);
  });
});

describe('стопка уведомлений: «Обычные» и «Улучшенные»', () => {
  afterEach(() => {
    clearNotifyStack();
    clearNotices();
    vi.useRealTimers();
    document.body.className = '';
  });

  it('«Обычные»: CSS-переходы, уход в кнопку — 300 мс', () => {
    vi.useFakeTimers();
    setup('no-motion');
    pushNotice({ title: 'а' });
    expect(stack().classList.contains('ns-css')).toBe(true);
    vi.advanceTimersByTime(STACK_IDLE_MS);
    // летит в кнопку: под шапкой, со сдвигом и уменьшением
    expect(stack().classList.contains('ns-under')).toBe(true);
    expect(stack().style.transform).toContain('scale(0.18');
    expect(notifyShownCount()).toBe(0);
    vi.advanceTimersByTime(300);
    expect(stack().hidden).toBe(true);
    expect(notifyShownCount()).toBe(1);
  });

  it('«Улучшенные»: новая карточка начинает падение сверху, прозрачной', () => {
    setup('');
    pushNotice({ title: 'а' });
    const card = front();
    expect(card.style.transform).toContain('translate3d(0.00px, -14.00px');
    expect(parseFloat(card.style.opacity)).toBe(0);
    expect(stackShown()).toBe(true);
  });
});
