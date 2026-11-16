import type { TextEl, TextRun } from './types';

/** Стиль фрагмента: значения уже с учётом стиля блока. */
export interface RunStyle { bold: boolean; italic: boolean; color: string }

const sameRun = (a: TextRun, b: TextRun) => a.bold === b.bold && a.italic === b.italic && a.color === b.color;

/** Склеивает соседние одинаковые фрагменты, убирает пустые и «пустые» по стилю хвосты; undefined — форматирование не нужно. */
export function normalizeRuns(runs: readonly TextRun[] | undefined, len: number): TextRun[] | undefined {
  if (!runs) return undefined;
  const out: TextRun[] = [];
  let left = len;
  for (const r of runs) {
    const n = Math.min(Math.floor(r.n), left);
    if (!(n > 0)) continue;
    left -= n;
    const next: TextRun = { n };
    if (r.bold !== undefined) next.bold = r.bold;
    if (r.italic !== undefined) next.italic = r.italic;
    if (r.color !== undefined) next.color = r.color;
    const last = out[out.length - 1];
    if (last && sameRun(last, next)) last.n += n; else out.push(next);
  }
  while (out.length > 0 && out[out.length - 1].bold === undefined && out[out.length - 1].italic === undefined && out[out.length - 1].color === undefined) out.pop();
  return out.length > 0 ? out : undefined;
}

/** Фрагменты после правки текста: общие начало и конец сохраняют стиль, вставка берёт стиль символа перед ней. */
export function remapRuns(runs: readonly TextRun[] | undefined, oldText: string, newText: string): TextRun[] | undefined {
  if (!runs || runs.length === 0) return undefined;
  if (oldText === newText) return normalizeRuns(runs, newText.length);
  let p = 0;
  const max = Math.min(oldText.length, newText.length);
  while (p < max && oldText[p] === newText[p]) p++;
  let s = 0;
  while (s < max - p && oldText[oldText.length - 1 - s] === newText[newText.length - 1 - s]) s++;
  const removed = oldText.length - p - s;
  const added = newText.length - p - s;
  // разворачиваем в список стилей по символам старого текста (длина мала: текст на холсте)
  const per: TextRun[] = [];
  for (const r of runs) for (let i = 0; i < r.n && per.length < oldText.length; i++) per.push({ n: 1, bold: r.bold, italic: r.italic, color: r.color });
  while (per.length < oldText.length) per.push({ n: 1 });
  const inherit = per[Math.max(0, p - 1)] ?? { n: 1 };
  const mid = Array.from({ length: added }, () => ({ ...inherit, n: 1 }));
  const res = [...per.slice(0, p), ...mid, ...per.slice(p + removed)];
  return normalizeRuns(res, newText.length);
}

/** Стиль каждого символа не разворачиваем: отдаём кусок [from, to) строки в виде отрезков одного стиля. */
export function styledSegments(el: Pick<TextEl, 'bold' | 'italic' | 'color' | 'runs'>, from: number, to: number): { from: number; to: number; style: RunStyle }[] {
  const base: RunStyle = { bold: !!el.bold, italic: !!el.italic, color: el.color };
  const out: { from: number; to: number; style: RunStyle }[] = [];
  let pos = 0;
  for (const r of el.runs ?? []) {
    const a = Math.max(from, pos);
    const b = Math.min(to, pos + r.n);
    if (b > a) out.push({ from: a, to: b, style: { bold: r.bold ?? base.bold, italic: r.italic ?? base.italic, color: r.color ?? base.color } });
    pos += r.n;
    if (pos >= to) break;
  }
  const tail = Math.max(from, pos);
  if (to > tail) out.push({ from: tail, to, style: base });
  return out;
}

/** Убирает у фрагментов поле, когда оно задано для всего блока (общая кнопка «Ж», смена цвета). */
export function clearRunField(runs: readonly TextRun[] | undefined, field: 'bold' | 'italic' | 'color', len: number): TextRun[] | undefined {
  if (!runs) return undefined;
  return normalizeRuns(runs.map(r => {
    const c = { ...r };
    delete c[field];
    return c;
  }), len);
}

/** Проверка фрагментов из файла: негодные поля отбрасываются, длина подгоняется под текст. */
export function sanitizeRuns(raw: unknown, len: number): TextRun[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const runs: TextRun[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    if (typeof o.n !== 'number' || !Number.isFinite(o.n)) continue;
    const run: TextRun = { n: o.n };
    if (typeof o.bold === 'boolean') run.bold = o.bold;
    if (typeof o.italic === 'boolean') run.italic = o.italic;
    if (typeof o.color === 'string' && o.color.length <= 32) run.color = o.color;
    runs.push(run);
  }
  return normalizeRuns(runs, len);
}
