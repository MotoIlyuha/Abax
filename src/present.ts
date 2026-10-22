// Окно демонстрации: отдельное окно только с холстом, его показывают ученику
// в видеозвонке (демонстрация окна), а работают в основном окне с интерфейсом.
// Окно пустое (about:blank, тот же origin): холст в нём рисует рендерер основного окна.
import { attachPresent, detachPresent, requestRender } from './renderer';
import { update } from './state';

const WIN_NAME = 'doska-present';
export const PRESENT_TITLE = 'Abax — демонстрация';

let win: Window | null = null;
let closeWatch = 0;

export function presentOpen(): boolean {
  return win !== null && !win.closed;
}

/** Открывает окно демонстрации (или поднимает уже открытое); false — окно заблокировано. */
export function openPresent(): boolean {
  if (win && !win.closed) {
    win.focus();
    return true;
  }
  const w = window.open('', WIN_NAME, 'popup,width=1280,height=720');
  if (!w) return false;
  const doc = w.document;
  // окно с тем же именем могло остаться открытым — собираем документ заново
  doc.head.textContent = '';
  doc.body.textContent = '';
  doc.title = PRESENT_TITLE;
  doc.documentElement.lang = 'ru';
  const style = doc.createElement('style');
  style.textContent = 'html,body{margin:0;height:100%;overflow:hidden;background:#fff}canvas{display:block;width:100vw;height:100vh}';
  doc.head.appendChild(style);
  const c = doc.createElement('canvas');
  doc.body.appendChild(c);
  // двойной клик — во весь экран (например, окно на втором мониторе), Esc — обратно
  c.addEventListener('dblclick', () => {
    if (doc.fullscreenElement) void doc.exitFullscreen();
    else void doc.documentElement.requestFullscreen().catch(() => { /* запрещено — остаёмся в окне */ });
  });
  w.addEventListener('resize', () => requestRender());
  w.addEventListener('pagehide', () => { if (win === w) onClosed(); });
  win = w;
  attachPresent(w, c);
  // pagehide приходит не всегда (например, окно закрыл main-процесс) — страхуемся опросом
  closeWatch = window.setInterval(() => { if (win && win.closed) onClosed(); }, 1000);
  update();
  return true;
}

export function closePresent(): void {
  const w = win;
  if (!w) return;
  onClosed();
  w.close();
}

function onClosed(): void {
  win = null;
  clearInterval(closeWatch);
  detachPresent();
  update();
}

// окно без основного не живёт: перезагрузка или закрытие доски закрывают и его
window.addEventListener('pagehide', () => closePresent());
