import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  NOTIFY_MODE, NOTIFY_OFF_TEXT, NOTIFY_QUIET_TEXT, NOTIFY_TAB_KEY, mountNotifyPanel, notifyTab, revealChatMessage, revealCommentCard,
  setNotifyTab,
} from '../../src/notify-panel';
import {
  chatOpen, chatReceive, chatReset, setChatAvailable, setChatCanWrite, setChatSender,
} from '../../src/collab-chat';
import { clearNotices, doNotDisturb, notices, pushNotice, setDoNotDisturb, unreadCount } from '../../src/notify-center';
import { addElement, blankProject, openProject, state } from '../../src/state';
import { createCommentThread } from '../../src/comments';
import type { ShapeEl } from '../../src/types';
import type { PanelView } from '../../src/panel-types';

const T = Date.now() - 60_000;
const msg = (id: string, by: number, text: string, ts = T) => ({ id, by, name: `У${by}`, text, ts });
const $ = <E extends Element = HTMLElement>(sel: string) => document.querySelector<E>(sel);
const countOf = (tab: string) => $(`#np-tab-${tab} .tp-count`)!.classList.contains('on')
  ? $(`#np-tab-${tab} .tp-count .roll-line:not(.roll-leaving) .roll-text`)!.textContent : '';

describe('режим «Чат и уведомления»', () => {
  let host: HTMLElement;
  let v: PanelView;
  beforeEach(() => {
    document.body.className = 'no-motion no-ui-anim';
    document.body.innerHTML = '<button id="btn-share"></button><div id="host"></div>';
    host = $('#host')!;
    setNotifyTab('all');
    v = mountNotifyPanel(host);
  });
  afterEach(() => {
    v.hide?.();
    setChatAvailable(false);
    setChatCanWrite(true);
    setChatSender(null);
    clearNotices();
    setDoNotDisturb(false);
    localStorage.clear();
    state.collabRole = null;
    document.body.className = '';
  });

  it('описание режима и действия шапки', () => {
    expect(NOTIFY_MODE).toMatchObject({ id: 'notify', label: 'Чат и уведомления' });
    expect(v.actions!.querySelector('.np-dnd')).not.toBeNull();
    expect(v.actions!.querySelector('.np-read-all')!.getAttribute('aria-label')).toBe('Прочитать всё');
    expect([...host.querySelectorAll('[role="tab"]')].map(t => t.querySelector('.tp-label')!.textContent)).toEqual(['Все', 'Чат', 'Комментарии', 'Уведомления']);
  });

  it('вкладка запоминается в doska.notifyTab', () => {
    setNotifyTab('notices');
    expect(notifyTab()).toBe('notices');
    expect(localStorage.getItem(NOTIFY_TAB_KEY)).toBe('notices');
    expect($('#np-tab-notices')!.getAttribute('aria-selected')).toBe('true');
    expect($('#np-view-notices')!.hidden).toBe(false);
    expect($('#np-view-all')!.hidden).toBe(true);
  });

  it('счётчики вкладок: «Чат» - непрочитанные чата, «Уведомления» - системные', () => {
    setChatAvailable(true);
    chatReset([], 1);
    chatReceive(msg('a', 2, 'привет'));
    chatReceive(msg('b', 2, 'ещё'));
    pushNotice({ title: 'событие' });
    expect(countOf('chat')).toBe('2');
    expect(countOf('notices')).toBe('1');
    expect($('#np-tab-all .tp-count')!.classList.contains('on')).toBe(false);
  });

  it('правила прочтения: скрыт - ничего; «Чат» - чат; «Уведомления» - системные; «Все» - всё', () => {
    setChatAvailable(true);
    chatReset([], 1);
    chatReceive(msg('a', 2, 'привет'));
    pushNotice({ title: 'событие' });
    expect(unreadCount()).toBe(2);
    setNotifyTab('chat');
    expect(unreadCount()).toBe(2); // вид не показан
    v.show!();
    expect(chatOpen()).toBe(true);
    expect(unreadCount('chat')).toBe(0);
    expect(unreadCount('system')).toBe(1);
    setNotifyTab('notices');
    expect(chatOpen()).toBe(false);
    expect(unreadCount()).toBe(0);
    // новое при открытой вкладке «Уведомления»: системное прочитано, сообщение — нет
    chatReceive(msg('b', 2, 'новое'));
    pushNotice({ title: 'ещё событие' });
    expect(unreadCount('system')).toBe(0);
    expect(unreadCount('chat')).toBe(1);
    setNotifyTab('all');
    expect(unreadCount()).toBe(0);
    pushNotice({ title: 'при «Все»' });
    expect(unreadCount()).toBe(0);
    v.hide!();
    expect(chatOpen()).toBe(false);
    pushNotice({ title: 'скрыт' });
    expect(unreadCount()).toBe(1);
  });

  it('«Прочитать всё» и её доступность', () => {
    const btn = v.actions!.querySelector<HTMLButtonElement>('.np-read-all')!;
    expect(btn.disabled).toBe(true);
    pushNotice({ title: 'событие' });
    expect(btn.disabled).toBe(false);
    btn.click();
    expect(unreadCount()).toBe(0);
    expect(btn.disabled).toBe(true);
  });

  it('«Не беспокоить»: aria-pressed, подсказка, полумесяц', () => {
    const dnd = v.actions!.querySelector<HTMLButtonElement>('.np-dnd')!;
    expect(dnd.getAttribute('aria-pressed')).toBe('false');
    expect(dnd.getAttribute('aria-label')).toBe('Не беспокоить');
    expect(dnd.querySelector('.np-moon svg')).not.toBeNull();
    dnd.click();
    expect(doNotDisturb()).toBe(true);
    expect(dnd.getAttribute('aria-pressed')).toBe('true');
    expect(dnd.title).toMatch(/включено/);
    setDoNotDisturb(false);
    expect(dnd.getAttribute('aria-pressed')).toBe('false');
  });

  it('«Все»: сообщения и события по времени, линия «Новые» над первым непрочитанным', () => {
    setChatAvailable(true);
    chatReset([msg('a', 2, 'старое', T - 1000)], 1);
    pushNotice({ title: 'Лемур', body: 'присоединился к доске', user: { name: 'Лемур' }, ts: T });
    chatReceive(msg('b', 2, 'новое', T + 1000));
    v.show!();
    const list = $('#np-view-all .cf-list')!;
    const kinds = [...list.children].map(c => c.className.split(' ')[0]);
    expect(kinds).toEqual(['cf-day', 'cf-group', 'cf-new', 'cf-event', 'cf-group']);
    expect(list.querySelector('.cf-ev-text')!.textContent).toBe('Лемур присоединился к доске');
    // при следующем открытии непрочитанных нет — линии нет
    v.hide!();
    v.show!();
    expect($('#np-view-all .cf-new')).toBeNull();
  });

  it('новое сообщение при открытой вкладке «Чат» дописывается в ленту', () => {
    setChatAvailable(true);
    chatReset([], 1);
    setNotifyTab('chat');
    v.show!();
    chatReceive(msg('a', 2, 'привет'));
    expect(host.querySelectorAll('#np-view-chat .cf-msg')).toHaveLength(1);
    expect(notices().filter(n => n.kind === 'chat')).toHaveLength(0);
  });

  it('поле ввода отправляет через слой данных; фокус - в поле', () => {
    const sent: string[] = [];
    setChatAvailable(true);
    setChatSender(t => { sent.push(t); return true; });
    chatReset([], 1);
    v.show!();
    const input = host.querySelector<HTMLTextAreaElement>('.composer-input')!;
    v.focus!();
    expect(document.activeElement).toBe(input);
    input.value = 'привет';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(sent).toEqual(['привет']);
  });

  it('читатель: «Читатели не пишут в чат», поля нет', () => {
    setChatAvailable(true);
    chatReset([], 1);
    setChatCanWrite(false);
    v.show!();
    expect(host.querySelector('.composer-input')).toBeNull();
    expect(host.querySelector('.np-reader')!.textContent).toBe('Читатели не пишут в чат');
    setChatCanWrite(true);
    expect(host.querySelector('.composer-input')).not.toBeNull();
  });

  it('без совместной работы: пустое состояние и «Поделиться» у автора', () => {
    setNotifyTab('chat');
    v.show!();
    const view = $('#np-view-chat')!;
    expect(view.querySelector('.np-empty-text')!.textContent).toBe(NOTIFY_OFF_TEXT);
    expect(host.querySelector('.composer-input')).toBeNull();
    const share = vi.fn();
    $('#btn-share')!.addEventListener('click', share);
    view.querySelector<HTMLButtonElement>('.np-share')!.click();
    expect(share).toHaveBeenCalledOnce();
  });

  it('без совместной работы: гость или без кнопки «Поделиться» - без кнопки', () => {
    state.collabRole = 'guest';
    setChatAvailable(false); // перерисовка пустых состояний
    expect($('#np-view-chat .np-share')).toBeNull();
    state.collabRole = null;
    $('#btn-share')!.remove();
    setChatAvailable(false);
    expect($('#np-view-chat .np-share')).toBeNull();
  });

  it('«Уведомления»: карточки по дням, точка у непрочитанных, «Очистить», пусто', () => {
    setNotifyTab('notices');
    v.show!();
    expect($('#np-view-notices .np-empty-text')!.textContent).toBe(NOTIFY_QUIET_TEXT);
    v.hide!();
    pushNotice({ title: '<b>Лемур</b>', body: 'присоединился к доске', icon: 'join', user: { name: '<b>Лемур</b>', cursorId: 'mint' } });
    pushNotice({ title: 'Связь потеряна', level: 'warn', icon: 'offline' });
    pushNotice({ kind: 'chat', title: 'Чат', body: 'не здесь' });
    v.show!();
    const cards = [...host.querySelectorAll<HTMLElement>('.np-card')];
    expect(cards).toHaveLength(2);
    expect(cards[0].querySelector('.ns-title')!.textContent).toBe('Связь потеряна'); // новые сверху
    expect(cards[0].classList.contains('ns-warn')).toBe(true);
    expect(cards[1].querySelector('b')).toBeNull();
    expect(cards[1].querySelector('.ns-avatar')).not.toBeNull();
    // показ пометил прочитанными, но точка держится, пока вкладка открыта
    expect(unreadCount('system')).toBe(0);
    expect(cards.every(c => c.querySelector('.np-dot'))).toBe(true);
    expect(host.querySelector('.np-day')!.textContent).toBe('Сегодня');
    expect($('#np-view-notices .np-empty')!.hidden).toBe(true);
    host.querySelector<HTMLButtonElement>('.np-clear')!.click();
    expect(notices().filter(n => n.kind === 'system')).toHaveLength(0);
    expect(notices().filter(n => n.kind === 'chat')).toHaveLength(1);
    expect(host.querySelectorAll('.np-card')).toHaveLength(0);
    expect($('#np-view-notices .np-empty')!.hidden).toBe(false);
  });

  it('карточка с действием: действие выполняется, уведомление прочитано', () => {
    const run = vi.fn();
    pushNotice({ title: 'Доступ', action: { label: 'Перейти', run } });
    setNotifyTab('notices');
    v.show!();
    host.querySelector<HTMLButtonElement>('.ns-action')!.click();
    expect(run).toHaveBeenCalledOnce();
  });

  it('revealChatMessage: с «Уведомлений» - на «Чат», подсветка сообщения', () => {
    setChatAvailable(true);
    chatReset([msg('a', 2, 'раз'), msg('b', 2, 'два')], 1);
    setNotifyTab('notices');
    v.show!();
    revealChatMessage('b');
    expect(notifyTab()).toBe('chat');
    expect($('#np-view-chat [data-id="b"]')!.classList.contains('cf-flash')).toBe(true);
  });

  it('revealChatMessage до показа - выполняется при показе', () => {
    setChatAvailable(true);
    chatReset([msg('a', 2, 'раз')], 1);
    revealChatMessage('a');
    expect(notifyTab()).toBe('all'); // на «Все» сообщение тоже видно
    v.show!();
    expect($('#np-view-all [data-id="a"]')!.classList.contains('cf-flash')).toBe(true);
  });

  describe('вкладка «Комментарии»', () => {
    const rect = (id: string, extra: Partial<ShapeEl> = {}): ShapeEl =>
      ({ id, type: 'shape', shape: 'rect', x: 0, y: 0, w: 10, h: 10, color: '#000', width: 1, ...extra });
    beforeEach(() => {
      openProject(blankProject('Тест'));
      state.view = 'board';
      addElement(rect('a', { text: 'Задача' }));
      addElement(rect('b', { reactions: { '👍': ['u1'] } }));
      addElement(rect('c'));
    });

    it('карточки обсуждений и объектов с реакциями; свежее обсуждение выше; поля ввода нет', () => {
      const page = createCommentThread(state.board, { x: 0, y: 0, targetElementId: 'a', authorId: 'u1', authorName: '<b>Маша</b>', text: 'старое', now: 1000 });
      state.board.comments = [...page.comments!, {
        id: 'legacy', x: 5, y: 5,
        messages: [{ id: 'legacy-msg', authorId: 'u2', authorName: 'Вова', text: 'без объекта', createdAt: 2000 }],
      }];
      setNotifyTab('comments');
      v.show?.();
      const cards = [...host.querySelectorAll<HTMLElement>('.cm-card')];
      expect(cards.map(c => c.querySelector('.cm-label')!.textContent)).toEqual(['Комментарий на доске', 'Фигура «Задача»', 'Фигура']);
      expect(cards[1].querySelector('.cm-author')!.textContent).toBe('<b>Маша</b>');
      expect(host.querySelector('.cm-list b')).toBeNull();
      expect(cards[2].querySelector('.cm-pill')!.textContent).toBe('👍1');
      expect($('.np-compose')!.hidden).toBe(true);
    });

    it('пусто - подсказка; уведомление о комментарии - счётчик вкладки и точка на карточке, просмотр - прочитано', () => {
      openProject(blankProject('Пусто'));
      state.view = 'board';
      setNotifyTab('comments');
      v.show?.();
      expect($('.cm-empty')!.hidden).toBe(false);
      expect($('.cm-empty')!.textContent).toContain('Комментариев пока нет');
      v.hide?.();
      addElement(rect('a', { text: 'Задача' }));
      state.board.comments = createCommentThread(state.board, { x: 0, y: 0, targetElementId: 'a', authorId: 'u1', authorName: 'Маша', text: 'т' }).comments;
      pushNotice({ kind: 'comment', title: 'Маша', body: 'т', ref: { pageId: state.pageId, elId: 'a' } });
      expect(countOf('comments')).toBe('1');
      expect(unreadCount('comment')).toBe(1);
      v.show?.();
      expect(unreadCount('comment')).toBe(0);
      expect(host.querySelector('.cm-card.unread .cm-label')!.textContent).toBe('Фигура «Задача»');
    });

    it('revealCommentCard: вкладка «Комментарии» и подсветка карточки', () => {
      v.show?.();
      revealCommentCard({ pageId: state.pageId, elId: 'b' });
      expect(notifyTab()).toBe('comments');
      expect(host.querySelector('.cm-card.cm-flash .cm-label')!.textContent).toBe('Фигура');
    });

    it('«Все»: события комментариев в общей ленте', () => {
      v.show?.();
      pushNotice({ kind: 'comment', title: 'Маша', body: 'Фигура: привет', ref: { pageId: state.pageId, elId: 'a' } });
      expect(host.querySelector('#np-view-all .cf-event .cf-ev-text')!.textContent).toBe('Маша · Фигура: привет');
    });
  });
});

