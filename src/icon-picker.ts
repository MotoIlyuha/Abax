// Окно выбора иконки проекта, как в Miro: поиск, вкладки категорий, сетка эмодзи
// и загрузка своей картинки. Эмодзи (src/emoji-data.json, см. scripts/emoji.mjs) грузятся
// отдельным куском при первом открытии окна.

import { svg } from './toolbar';

/** Категория → [эмодзи, «название и теги» в нижнем регистре]. */
type EmojiData = Record<string, [string, string][]>;

const CATEGORIES: { key: string; title: string; icon: string }[] = [
  { key: 's', title: 'Смайлы и люди', icon: svg('<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0"/><path d="M9 9.5h.01M15 9.5h.01"/>') },
  { key: 'a', title: 'Животные и природа', icon: svg('<circle cx="12" cy="13.5" r="6.5"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="6.5" r="2.5"/><path d="M10 13h.01M14 13h.01M11 16.5h2"/>') },
  { key: 'f', title: 'Еда и напитки', icon: svg('<path d="M5 10h12v3a6 6 0 0 1-12 0z"/><path d="M17 11h1.5a2.5 2.5 0 0 1 0 5H16"/><path d="M8 3.5c0 1.5 1 1.5 1 3M12 3.5c0 1.5 1 1.5 1 3"/>') },
  { key: 'c', title: 'Занятия и спорт', icon: svg('<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6c3 3 3 9.8 0 12.8M18.4 5.6c-3 3-3 9.8 0 12.8"/>') },
  { key: 't', title: 'Путешествия и места', icon: svg('<path d="M5 16V11l2-5h10l2 5v5z"/><path d="M5 11h14"/><path d="M7 16v2.5M17 16v2.5"/><path d="M8 13.5h.01M16 13.5h.01"/>') },
  { key: 'o', title: 'Предметы', icon: svg('<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9V16h7v-2.1A6 6 0 0 0 12 3z"/>') },
  { key: 'y', title: 'Символы', icon: svg('<path d="M12 20s-7-4.4-7-9.5A3.8 3.8 0 0 1 12 8a3.8 3.8 0 0 1 7 2.5C19 15.6 12 20 12 20z"/>') },
  { key: 'g', title: 'Флаги', icon: svg('<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>') },
];

const UPLOAD_ICON = svg('<path d="M12 15V4"/><path d="M8 8l4-4 4 4"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>');
/** Сторона загруженной картинки: иконке больше не нужно, а проект не раздувается. */
const UPLOAD_PX = 64;

let data: Promise<EmojiData> | null = null;

function loadEmoji(): Promise<EmojiData> {
  data ??= import('./emoji-data.json').then(m => m.default as unknown as EmojiData);
  return data;
}

/** Флаги стран Windows рисует буквами (в системном шрифте их нет) — там их не показываем. */
const HIDE_COUNTRY_FLAGS = typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent);
const COUNTRY_FLAG = /[\u{1F1E6}-\u{1F1FF}\u{E0061}-\u{E007A}]/u;

let open: { el: HTMLElement; anchor: HTMLElement; off: () => void } | null = null;

export function iconPickerOpen(): boolean {
  return open !== null;
}

export function closeIconPicker(): void {
  if (!open) return;
  open.off();
  open.el.remove();
  open = null;
}

/** Картинка → квадрат UPLOAD_PX (обрезка по центру) в PNG; null — не прочиталась. */
async function fileToIcon(file: File): Promise<string | null> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    if (!side) return null;
    const cv = document.createElement('canvas');
    cv.width = cv.height = UPLOAD_PX;
    cv.getContext('2d')!.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, UPLOAD_PX, UPLOAD_PX);
    return cv.toDataURL('image/png');
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Окно выбора иконки у anchor. onPick — эмодзи или картинка (data:image/png); null — убрать иконку.
 * Повторный вызов с тем же anchor закрывает окно.
 */
