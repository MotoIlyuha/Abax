// Предложение обновиться: при запуске (раз в сутки) спрашиваем GitHub о последнем релизе и,
// если он новее, показываем карточку «Вышла Abax X» со ссылкой на файл для своей платформы.
// В разделе «О проекте» — проверка вручную и выключатель автопроверки.

import { svg } from './toolbar';
import { dayLabel } from './format';
import { doskaApi } from './storage';
import { isNativeApp } from './native';
import {
  autoCheckDue, boldParts, fetchUpdate, setUpdatePrefs, shouldNotify, updatePrefs,
  type UpdateInfo, type UpdatePlatform,
} from './updates';

/** Проверка — не сразу при запуске: сначала пусть откроется доска. */
const START_DELAY_MS = 2000;

const UPDATE_ICON = svg('<circle cx="12" cy="12" r="9"/><path d="M12 7.5v8"/><path d="M8.5 12.5L12 16l3.5-3.5"/>');
const CLOSE_ICON = svg('<path d="M6 6l12 12M18 6L6 18"/>');

/** Что сделать со скачанным файлом — подсказка после «Скачать». */
const AFTER_DOWNLOAD: Partial<Record<UpdatePlatform, string>> = {
  'win-setup': 'Запустите скачанный установщик — он обновит Abax. Проекты и настройки сохранятся.',
  'win-portable': 'Запускайте теперь скачанный файл вместо этого. Проекты и настройки сохранятся.',
  android: 'Откройте скачанный файл, чтобы установить обновление. Проекты и настройки сохранятся.',
};

let platformCache: Promise<UpdatePlatform> | null = null;

/** Платформа: Android (Capacitor), Windows-установка или переносная версия (Electron), веб. */
export function detectPlatform(): Promise<UpdatePlatform> {
  platformCache ??= (async (): Promise<UpdatePlatform> => {
    if (isNativeApp()) return 'android';
    if (!doskaApi) return 'web';
    try {
      const info = await doskaApi.appInfo?.();
      if (info) return info.platform === 'win32' ? (info.portable ? 'win-portable' : 'win-setup') : 'desktop';
    } catch { /* старый preload — по userAgent */ }
    return /Windows/i.test(navigator.userAgent) ? 'win-setup' : 'desktop';
  })();
  return platformCache;
}

/** Запуск: проверить, если включено и сутки прошли. Ошибки — молча, попробуем в следующий раз. */
export function startUpdateChecks(): void {
  // у сервера разработки версия та же, что у последнего релиза, — нечего проверять
  if (import.meta.env.DEV || !autoCheckDue(updatePrefs())) return;
  window.setTimeout(() => {
    void (async () => {
      const platform = await detectPlatform();
      let info: UpdateInfo | null;
      try {
        info = await fetchUpdate(__APP_VERSION__, platform);
      } catch {
        return;
      }
      const prefs = setUpdatePrefs({ checkedAt: Date.now() });
      if (info && shouldNotify(info, prefs)) showUpdateCard(info, platform);
    })();
  }, START_DELAY_MS);
}

/** Текст с **жирным** — в элемент (без innerHTML: описание релиза приходит из сети). */
function richText(host: HTMLElement, s: string): void {
  for (const part of boldParts(s)) {
    if (part.bold) {
      const b = document.createElement('strong');
      b.textContent = part.text;
      host.appendChild(b);
    } else {
      host.append(part.text);
    }
  }
}

/** Ссылка на файл или страницу релиза: открывается в системном браузере (Electron, Android). */
function downloadLink(info: UpdateInfo, cls: string): HTMLAnchorElement {
  const a = document.createElement('a');
  a.className = cls;
  a.href = info.download;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.textContent = info.file ? 'Скачать' : 'Открыть релиз';
  a.title = info.file ?? 'Страница релиза на GitHub';
  return a;
}

export function closeUpdateCard(): void {
  document.getElementById('update-card')?.remove();
}

