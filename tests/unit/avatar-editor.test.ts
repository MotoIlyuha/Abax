// Выбор аватара (src/avatar-editor.ts), кнопка смайла (src/icon-button.ts), аватар в выборе курсора
// и отрисовка круга (src/avatar.ts): буквы по умолчанию, смайл, фото.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createUserAvatar, updateUserAvatar } from '../../src/avatar';
import { createAvatarEditor } from '../../src/avatar-editor';
import { createCursorPicker } from '../../src/cursor-picker';
import { closeIconPicker, iconPickerOpen } from '../../src/icon-picker';
import { createIconButton, paintIcon } from '../../src/icon-button';
import { closeOnboardingForTests, openOnboarding } from '../../src/onboarding';
import { getProfile, resetProfileForTests } from '../../src/profile';
import { resetProfileSyncForTests } from '../../src/profile-sync';
import { clearServerPlan } from '../../src/plan';

const PHOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';

async function until<T>(fn: () => T | undefined | null | false, ms = 4000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('условие не выполнилось за отведённое время');
    await new Promise(r => setTimeout(r, 10));
  }
}

beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  clearServerPlan();
  resetProfileForTests();
  resetProfileSyncForTests();
});
afterEach(() => {
  closeIconPicker(true);
  closeOnboardingForTests();
});

describe('круг аватара', () => {
  it('буквы, смайл и фото; узлы круга не пересоздаются без изменений', () => {
    const b = createUserAvatar({ name: 'Анна Петрова', bg: '#000', fg: '#fff', status: 'online' });
    const circle = b.querySelector<HTMLElement>('.ua-circle')!;
    expect(circle.textContent).toBe('АП');
    updateUserAvatar(b, { name: 'Анна Петрова', bg: '#000', fg: '#fff', status: 'online', avatar: '🦊' });
    expect(circle.textContent).toBe('🦊');
    expect(circle.classList.contains('ua-emoji')).toBe(true);
    updateUserAvatar(b, { name: 'Анна Петрова', bg: '#000', fg: '#fff', status: 'online', avatar: PHOTO });
    const img = circle.querySelector('img')!;
    expect(img.getAttribute('src')).toBe(PHOTO);
    expect(circle.classList.contains('ua-photo')).toBe(true);
    updateUserAvatar(b, { name: 'Анна Петрова', bg: '#111', fg: '#fff', status: 'away', avatar: PHOTO });
    expect(circle.querySelector('img')).toBe(img);
    // чужое значение (не смайл и не фото) — буквы
    updateUserAvatar(b, { name: 'Анна Петрова', bg: '#000', fg: '#fff', status: 'online', avatar: 'javascript:alert(1)' });
    expect(circle.textContent).toBe('АП');
    expect(circle.querySelector('img')).toBeNull();
  });
});

describe('кнопка смайла', () => {
  it('пусто - значок приглашения, выбранное - на кнопке; клик открывает окно выбора', () => {
    const host = document.createElement('div');
    paintIcon(host, null);
    expect(host.classList.contains('empty')).toBe(true);
    expect(host.querySelector('svg')).not.toBeNull();
    paintIcon(host, '🚀');
    expect(host.textContent).toBe('🚀');
    const btn = createIconButton({ className: 'project-icon badge', value: null, title: v => (v ? 'Сменить' : 'Добавить'), onPick: () => {} });
    document.body.appendChild(btn.el);
    expect(btn.el.title).toBe('Добавить');
    btn.set('🚀');
    expect(btn.el.title).toBe('Сменить');
    expect(btn.el.textContent).toBe('🚀');
    btn.el.click();
    expect(iconPickerOpen()).toBe(true);
    expect(document.querySelector('#icon-picker .ip-upload')).not.toBeNull();
  });
});