export function openIconPicker(anchor: HTMLElement, current: string | null, onPick: (icon: string | null) => void): void {
  if (open?.anchor === anchor) { closeIconPicker(); return; }
  closeIconPicker();
  const el = document.createElement('div');
  el.id = 'icon-picker';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Иконка проекта');

  const head = document.createElement('div');
  head.className = 'ip-head';
  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'ip-search';
  search.placeholder = 'Поиск';
  search.spellcheck = false;
  search.autocomplete = 'off';
  head.appendChild(search);
  if (current) {
    const remove = document.createElement('button');
    remove.className = 'ip-remove';
    remove.textContent = 'Убрать';
    remove.title = 'Убрать иконку';
    remove.addEventListener('click', () => { closeIconPicker(); onPick(null); });
    head.appendChild(remove);
  }

  const tabs = document.createElement('div');
  tabs.className = 'ip-tabs';
  tabs.setAttribute('role', 'tablist');
  const body = document.createElement('div');
  body.className = 'ip-body';
  const status = document.createElement('div');
  status.className = 'ip-status';
  status.textContent = 'Загрузка…';
  body.appendChild(status);

  const foot = document.createElement('div');
  foot.className = 'ip-foot';
  const upload = document.createElement('button');
  upload.className = 'ip-upload';
  upload.innerHTML = UPLOAD_ICON;
  upload.append('Загрузить');
  upload.title = 'Своя картинка: обрежется в квадрат';
  const file = document.createElement('input');
  file.type = 'file';
  file.accept = 'image/*';
  file.hidden = true;
  upload.addEventListener('click', () => file.click());
  file.addEventListener('change', () => {
    const f = file.files?.[0];
    if (!f) return;
    void fileToIcon(f).then(icon => {
      if (!icon) { alert('Не удалось прочитать изображение'); return; }
      closeIconPicker();
      onPick(icon);
    });
  });
  foot.append(upload, file);
  el.append(head, tabs, body, foot);
  document.body.appendChild(el);
  place(el, anchor);

  const pick = (emoji: string) => { closeIconPicker(); onPick(emoji); };
  const emojiButton = ([emoji, words]: [string, string]): HTMLButtonElement => {
    const b = document.createElement('button');
    b.className = 'ip-emoji' + (emoji === current ? ' active' : '');
    b.textContent = emoji;
    b.title = words.split(' ').slice(0, 4).join(' ');
    b.addEventListener('click', () => pick(emoji));
    return b;
  };

  const tabButtons = new Map<string, HTMLButtonElement>();
  const sections = new Map<string, HTMLElement>();
  let jumped = false;
  for (const c of CATEGORIES) {
    const t = document.createElement('button');
    t.className = 'ip-tab';
    t.title = c.title;
    t.innerHTML = c.icon;
    t.setAttribute('role', 'tab');
    t.addEventListener('click', () => {
      search.value = '';
      showSections();
      // offsetTop раздела — от .ip-body (у неё position: relative)
      const s = sections.get(c.key);
      const before = body.scrollTop;
      if (s) body.scrollTop = s.offsetTop;
      jumped = body.scrollTop !== before;
      markTab(c.key);
    });
    tabButtons.set(c.key, t);
    tabs.appendChild(t);
  }
  const markTab = (key: string) => {
    for (const [k, t] of tabButtons) t.setAttribute('aria-selected', String(k === key));
  };
  markTab(CATEGORIES[0].key);

  const results = document.createElement('div');
  results.className = 'ip-section ip-results';
  results.hidden = true;
  const showSections = () => {
    results.hidden = true;
    for (const s of sections.values()) s.hidden = false;
  };

  let all: [string, string][] = [];
  void loadEmoji().then(d => {
    if (open?.el !== el) return;
    status.remove();
    for (const c of CATEGORIES) {
      const list = (d[c.key] ?? []).filter(([e]) => !(HIDE_COUNTRY_FLAGS && COUNTRY_FLAG.test(e)));
      if (list.length === 0) { tabButtons.get(c.key)!.remove(); continue; }
      all = all.concat(list);
      const s = document.createElement('section');
      s.className = 'ip-section';
      s.dataset.cat = c.key;
      const h = document.createElement('div');
      h.className = 'ip-title';
      h.textContent = c.title;
      const grid = document.createElement('div');
      grid.className = 'ip-grid';
      for (const item of list) grid.appendChild(emojiButton(item));
      s.append(h, grid);
      sections.set(c.key, s);
      body.appendChild(s);
    }
    body.appendChild(results);
  });

  // подсветка вкладки — по прокрутке; докрутили до конца — последний раздел (он короче окна).
  // Прокрутку от клика по вкладке пропускаем: у конца списка раздел не встаёт наверх, а вкладка — та, что нажали
  body.addEventListener('scroll', () => {
    if (jumped) { jumped = false; return; }
    if (!results.hidden || sections.size === 0) return;
    let cur = CATEGORIES[0].key;
    for (const [k, s] of sections) if (s.offsetTop <= body.scrollTop + 8) cur = k;
    if (body.scrollTop + body.clientHeight >= body.scrollHeight - 2) cur = [...sections.keys()].pop()!;
    markTab(cur);
  });

  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    if (!q) { showSections(); return; }
    for (const s of sections.values()) s.hidden = true;
    results.hidden = false;
    results.textContent = '';
    // сначала те, чьё название начинается с запроса («ракета» — 🚀, потом 🧑‍🚀), затем совпадения с начала слова
    const rank = (words: string) => words.startsWith(q) ? 0 : (' ' + words).includes(' ' + q) ? 1 : 2;
    const found = all
      .filter(([e, words]) => e === q || words.includes(q))
      .map((item, i) => ({ item, r: rank(item[1]), i }))
      .sort((a, b) => a.r - b.r || a.i - b.i)
      .map(x => x.item);
    const h = document.createElement('div');
    h.className = 'ip-title';
    h.textContent = found.length ? 'Найдено' : 'Ничего не нашлось';
    const grid = document.createElement('div');
    grid.className = 'ip-grid';
    for (const item of found) grid.appendChild(emojiButton(item));
    results.append(h, grid);
    body.scrollTop = 0;
  });
  search.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      const first = results.hidden ? null : results.querySelector<HTMLButtonElement>('.ip-emoji');
      first?.click();
    } else if (e.key === 'Escape') {
      closeIconPicker();
    }
  });

  // клик мимо, Esc, прокрутка домашней или смена размера окна — закрыть
  const onDown = (e: PointerEvent) => {
    const t = e.target as Node;
    if (!el.contains(t) && !anchor.contains(t)) closeIconPicker();
  };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeIconPicker(); };
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', closeIconPicker);
  open = {
    el, anchor,
    off: () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', closeIconPicker);
    },
  };
  search.focus();
}

/** Под кнопкой-вызовом (не влезает — над ней), в пределах окна. */
function place(el: HTMLElement, anchor: HTMLElement): void {
  const a = anchor.getBoundingClientRect();
  const w = el.offsetWidth, h = el.offsetHeight;
  const m = 8;
  let left = a.left;
  let top = a.bottom + 6;
  if (top + h > window.innerHeight - m && a.top - 6 - h >= m) top = a.top - 6 - h;
  left = Math.max(m, Math.min(left, window.innerWidth - w - m));
  top = Math.max(m, Math.min(top, window.innerHeight - h - m));
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}
