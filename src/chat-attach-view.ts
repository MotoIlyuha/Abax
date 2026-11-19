// Вложение сообщения чата в ленте (SPEC_CHAT §7). Пока — плашка-заглушка с подписью; превью картинки и объектов,
// просмотр, «Показать» и «Вставить копию» добавит следующий шаг (вложения в клиенте) на месте этой функции.
// Название страницы приходит от участника — только textContent; SVG — константы каталога иконок.

import { NOTICE_ICONS } from './icons';
import type { ChatMessage } from './room-chat';

/** Склонение «объект»: 1 объект, 2 объекта, 5 объектов. */
export function objectsLabel(n: number): string {
  const k = Math.abs(n) % 100;
  const d = k % 10;
  const word = k >= 11 && k <= 14 ? 'объектов' : d === 1 ? 'объект' : d >= 2 && d <= 4 ? 'объекта' : 'объектов';
  return `${n} ${word}`;
}

/** Подпись вложения одной строкой. */
export function attachmentLabel(m: Pick<ChatMessage, 'att'>): string {
  const a = m.att;
  if (!a) return '';
  if (a.kind === 'image') return 'Изображение';
  if (a.kind === 'board') return `${objectsLabel(a.count)} · «${a.pageName}»`;
  if (a.kind === 'gone') return 'Вложение больше недоступно';
  return 'Объекты со страницы, которая вам недоступна';
}

/** Плашка вложения или null, если вложения нет. */
export function renderAttachment(m: Pick<ChatMessage, 'att'>): HTMLElement | null {
  const a = m.att;
  if (!a) return null;
  const box = document.createElement('div');
  box.className = `cf-att cf-att-${a.kind}`;
  const icon = document.createElement('span');
  icon.className = 'cf-att-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = a.kind === 'image' || (a.kind === 'gone' && a.was === 'image') ? NOTICE_ICONS.image
    : a.kind === 'hidden' ? NOTICE_ICONS.hidden : NOTICE_ICONS.board; // константы каталога иконок
  const text = document.createElement('span');
  text.className = 'cf-att-text';
  text.textContent = attachmentLabel(m);
  box.append(icon, text);
  return box;
}