describe('выбор аватара', () => {
  it('по умолчанию буквы и «Установить фото»; с фото - «Удалить фото», удаление возвращает буквы', () => {
    const seen: (string | null)[] = [];
    const ed = createAvatarEditor({ value: null, name: 'Бодрый Енот', cursorId: 'mint', onChange: v => seen.push(v) });
    document.body.appendChild(ed.el);
    const circle = ed.el.querySelector<HTMLElement>('.ua-circle')!;
    const photoBtn = ed.el.querySelector<HTMLButtonElement>('.ae-photo')!;
    expect(circle.textContent).toBe('БЕ');
    expect(photoBtn.textContent).toBe('Установить фото');
    // кнопка смайла — та же, что у иконки проекта, в углу круга; окно — без «Загрузить»
    const emoji = ed.el.querySelector<HTMLButtonElement>('.ae-face > .project-icon.ae-emoji')!;
    expect(emoji.title).toBe('Смайл вместо букв');
    emoji.click();
    expect(document.querySelector('#icon-picker')!.getAttribute('aria-label')).toBe('Смайл аватара');
    expect(document.querySelector('#icon-picker .ip-upload')).toBeNull();
    closeIconPicker(true);
    ed.setValue(PHOTO);
    expect(photoBtn.textContent).toBe('Удалить фото');
    expect(circle.querySelector('img')).not.toBeNull();
    photoBtn.click();
    expect(seen).toEqual([null]);
    expect(ed.value()).toBeNull();
    expect(photoBtn.textContent).toBe('Установить фото');
    expect(circle.textContent).toBe('БЕ');
    // «Установить фото» открывает системный выбор файла
    const input = ed.el.querySelector<HTMLInputElement>('input[type="file"]')!;
    let opened = false;
    input.click = () => { opened = true; };
    photoBtn.click();
    expect(opened).toBe(true);
    expect(input.accept).toBe('image/*');
    ed.setName('Капибара');
    expect(circle.textContent).toBe('К');
    ed.dispose();
  });

  it('смайл из окна выбора ставится вместо букв, «Убрать» возвращает буквы', async () => {
    const seen: (string | null)[] = [];
    const ed = createAvatarEditor({ value: null, name: 'Аня', cursorId: 'default', onChange: v => seen.push(v) });
    document.body.appendChild(ed.el);
    const emoji = ed.el.querySelector<HTMLButtonElement>('.ae-emoji')!;
    emoji.click();
    const first = await until(() => document.querySelector<HTMLButtonElement>('#icon-picker .ip-emoji'));
    const glyph = first.textContent!;
    first.click();
    expect(seen).toEqual([glyph]);
    expect(ed.el.querySelector('.ua-circle')!.textContent).toBe(glyph);
    expect(emoji.title).toBe('Сменить смайл');
    // кнопка — всегда значок приглашения (смайл уже в круге)
    expect(emoji.querySelector('svg')).not.toBeNull();
    emoji.click();
    const remove = await until(() => document.querySelector<HTMLButtonElement>('#icon-picker .ip-remove'));
    expect(remove.title).toBe('Вернуть буквы имени');
    remove.click();
    expect(seen).toEqual([glyph, null]);
    expect(ed.el.querySelector('.ua-circle')!.textContent).toBe('А');
  });
});

describe('аватар в выборе курсора', () => {
  it('в правом верхнем углу - мой аватар с курсором и подсказкой «Это ваш аватар»', () => {
    const picker = createCursorPicker({ choice: { saved: 'mint', preview: 'mint' }, entitled: false, name: 'Аня', avatar: null, onChange: () => {} });
    document.body.appendChild(picker.el);
    const face = picker.el.querySelector<HTMLElement>('.cp-preview > .user-avatar.cp-face')!;
    expect(face.title).toBe('Это ваш аватар');
    expect(face.querySelector('.ua-circle')!.textContent).toBe('А');
    expect(face.querySelector('.ua-cursor svg')).not.toBeNull();
    picker.setAvatar('🐼');
    expect(face.querySelector('.ua-circle')!.textContent).toBe('🐼');
    picker.setName('Борис');
    picker.setAvatar(null);
    expect(face.querySelector('.ua-circle')!.textContent).toBe('Б');
    picker.dispose();
  });
});

describe('знакомство', () => {
  it('на шаге 2 - аватар слева от имени; выбранный смайл сохраняется в профиль', async () => {
    openOnboarding({ step: 2 });
    const ed = document.querySelector<HTMLElement>('#onboarding .ob-identity > .ae')!;
    expect(ed).not.toBeNull();
    expect(ed.querySelector('.ae-photo')!.textContent).toBe('Установить фото');
    expect(document.querySelector('#onboarding .cp-face')).not.toBeNull();
    ed.querySelector<HTMLButtonElement>('.ae-emoji')!.click();
    const picker = await until(() => document.querySelector<HTMLElement>('#icon-picker'));
    expect(picker.classList.contains('ip-over-dialog')).toBe(true);
    const first = await until(() => document.querySelector<HTMLButtonElement>('#icon-picker .ip-emoji'));
    const glyph = first.textContent!;
    first.click();
    expect(document.querySelector('#onboarding .cp-face .ua-circle')!.textContent).toBe(glyph);
    document.querySelector<HTMLButtonElement>('#onboarding .ob-continue')!.click();
    expect(getProfile()).toMatchObject({ avatar: glyph, onboarded: true });
  });
});
