import type { CommentMessage, CommentThread, Element, GridMode, Page, PageRight, Project, ProjectPermissions, Pt } from './types';
import { MAX_AUTHOR_NAME, MAX_COMMENT_TEXT, MAX_REACTION_LEN } from './comments';
import { isPageRight, isPlanTier } from './limits';

// Проверка данных на границе: файл, localStorage, сеть. Неизвестные поля сохраняются (проект из
// более новой версии не теряет данные), поля известных имён с неверным типом отбрасываются.

type Rec = Record<string, unknown>;

const isObj = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';

type Check = (v: unknown) => boolean;

const GRIDS: readonly GridMode[] = ['none', 'dots', 'square', 'coord'];
const SHAPES = ['rect', 'ellipse', 'triangle', 'line', 'arrow'];
const SOLIDS = ['cube', 'box', 'prism', 'pyramid', 'truncPyramid', 'cylinder', 'cone', 'truncCone', 'sphere'];
const ALIGNS = ['left', 'center', 'right'];
const VALIGNS = ['top', 'middle', 'bottom'];
const baseIdCheck: Check = v => v === null || isStr(v);
const cropCheck: Check = v => isObj(v) && isNum(v.x) && isNum(v.y) && isNum(v.w) && isNum(v.h);

/** Реакции: эмодзи → список id. Пустые списки и не-строки пропускаются. */
export function sanitizeReactions(raw: unknown): Record<string, string[]> | undefined {
  if (!isObj(raw)) return undefined;
  const out: Record<string, string[]> = {};
  for (const [emoji, users] of Object.entries(raw)) {
    if (!Array.isArray(users) || emoji === '' || emoji.length > MAX_REACTION_LEN) continue;
    const ids = [...new Set(users.filter(isStr))];
    if (ids.length > 0) out[emoji] = ids;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Необязательные поля, общие для всех элементов. */
const COMMON_OPTIONAL: Record<string, Check> = {
  groupId: isStr,
  layerPin: v => v === 'top' || v === 'bottom',
};

/** Обязательные и необязательные поля известных элементов: имя → проверка. */
const SPECS: Record<string, { req: Record<string, Check>; opt: Record<string, Check> }> = {
  stroke: {
    req: { tool: v => v === 'pen' || v === 'highlighter', color: isStr, width: isNum },
    opt: { opacity: isNum, baseId: baseIdCheck },
  },
  shape: {
    req: { shape: v => SHAPES.includes(v as string), x: isNum, y: isNum, w: isNum, h: isNum, color: isStr, width: isNum },
    opt: {
      fill: isStr, fillOpacity: isNum, opacity: isNum, rot: isNum, radius: isNum, text: isStr, textSize: isNum,
      bold: isBool, italic: isBool, align: v => ALIGNS.includes(v as string), valign: v => VALIGNS.includes(v as string),
    },
  },
  poly: {
    req: { closed: isBool, color: isStr, width: isNum },
    opt: { opacity: isNum },
  },
  text: {
    req: { x: isNum, y: isNum, text: isStr, size: isNum, color: isStr },
    opt: { w: isNum, opacity: isNum, bold: isBool, italic: isBool },
  },
  note: {
    req: { x: isNum, y: isNum, w: isNum, h: isNum, text: isStr, color: isStr },
    opt: { baseId: baseIdCheck },
  },
  image: {
    req: { x: isNum, y: isNum, w: isNum, h: isNum, src: isStr },
    opt: { crop: cropCheck, rot: isNum, color: isStr, width: isNum, opacity: isNum, radius: isNum, page: isStr },
  },
  solid: {
    req: { solid: v => SOLIDS.includes(v as string), x: isNum, y: isNum, w: isNum, d: isNum, h: isNum, color: isStr, width: isNum },
    opt: { n: isNum, t: isNum, opacity: isNum },
  },
};

function sanitizePts(raw: unknown): Pt[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: Pt[] = [];
  for (const p of raw) {
    if (!isObj(p) || !isNum(p.x) || !isNum(p.y)) return null;
    out.push({ x: p.x, y: p.y, p: isNum(p.p) ? p.p : 0.5 });
  }
  return out;
}

/** Элемент доски из непроверенных данных; null — элемент негодный (неизвестный тип, нет обязательных полей). */
export function sanitizeElement(raw: unknown): Element | null {
  if (!isObj(raw) || !isStr(raw.id) || raw.id === '' || !isStr(raw.type)) return null;
  const spec = SPECS[raw.type];
  if (!spec) return null;
  for (const [k, check] of Object.entries(spec.req)) if (!check(raw[k])) return null;
  const out: Rec = { ...raw };
  for (const [k, check] of Object.entries({ ...spec.opt, ...COMMON_OPTIONAL })) {
    if (k in out && !check(out[k])) delete out[k];
  }
  if (raw.type === 'stroke' || raw.type === 'poly') {
    const pts = sanitizePts(raw.pts);
    if (!pts) return null;
    out.pts = pts;
  }
  if ('reactions' in out) {
    const reactions = sanitizeReactions(out.reactions);
    if (reactions) out.reactions = reactions;
    else delete out.reactions;
  }
  return out as unknown as Element;
}

function sanitizeMessage(raw: unknown): CommentMessage | null {
  if (!isObj(raw) || !isStr(raw.id) || !isStr(raw.authorId) || raw.authorId === '' || !isStr(raw.text) || !isNum(raw.createdAt)) return null;
  const text = raw.text.trim().slice(0, MAX_COMMENT_TEXT);
  if (!text) return null;
  const authorName = isStr(raw.authorName) ? Array.from(raw.authorName).slice(0, MAX_AUTHOR_NAME).join('') : '';
  return { id: raw.id, authorId: raw.authorId, authorName, text, createdAt: raw.createdAt };
}

/** Ветки комментариев страницы: негодные сообщения и ветки без сообщений отбрасываются. */
export function sanitizeComments(raw: unknown): CommentThread[] {
  if (!Array.isArray(raw)) return [];
  const out: CommentThread[] = [];
  for (const t of raw) {
    if (!isObj(t) || !isStr(t.id) || t.id === '' || !isNum(t.x) || !isNum(t.y) || !Array.isArray(t.messages)) continue;
    const messages = t.messages.map(sanitizeMessage).filter((m): m is CommentMessage => m !== null);
    if (messages.length === 0) continue;
    out.push({
      id: t.id, x: t.x, y: t.y,
      ...(isStr(t.targetElementId) && t.targetElementId !== '' ? { targetElementId: t.targetElementId } : {}),
      ...(t.resolved === true ? { resolved: true } : {}),
      messages,
    });
  }
  return out;
}

function sanitizePage(raw: unknown): Page | null {
  if (!isObj(raw) || !isStr(raw.id) || raw.id === '') return null;
  const out: Rec = { ...raw };
  out.name = isStr(raw.name) ? raw.name : 'Страница';
  out.grid = GRIDS.includes(raw.grid as GridMode) ? raw.grid : 'square';
  if ('backgroundColor' in out && !isStr(out.backgroundColor)) delete out.backgroundColor;
  const elements: Element[] = [];
  if (Array.isArray(raw.elements)) {
    for (const el of raw.elements) {
      const clean = sanitizeElement(el);
      if (clean) elements.push(clean);
      else console.warn('Элемент отброшен при загрузке', isObj(el) ? el.type : el);
    }
  }
  out.elements = elements;
  if ('comments' in out) {
    const comments = sanitizeComments(out.comments);
    if (comments.length > 0) out.comments = comments;
    else delete out.comments;
  }
  return out as unknown as Page;
}

/** Права проекта: известные поля проверяются, прочее отбрасывается. undefined — прав нет или они испорчены. */
export function sanitizePermissions(raw: unknown): ProjectPermissions | undefined {
  if (!isObj(raw)) return undefined;
  const out: ProjectPermissions = {};
  if (isBool(raw.forbidClone)) out.forbidClone = raw.forbidClone;
  if (isBool(raw.allowCopy)) out.allowCopy = raw.allowCopy;
  if (isObj(raw.pageRights)) {
    const pageRights: Record<string, PageRight> = {};
    for (const [id, r] of Object.entries(raw.pageRights)) if (isPageRight(r)) pageRights[id] = r;
    out.pageRights = pageRights;
  }
  return out;
}

/**
 * Проект из непроверенных данных. Старая доска без страниц оборачивается в проект с одной страницей.
 * null — это не проект. Права проекта хранятся как есть: поправку на тариф вносят места их применения.
 */
export function parseProject(raw: unknown): Project | null {
  if (!isObj(raw)) return null;
  let pagesRaw: unknown[];
  let legacy: Rec | null = null;
  if (Array.isArray(raw.pages)) pagesRaw = raw.pages;
  else if (Array.isArray(raw.elements) && isStr(raw.id)) {
    legacy = raw;
    pagesRaw = [{ id: `pg-${raw.id}`, name: 'Страница 1', grid: isStr(raw.grid) ? raw.grid : 'square', elements: raw.elements }];
  } else return null;
  if (!isStr(raw.id) || raw.id === '') return null;

  const pages: Page[] = [];
  const seen = new Set<string>();
  for (const pr of pagesRaw) {
    const page = sanitizePage(pr);
    if (!page || seen.has(page.id)) continue;
    seen.add(page.id);
    pages.push(page);
  }
  if (pages.length === 0) pages.push({ id: `pg-${raw.id}`, name: 'Страница 1', grid: 'square', elements: [] });

  const now = Date.now();
  const out: Rec = { ...raw };
  if (legacy) { delete out.elements; delete out.grid; }
  out.name = isStr(raw.name) ? raw.name : 'Без названия';
  out.createdAt = isNum(raw.createdAt) ? raw.createdAt : now;
  out.updatedAt = isNum(raw.updatedAt) ? raw.updatedAt : out.createdAt;
  out.pages = pages;
  if ('pinned' in out && !isBool(out.pinned)) delete out.pinned;
  if ('icon' in out && !isStr(out.icon)) delete out.icon;
  if ('ownerPlan' in out && !isPlanTier(out.ownerPlan)) delete out.ownerPlan;
  if ('permissions' in out) {
    const perms = sanitizePermissions(out.permissions);
    if (perms) out.permissions = perms;
    else delete out.permissions;
  }
  return out as unknown as Project;
}

/** Проект как текст JSON (без служебных полей: undefined в JSON не попадает). */
export function serializeProject(project: Project, pretty = false): string {
  return JSON.stringify(project, null, pretty ? 2 : undefined);
}
