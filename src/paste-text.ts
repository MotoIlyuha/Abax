import type { TextRun } from './types';
import { normalizeRuns } from './text-runs';

/** Разбор вставленного из буфера обмена текста с сохранением форматирования (абзацы, списки, жирный, курсив, цвет, размер). */

export interface PastedText {
  text: string;
  bold: boolean;
  italic: boolean;
  /** Доминирующий цвет текста; null — не задан. */
  color: string | null;
  /** Доминирующий размер в px; null — не задан. */
  size: number | null;
  /** Отличия отдельных фрагментов от стиля блока; нет — форматирование одинаково по всему тексту. */
  runs?: TextRun[];
}

const BLOCK = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'TR', 'BLOCKQUOTE', 'PRE', 'SECTION', 'ARTICLE', 'TABLE']);
const SKIP = new Set(['STYLE', 'SCRIPT', 'HEAD', 'TITLE', 'META', 'LINK']);

interface Style { bold: boolean; italic: boolean; color: string | null; size: number | null }

function parseSize(v: string): number | null {
  const m = /^([\d.]+)(px|pt)$/.exec(v.trim());
  if (!m) return null;
  const n = parseFloat(m[1]) * (m[2] === 'pt' ? 4 / 3 : 1);
  return n > 0 ? n : null;
}

function isBoldWeight(w: string): boolean {
  if (w === 'bold' || w === 'bolder') return true;
  const n = parseInt(w, 10);
  return Number.isFinite(n) && n >= 600;
}

function styleOf(el: HTMLElement, parent: Style): Style {
  const s = { ...parent };
  const tag = el.tagName;
  if (tag === 'B' || tag === 'STRONG' || tag === 'TH' || /^H[1-6]$/.test(tag)) s.bold = true;
  if (tag === 'I' || tag === 'EM') s.italic = true;
  const st = el.style;
  if (st.fontWeight) s.bold = isBoldWeight(st.fontWeight);
  if (st.fontStyle) s.italic = st.fontStyle === 'italic' || st.fontStyle === 'oblique';
  if (st.color) s.color = st.color;
  const sz = st.fontSize ? parseSize(st.fontSize) : null;
  if (sz) s.size = sz;
  return s;
}

/** rgb(r, g, b) / #rgb / именованный → #rrggbb; null, если не удалось. */
function toHex(c: string): string | null {
  const t = c.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(t)) return t;
  if (/^#[0-9a-f]{3}$/.test(t)) return '#' + t[1] + t[1] + t[2] + t[2] + t[3] + t[3];
  const m = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(t);
  if (!m) return null;
  return '#' + [m[1], m[2], m[3]].map(x => Math.min(255, +x).toString(16).padStart(2, '0')).join('');
}

