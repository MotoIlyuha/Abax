import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createChatComposer, type ChatComposer } from '../../src/chat-composer';
import type { ChatSendResult } from '../../src/collab-chat';

describe('поле ввода чата', () => {
  let c: ChatComposer;
  let result: ChatSendResult;
  let sent: string[];
  const send = () => c.el.querySelector<HTMLButtonElement>('.composer-send')!;
  const hint = () => c.el.querySelector('.composer-hint')!.textContent;
  const type = (v: string) => { c.input.value = v; c.input.dispatchEvent(new Event('input')); };
  const enter = (init: KeyboardEventInit = {}) => {
    const e = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...init });
    c.input.dispatchEvent(e);
    return e;
  };

  beforeEach(() => {
    sent = [];
    result = 'ok';
    c = createChatComposer({ submit: t => { sent.push(t); return result; } });
    document.body.append(c.el);
  });
  afterEach(() => c.el.remove());

  it('разметка: поле с maxlength 500, круглая кнопка «Отправить», пустой слот вложений', () => {
    expect(c.input.maxLength).toBe(500);
    expect(c.input.getAttribute('aria-label')).toBe('Сообщение в чат');
    expect(send().getAttribute('aria-label')).toBe('Отправить');
    expect(send().querySelector('svg')).not.toBeNull();
    expect(c.tools.classList.contains('composer-tools')).toBe(true);
    expect(c.tools.childElementCount).toBe(0);
  });

  it('кнопка активна при тексте или вложении', () => {
    expect(send().disabled).toBe(true);
    type('   ');
    expect(send().disabled).toBe(true);
    type('привет');
    expect(send().disabled).toBe(false);
    type('');
    const chip = document.createElement('span');
    chip.textContent = 'картинка';
    c.setAttachmentChip(chip);
    expect(send().disabled).toBe(false);
    expect(c.el.querySelector<HTMLElement>('.composer-chip')!.hidden).toBe(false);
    c.setAttachmentChip(null);
    expect(send().disabled).toBe(true);
    expect(c.el.querySelector<HTMLElement>('.composer-chip')!.hidden).toBe(true);
  });

  it('Enter отправляет и очищает; Shift+Enter - перенос; пустое не уходит', () => {
    type('   ');
    enter();
    expect(sent).toEqual([]);
    type('строка');
    const shift = enter({ shiftKey: true });
    expect(shift.defaultPrevented).toBe(false);
    expect(sent).toEqual([]);
    const e = enter();
    expect(e.defaultPrevented).toBe(true);
    expect(sent).toEqual(['строка']);
    expect(c.input.value).toBe('');
    expect(send().disabled).toBe(true);
  });

  it('набор через IME не отправляет', () => {
    type('にほん');
    enter({ isComposing: true });
    enter({ keyCode: 229 } as KeyboardEventInit);
    expect(sent).toEqual([]);
  });

  it('с вложением можно отправить без текста; после отправки чип убирается', () => {
    c.setAttachmentChip(document.createElement('span'));
    send().click();
    expect(sent).toEqual(['']);
    expect(c.el.querySelector<HTMLElement>('.composer-chip')!.hidden).toBe(true);
  });

  it('флуд - подсказка, текст остаётся; ввод убирает подсказку', () => {
    result = 'rate';
    type('m5');
    enter();
    expect(hint()).toMatch(/Не так быстро/);
    expect(c.input.value).toBe('m5');
    type('m5!');
    expect(hint()).toBe('');
  });

  it('нет соединения - подсказка, текст остаётся', () => {
    result = 'offline';
    type('привет');
    send().click();
    expect(hint()).toBe('Нет соединения с доской');
    expect(c.input.value).toBe('привет');
  });

  it('счётчик символов - после 400', () => {
    type('я'.repeat(400));
    expect(c.el.querySelector('.composer-count')!.textContent).toBe('');
    type('я'.repeat(401));
    expect(c.el.querySelector('.composer-count')!.textContent).toBe('401/500');
    expect(c.el.querySelector('.composer-foot')!.classList.contains('on')).toBe(true);
  });
});
