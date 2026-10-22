// Раздел «О проекте» окна всех настроек: название, версия, ссылки на репозиторий.

const REPO_URL = 'https://github.com/MotoIlyuha/Doska';

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

export function renderAbout(host: HTMLElement): void {
  const box = el('div', 'sd-about');
  const head = el('div', 'sd-about-head');
  head.append(el('div', 'sd-about-name', 'Doska'), el('div', 'sd-about-version', `Версия ${__APP_VERSION__}`));
  box.appendChild(head);
  box.appendChild(el('p', 'sd-about-desc', 'Локальная доска для занятий по математике. Доски хранятся на этом компьютере — интернет для работы не нужен.'));

  box.appendChild(el('div', 'ctx-label', 'Возможности'));
  const list = el('ul', 'sd-about-features');
  for (const f of FEATURES) list.appendChild(el('li', '', f));
  box.appendChild(list);

  const links = el('div', 'sd-about-links');
  links.append(link(REPO_URL, 'Исходный код на GitHub'), link(`${REPO_URL}/issues`, 'Сообщить о проблеме'));
  box.appendChild(links);
  host.appendChild(box);
}
