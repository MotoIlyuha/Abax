// Окно «Все настройки»: модальное, слева разделы, справа содержимое выбранного.
// Пока окно открыто, клавиатура доске не достаётся: горячие клавиши инструментов,
// Delete и т.п. не должны срабатывать за спиной у диалога.

/** Что раздел отдаёт окну: свою обработку клавиш и уборку при уходе из раздела. */
export interface SectionView {
  /** true — клавиша обработана разделом (окно её больше никому не отдаёт). */
  onKey?(e: KeyboardEvent): boolean;
  dispose?(): void;
}

export interface SettingsSection {
  id: string;
  title: string;
  icon: string;
  /** rerender — перерисовать раздел целиком (после изменения настроек). */
  render(host: HTMLElement, rerender: () => void): SectionView | void;
}

interface Dialog {
  el: HTMLElement;
  win: HTMLElement;
  nav: HTMLElement;
  heading: HTMLElement;
  content: HTMLElement;
  sections: SettingsSection[];
  view: SectionView | null;
  /** Фокус до открытия — вернём его при закрытии. */
  prevFocus: Element | null;
}

let dialog: Dialog | null = null;
/** Раздел, открытый последним: окно открывается на нём же. */
let lastSection = '';

const CLOSE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

export function settingsDialogOpen(): boolean {
  return !!dialog;
}

export function openSettingsDialog(sections: SettingsSection[], section?: string): void {
  closeSettingsDialog();
  const el = document.createElement('div');
  el.id = 'settings-dialog';
  const win = document.createElement('div');
  win.className = 'sd-window';
  win.setAttribute('role', 'dialog');
  win.setAttribute('aria-modal', 'true');
  win.setAttribute('aria-labelledby', 'sd-title');

  const nav = document.createElement('nav');
  nav.className = 'sd-nav';
  const navTitle = document.createElement('div');
  navTitle.className = 'sd-nav-title';
  navTitle.textContent = 'Настройки';
  nav.appendChild(navTitle);
  for (const s of sections) {
    const b = document.createElement('button');
    b.className = 'sd-nav-item';
    b.dataset.section = s.id;
    b.innerHTML = s.icon;
    const label = document.createElement('span');
    label.textContent = s.title;
    b.appendChild(label);
    b.addEventListener('click', () => showSection(s.id));
    nav.appendChild(b);
  }

  const main = document.createElement('div');
  main.className = 'sd-main';
  const head = document.createElement('div');
  head.className = 'sd-head';
  const heading = document.createElement('h2');
  heading.id = 'sd-title';
  const close = document.createElement('button');
  close.className = 'sd-close';
  close.title = 'Закрыть (Esc)';
  close.innerHTML = CLOSE_ICON;
  close.addEventListener('click', closeSettingsDialog);
  head.append(heading, close);
  const content = document.createElement('div');
  content.className = 'sd-content';
  main.append(head, content);

  win.append(nav, main);
  el.appendChild(win);
  document.body.appendChild(el);
  // клик по затемнению мимо окна закрывает его
  el.addEventListener('pointerdown', e => { if (e.target === el) closeSettingsDialog(); });
  window.addEventListener('keydown', onKey, true);

  dialog = { el, win, nav, heading, content, sections, view: null, prevFocus: document.activeElement };
  const first = sections.find(s => s.id === section) ?? sections.find(s => s.id === lastSection) ?? sections[0];
  showSection(first.id);
  nav.querySelector<HTMLElement>('.sd-nav-item.active')?.focus();
}

function showSection(id: string): void {
  const d = dialog;
  if (!d) return;
  const s = d.sections.find(x => x.id === id) ?? d.sections[0];
  d.view?.dispose?.();
  d.view = null;
  lastSection = s.id;
  for (const b of d.nav.querySelectorAll<HTMLElement>('.sd-nav-item')) {
    const on = b.dataset.section === s.id;
    b.classList.toggle('active', on);
    if (on) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  }
  d.heading.textContent = s.title;
  d.content.textContent = '';
  d.content.dataset.section = s.id;
  d.view = s.render(d.content, () => showSection(s.id)) || null;
}

export function closeSettingsDialog(): void {
  const d = dialog;
  if (!d) return;
  dialog = null;
  d.view?.dispose?.();
  window.removeEventListener('keydown', onKey, true);
  d.el.remove();
  if (d.prevFocus instanceof HTMLElement && d.prevFocus.isConnected) d.prevFocus.focus();
}

/** Tab не выпускает фокус из окна. */
function trapFocus(e: KeyboardEvent, win: HTMLElement): void {
  const items = [...win.querySelectorAll<HTMLElement>('button, a[href], input, select, [tabindex]:not([tabindex="-1"])')]
    .filter(x => !(x as HTMLButtonElement).disabled && x.offsetParent !== null);
  if (items.length === 0) return;
  const first = items[0];
  const last = items[items.length - 1];
  const cur = document.activeElement;
  if (!win.contains(cur)) { e.preventDefault(); first.focus(); }
  else if (e.shiftKey && cur === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && cur === last) { e.preventDefault(); first.focus(); }
}

// слушаем window на фазе перехвата: раньше доски и раньше полей ввода окна
function onKey(e: KeyboardEvent): void {
  const d = dialog;
  if (!d) return;
  if (d.view?.onKey?.(e)) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    closeSettingsDialog();
    return;
  }
  if (e.key === 'Tab') trapFocus(e, d.win);
  // ввод в полях окна работает (действие по умолчанию), а доске клавиши не достаются
  e.stopPropagation();
}