/** Карточка «Вышла Abax X»: что нового, «Скачать», «Позже», «Пропустить версию». */
export function showUpdateCard(info: UpdateInfo, platform: UpdatePlatform): void {
  closeUpdateCard();
  const card = document.createElement('div');
  card.id = 'update-card';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-labelledby', 'uc-title');

  const head = document.createElement('div');
  head.className = 'uc-head';
  const icon = document.createElement('span');
  icon.className = 'uc-icon';
  icon.innerHTML = UPDATE_ICON;
  const title = document.createElement('div');
  title.className = 'uc-title';
  title.id = 'uc-title';
  title.textContent = `Вышла Abax ${info.version}`;
  const close = document.createElement('button');
  close.className = 'uc-close';
  close.title = 'Напомнить позже';
  close.innerHTML = CLOSE_ICON;
  close.addEventListener('click', closeUpdateCard);
  head.append(icon, title, close);

  const sub = document.createElement('div');
  sub.className = 'uc-sub';
  sub.textContent = `У вас ${__APP_VERSION__}` + (info.publishedAt ? ` · выпущена ${dayLabel(info.publishedAt)}` : '');
  card.append(head, sub);

  if (info.notes.summary) {
    const p = document.createElement('p');
    p.className = 'uc-summary';
    richText(p, info.notes.summary);
    card.appendChild(p);
  }
  if (info.notes.items.length > 0) {
    const details = document.createElement('details');
    details.className = 'uc-notes';
    const summary = document.createElement('summary');
    summary.textContent = `Что нового (${info.notes.items.length})`;
    const list = document.createElement('ul');
    for (const item of info.notes.items) {
      const li = document.createElement('li');
      richText(li, item);
      list.appendChild(li);
    }
    details.append(summary, list);
    card.appendChild(details);
  }

  const hint = document.createElement('p');
  hint.className = 'uc-hint';
  hint.hidden = true;

  const actions = document.createElement('div');
  actions.className = 'uc-actions';
  const download = downloadLink(info, 'uc-download');
  download.addEventListener('click', () => {
    const text = info.file ? AFTER_DOWNLOAD[platform] : undefined;
    if (text) {
      hint.textContent = text;
      hint.hidden = false;
    } else {
      closeUpdateCard();
    }
  });
  const later = document.createElement('button');
  later.className = 'uc-later';
  later.textContent = 'Позже';
  later.title = 'Напомним при следующей проверке — через сутки';
  later.addEventListener('click', closeUpdateCard);
  const skip = document.createElement('button');
  skip.className = 'uc-skip';
  skip.textContent = 'Пропустить';
  skip.title = `Не напоминать о версии ${info.version} — только о следующих`;
  skip.addEventListener('click', () => {
    setUpdatePrefs({ skip: info.version });
    closeUpdateCard();
  });
  actions.append(download, later, skip);
  card.append(hint, actions);
  document.body.appendChild(card);
}

/** Блок «Обновления» в разделе «О проекте»: проверить сейчас и автопроверка при запуске. */
export function renderUpdateSettings(host: HTMLElement): void {
  const box = document.createElement('div');
  box.className = 'sd-updates';
  const label = document.createElement('div');
  label.className = 'ctx-label';
  label.textContent = 'Обновления';
  const row = document.createElement('div');
  row.className = 'sd-updates-row';
  const status = document.createElement('span');
  status.className = 'sd-updates-status';
  const checkedAt = updatePrefs().checkedAt;
  status.textContent = checkedAt ? `Проверяли ${dayLabel(checkedAt)}` : 'Ещё не проверяли';
  const btn = document.createElement('button');
  btn.className = 'sd-btn sd-updates-check';
  btn.textContent = 'Проверить сейчас';
  const found = document.createElement('div');
  found.className = 'sd-updates-found';
  found.hidden = true;
  btn.addEventListener('click', () => {
    void (async () => {
      btn.disabled = true;
      found.hidden = true;
      found.textContent = '';
      status.textContent = 'Проверяем…';
      status.classList.remove('error');
      try {
        const platform = await detectPlatform();
        const info = await fetchUpdate(__APP_VERSION__, platform);
        setUpdatePrefs({ checkedAt: Date.now() });
        if (!info) {
          status.textContent = 'У вас последняя версия';
        } else {
          status.textContent = `Вышла версия ${info.version}`;
          const page = document.createElement('a');
          page.className = 'sd-btn sd-about-link';
          page.href = info.page;
          page.target = '_blank';
          page.rel = 'noopener noreferrer';
          page.textContent = 'Что нового';
          found.append(downloadLink(info, 'sd-btn sd-about-link sd-updates-download'), page);
          found.hidden = false;
        }
      } catch {
        status.textContent = 'Не удалось связаться с GitHub — проверьте интернет и попробуйте ещё раз';
        status.classList.add('error');
      } finally {
        btn.disabled = false;
      }
    })();
  });
  row.append(status, btn);

  const auto = document.createElement('label');
  auto.className = 'ctx-check';
  auto.title = 'Раз в сутки при запуске спрашиваем у GitHub, вышла ли новая версия. Больше ничего не отправляется';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.className = 'sd-updates-auto';
  cb.checked = updatePrefs().auto;
  cb.addEventListener('change', () => { setUpdatePrefs({ auto: cb.checked }); });
  const span = document.createElement('span');
  span.textContent = 'Проверять при запуске';
  auto.append(cb, span);

  box.append(label, row, found, auto);
  host.appendChild(box);
}