/** Разбирает text/html буфера обмена; null — если разобрать нечего. */
export function parseClipboardHtml(html: string): PastedText | null {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  // текст по символам и стиль каждого символа (null — служебный символ: перенос, маркер списка)
  const ch: string[] = [];
  const sty: (Style | null)[] = [];
  const push = (t: string, st: Style | null) => { for (const c of t) { ch.push(c); sty.push(st); } };
  const atLineStart = () => ch.length === 0 || ch[ch.length - 1] === '\n';
  const newline = () => { if (ch.length > 0 && !atLineStart()) push('\n', null); };

  const walk = (node: Node, st: Style, inPre: boolean): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      let t = node.textContent ?? '';
      if (!inPre) t = t.replace(/[ \t\r\n\u00a0]+/g, ' ');
      if (!t.trim() && atLineStart()) return;
      if (atLineStart()) t = t.replace(/^ +/, '');
      push(t, st);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    if (SKIP.has(el.tagName)) return;
    if (el.tagName === 'BR') { push('\n', null); return; }
    const block = BLOCK.has(el.tagName);
    if (block) newline();
    const s = styleOf(el, st);
    if (el.tagName === 'LI') {
      const p = el.parentElement;
      if (p?.tagName === 'OL') {
        const idx = Array.from(p.children).filter(c => c.tagName === 'LI').indexOf(el) + 1;
        push(`${idx}. `, null);
      } else push('• ', null);
    }
    if ((el.tagName === 'TD' || el.tagName === 'TH') && ch.length > 0 && !atLineStart() && ch[ch.length - 1] !== '\t') push('\t', null);
    const pre = inPre || el.tagName === 'PRE';
    for (const c of Array.from(el.childNodes)) walk(c, s, pre);
    if (block) newline();
  };
  walk(doc.body, { bold: false, italic: false, color: null, size: null }, false);

  // чистка: пробелы перед переносом, три и более переноса подряд, края
  const keep: boolean[] = ch.map(() => true);
  for (let i = 0; i < ch.length; i++) {
    if (ch[i] === '\n') {
      for (let j = i - 1; j >= 0 && (ch[j] === ' ' || ch[j] === '\t') && keep[j]; j--) keep[j] = false;
    }
  }
  let nl = 0;
  for (let i = 0; i < ch.length; i++) {
    if (!keep[i]) continue;
    if (ch[i] === '\n') { nl++; if (nl > 2) keep[i] = false; } else nl = 0;
  }
  let first = 0;
  while (first < ch.length && (!keep[first] || ch[first] === '\n')) first++;
  let last = ch.length - 1;
  while (last >= first && (!keep[last] || /\s/.test(ch[last]))) last--;
  const idx: number[] = [];
  for (let i = first; i <= last; i++) if (keep[i]) idx.push(i);
  if (idx.length === 0) return null;
  const text = idx.map(i => ch[i]).join('');

  // доминирующий стиль блока — по числу видимых символов
  const tally = { bold: 0, plain: 0, italic: 0, upright: 0 };
  const colors = new Map<string, number>();
  const sizes = new Map<number, number>();
  for (const i of idx) {
    const st = sty[i];
    if (!st || /\s/.test(ch[i])) continue;
    if (st.bold) tally.bold++; else tally.plain++;
    if (st.italic) tally.italic++; else tally.upright++;
    const hex = st.color ? toHex(st.color) : null;
    // текст без своего цвета — тоже голос за «цвет по умолчанию» (пустой ключ)
    const key = hex ?? '';
    colors.set(key, (colors.get(key) ?? 0) + 1);
    if (st.size) sizes.set(st.size, (sizes.get(st.size) ?? 0) + 1);
  }
  const top = <K>(m: Map<K, number>): K | null => {
    let best: K | null = null; let bn = 0;
    for (const [k, n] of m) if (n > bn) { best = k; bn = n; }
    return best;
  };
  const bold = tally.bold > tally.plain;
  const italic = tally.italic > tally.upright;
  const color = top(colors) || null;
  // фрагменты — только отличия от стиля блока; служебные символы и пробелы стиль не меняют
  const runs: TextRun[] = [];
  for (const i of idx) {
    const st = sty[i];
    const run: TextRun = { n: 1 };
    if (st && ch[i] !== '\n') {
      if (st.bold !== bold) run.bold = st.bold;
      if (st.italic !== italic) run.italic = st.italic;
      const hex = st.color ? toHex(st.color) : null;
      if (hex && hex !== color) run.color = hex;
    }
    runs.push(run);
  }
  return { text, bold, italic, color, size: top(sizes), runs: normalizeRuns(runs, text.length) };
}

/** Текст из буфера обмена: HTML с форматированием, иначе обычный текст. null — текста нет. */
export function readClipboardText(data: DataTransfer | null | undefined): PastedText | null {
  if (!data) return null;
  const html = data.getData('text/html');
  if (html) {
    const p = parseClipboardHtml(html);
    if (p) return p;
  }
  const plain = data.getData('text/plain').replace(/\r\n?/g, '\n').replace(/\s+$/, '');
  if (!plain.trim()) return null;
  return { text: plain, bold: false, italic: false, color: null, size: null };
}
