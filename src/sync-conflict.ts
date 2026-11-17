import { parseProject } from './file';
import type { Project } from './types';

// Подпись содержимого проекта для поиска настоящего офлайн-конфликта (SPEC_NIGHT5 §2.4). Чистый модуль без DOM:
// его использует и сервер. В подпись входит только то, что меняет автор: «живые» поля (реакции, попытки и черновики
// учеников, комментарии), метки времени, тариф и права проекта не учитываются — иначе ответ ученика или поправка
// прав на тариф давали бы ложный конфликт.

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/** Поля элемента, которые меняются мимо автора. */
const LIVE_ELEMENT_KEYS = new Set(['reactions', 'attempts', 'studentDraft']);
/** Поля проекта, не относящиеся к содержимому автора. */
const SKIP_PROJECT_KEYS = new Set(['createdAt', 'updatedAt', 'ownerPlan', 'permissions']);

/** JSON с упорядоченными ключами: одинаковое содержимое даёт одинаковую строку независимо от порядка полей. */
function canonical(v: unknown, skip?: ReadonlySet<string>): string {
  if (v === null || typeof v !== 'object') return JSON.stringify((v === undefined ? null : v) as Json);
  if (Array.isArray(v)) return `[${v.map(x => (x === undefined ? 'null' : canonical(x))).join(',')}]`;
  const rec = v as Record<string, unknown>;
  const keys = Object.keys(rec).filter(k => rec[k] !== undefined && !skip?.has(k)).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${canonical(rec[k])}`).join(',')}}`;
}

/** cyrb53: быстрый 53-битный хеш строки (не криптографический — защищает только от совпадения версий). */
export function cyrb53(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

/** Канонический вид содержимого автора (для подписи и для отладки). */
export function contentCanonical(project: Pick<Project, 'pages'> | Project): string {
  const pages = project.pages.map(pg => {
    const { comments: _c, ...rest } = pg;
    return { ...rest, elements: pg.elements.map(el => canonical(el, LIVE_ELEMENT_KEYS)) };
  });
  const head = canonical({ ...project, pages: null }, SKIP_PROJECT_KEYS);
  return `${head}|${pages.map(pg => canonical({ ...pg, elements: null }) + pg.elements.join(',')).join('|')}`;
}

/** Подпись содержимого автора: совпадает, если автор ничего не менял (живые поля и метки времени не в счёт). */
export function contentSignature(project: Pick<Project, 'pages'> | Project): string {
  // обе стороны сравнивают проект в том виде, в каком его хранит сервер (после проверки формы)
  let norm: Pick<Project, 'pages'> = project;
  try {
    const parsed = parseProject(JSON.parse(JSON.stringify(project)));
    if (parsed) norm = parsed;
  } catch { /* не JSON — подписываем как есть */ }
  return `v1:${cyrb53(contentCanonical(norm))}`;
}
