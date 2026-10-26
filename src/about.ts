// Раздел «О проекте» окна всех настроек: название, версия, обновления, ссылки на репозиторий.

import { renderUpdateSettings } from './update-notice';
import { REPO_URL } from './updates';

const FEATURES = [
  'перо, маркер, фигуры, текст и лазерная указка',
  'сетки и координатная плоскость',
  'стереометрия: призмы, пирамиды, тела вращения',
  'страницы и проекты, импорт PDF и картинок',
  'окно демонстрации для видеозвонка',
  'совместная работа по локальной сети',
];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Ссылка во внешний браузер: в Electron её перехватывает main-процесс (shell.openExternal). */
function link(href: string, text: string): HTMLAnchorElement {
  const a = el('a', 'sd-btn sd-about-link', text);
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}

const HOLD_MS = 800;
const TOAST_MS = 4000;
const SECRET = 'Сделано для Инны с любовью от Ильи 💚';

/** Пасхалка: логотип нажали и держат — внизу окна всплывает тост. */
function holdToReveal(logo: HTMLElement): void {
  let timer = 0;
  const cancel = () => { clearTimeout(timer); timer = 0; };
  logo.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    cancel();
    timer = window.setTimeout(() => { timer = 0; showToast(SECRET); }, HOLD_MS);
  });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel'] as const) logo.addEventListener(ev, cancel);
  // долгое нажатие пальцем иначе открывает системное меню картинки
  logo.addEventListener('contextmenu', e => e.preventDefault());
}

let toastTimer = 0;

function showToast(text: string): void {
  let t = document.getElementById('toast');
  if (!t) {
    t = el('div', '');
    t.id = 'toast';
    t.setAttribute('role', 'status');
    document.body.appendChild(t);
  }
  t.textContent = text;
  t.hidden = false;
  // перезапуск анимации появления, если тост уже на экране
  t.classList.remove('show');
  void t.offsetWidth;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { t!.hidden = true; t!.classList.remove('show'); }, TOAST_MS);
}

export function renderAbout(host: HTMLElement): void {
  const box = el('div', 'sd-about');
  const head = el('div', 'sd-about-head');
  // логотип лежит в public/ — рядом с index.html и в Electron, и у гостей совместной работы
  const logo = el('img', 'sd-about-logo');
  logo.src = 'logo.svg';
  logo.alt = '';
  logo.draggable = false;
  holdToReveal(logo);
  const title = el('div', 'sd-about-title');
  const name = el('div', 'sd-about-name');
  name.append(el('span', '', 'Abax'), el('span', 'sd-about-greek', 'ἄβαξ'));
  title.append(name, el('div', 'sd-about-version', `Версия ${__APP_VERSION__}`));
  head.append(logo, title);
  box.appendChild(head);
  box.appendChild(el('p', 'sd-about-desc', 'Локальная доска для занятий по математике. Доски хранятся на этом компьютере — интернет для работы не нужен.'));

  box.appendChild(el('div', 'ctx-label', 'Возможности'));
  const list = el('ul', 'sd-about-features');
  for (const f of FEATURES) list.appendChild(el('li', '', f));
  box.appendChild(list);
  renderUpdateSettings(box);

  const links = el('div', 'sd-about-links');
  links.append(link(REPO_URL, 'Исходный код на GitHub'), link(`${REPO_URL}/issues`, 'Сообщить о проблеме'));
  box.appendChild(links);
  host.appendChild(box);
}
