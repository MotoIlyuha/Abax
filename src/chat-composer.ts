// Поле ввода чата режима ЧУ (SPEC_CHAT §6): textarea растёт до COMPOSER_MAX_ROWS строк, Enter — отправить,
// Shift+Enter — перенос строки, набор через IME (isComposing) не отправляет. Справа — круглая кнопка «Отправить»
// (активна при тексте или вложении), слева — слот .composer-tools для кнопок вложений (их ставит src/chat-attach.ts),
// над полем — чип вложения (setAttachmentChip). Под полем — подсказки (флуд, «Нет соединения») и счётчик символов
// после CHAT_COUNTER_FROM.

import { CHAT_MAX_LEN } from './room-chat';
import { CHAT_COUNTER_FROM, OFFLINE_HINT, RATE_HINT, type ChatSendResult } from './collab-chat';

/** До скольких строк растёт поле. */
export const COMPOSER_MAX_ROWS = 6;

/** Стрелка «отправить» — константа кода. */
const SEND_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5"/><path d="M6 11l6-6 6 6"/></svg>';

export interface ChatComposerOptions {
  /** Отправка текста (пустой — только если есть вложение); итог решает, что показать. */
  submit: (text: string) => ChatSendResult;
  /** Предел длины (по умолчанию — сообщения чата; комментарий длиннее, src/comments-ui.ts). */
  maxLength?: number;
  /** Подсказка в пустом поле и подпись для чтения с экрана. */
  placeholder?: string;
  label?: string;
}

export interface ChatComposer {
  readonly el: HTMLElement;
  readonly input: HTMLTextAreaElement;
  /** Слот слева для кнопок вложений. */
  readonly tools: HTMLElement;
  /** Чип вложения над полем (null — убрать); с чипом можно отправить без текста. */
  setAttachmentChip(chip: HTMLElement | null): void;
  /** Подсказка под полем (пусто — убрать). */
  setHint(text: string): void;
  focus(): void;
}

export function createChatComposer(o: ChatComposerOptions): ChatComposer {
  const root = document.createElement('div');
  root.className = 'composer';
  const chipSlot = document.createElement('div');
  chipSlot.className = 'composer-chip';
  chipSlot.hidden = true;
  const row = document.createElement('div');
  row.className = 'composer-row';
  const tools = document.createElement('div');
  tools.className = 'composer-tools';
  const input = document.createElement('textarea');
  input.className = 'composer-input';
  input.rows = 1;
  const max = o.maxLength ?? CHAT_MAX_LEN;
  input.maxLength = max;
  input.placeholder = o.placeholder ?? 'Сообщение';
  input.title = 'Enter - отправить, Shift+Enter - новая строка';
  input.setAttribute('aria-label', o.label ?? 'Сообщение в чат');
  const send = document.createElement('button');
  send.type = 'button';
  send.className = 'composer-send';
  send.title = 'Отправить (Enter)';
  send.setAttribute('aria-label', 'Отправить');
  send.innerHTML = SEND_ICON; // константа кода
  row.append(tools, input, send);
  const foot = document.createElement('div');
  foot.className = 'composer-foot';
  const hint = document.createElement('span');
  hint.className = 'composer-hint';
  hint.setAttribute('role', 'status');
  const count = document.createElement('span');
  count.className = 'composer-count';
  foot.append(hint, count);
  root.append(chipSlot, row, foot);

  let chip: HTMLElement | null = null;

  const setHint = (text: string) => {
    hint.textContent = text;
    foot.classList.toggle('on', !!text || !!count.textContent);
  };

  /** Высота поля по содержимому, не выше COMPOSER_MAX_ROWS строк. */
  const grow = () => {
    input.style.height = 'auto';
    const sh = input.scrollHeight;
    if (!sh) { input.style.removeProperty('height'); return; }
    const cs = getComputedStyle(input);
    const line = parseFloat(cs.lineHeight) || 20;
    const pad = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    const max = line * COMPOSER_MAX_ROWS + pad;
    input.style.height = `${Math.min(sh, max)}px`;
    input.style.overflowY = sh > max ? 'auto' : 'hidden';
  };

  const sync = () => {
    const len = input.value.length;
    count.textContent = len > max - (CHAT_MAX_LEN - CHAT_COUNTER_FROM) ? `${len}/${max}` : '';
    send.disabled = input.value.trim() === '' && !chip;
    foot.classList.toggle('on', !!hint.textContent || !!count.textContent);
  };

  const submit = () => {
    const text = input.value;
    if (text.trim() === '' && !chip) return;
    const r = o.submit(text);
    if (r === 'ok') {
      input.value = '';
      setHint('');
      api.setAttachmentChip(null);
      sync();
      grow();
    } else if (r === 'rate') setHint(RATE_HINT);
    else if (r === 'offline') setHint(OFFLINE_HINT);
  };

  input.addEventListener('keydown', ev => {
    if (ev.key !== 'Enter' || ev.shiftKey) return;
    // набор через IME: Enter подтверждает слово, а не отправляет
    if (ev.isComposing || ev.keyCode === 229) return;
    ev.preventDefault();
    submit();
  });
  input.addEventListener('input', () => { sync(); grow(); if (hint.textContent) setHint(''); });
  send.addEventListener('click', () => { submit(); input.focus(); });

  const api: ChatComposer = {
    el: root,
    input,
    tools,
    setAttachmentChip(next) {
      chip = next;
      chipSlot.textContent = '';
      if (next) chipSlot.append(next);
      chipSlot.hidden = !next;
      sync();
    },
    setHint,
    focus() { input.focus({ preventScroll: true }); },
  };
  sync();
  return api;
}
