/** Разбор вставленного из буфера обмена текста с сохранением форматирования (абзацы, списки, жирный, курсив, цвет, размер). */

export interface PastedText {
  text: string;
  bold: boolean;
  italic: boolean;
  /** Доминирующий цвет текста; null — не задан. */
  color: string | null;
  /** Доминирующий размер в px; null — не задан. */
  size: number | null;
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
  let out = '';
  const tally = { bold: 0, plain: 0, italic: 0, upright: 0 };
  const colors = new Map<string, number>();
  const sizes = new Map<number, number>();

  const newline = () => { if (out && !out.endsWith('\n')) out += '\n'; };
  const walk = (node: Node, st: Style, inPre: boolean): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      let t = node.textContent ?? '';
      if (!inPre) t = t.replace(/[ \t\r\n ]+/g, ' ');
      if (!t.trim() && (out === '' || out.endsWith('\n'))) return;
      if (out === '' || out.endsWith('\n')) t = t.replace(/^ +/, '');
      out += t;
      const n = t.trim().length;
      if (n === 0) return;
      if (st.bold) tally.bold += n; else tally.plain += n;
      if (st.italic) tally.italic += n; else tally.upright += n;
      if (st.color) colors.set(st.color, (colors.get(st.color) ?? 0) + n);
      if (st.size) sizes.set(st.size, (sizes.get(st.size) ?? 0) + n);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    if (SKIP.has(el.tagName)) return;
    if (el.tagName === 'BR') { out += '\n'; return; }
    const block = BLOCK.has(el.tagName);
    if (block) newline();
    const s = styleOf(el, st);
    if (el.tagName === 'LI') {
      const p = el.parentElement;
      if (p?.tagName === 'OL') {
        const idx = Array.from(p.children).filter(c => c.tagName === 'LI').indexOf(el) + 1;
        out += `${idx}. `;
      } else out += '• ';
    }
    if (el.tagName === 'TD' || el.tagName === 'TH') { if (out && !out.endsWith('\n') && !out.endsWith('\t')) out += '\t'; }
    const pre = inPre || el.tagName === 'PRE';
    for (const ch of Array.from(el.childNodes)) walk(ch, s, pre);
    if (block) newline();
  };
  walk(doc.body, { bold: false, italic: false, color: null, size: null }, false);

  const text = out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+|\s+$/g, '');
  if (!text) return null;
  const top = <K>(m: Map<K, number>): K | null => {
    let best: K | null = null; let bn = 0;
    for (const [k, n] of m) if (n > bn) { best = k; bn = n; }
    return best;
  };
  const rawColor = top(colors);
  return {
    text,
    bold: tally.bold > tally.plain,
    italic: tally.italic > tally.upright,
    color: rawColor ? toHex(rawColor) : null,
    size: top(sizes),
  };
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
