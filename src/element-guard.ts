import type { Element, Page, TaskEl } from './types';
import { same, type BoardPatch, type ElementOp } from './delta';
import { mergeGuestTask, mergeHostTask } from './task-element';

// Защита чужих элементов (SPEC_NIGHT6 §4): решение принимают только хаб и сервер. Чистые функции без DOM —
// общие для src/room-host.ts и server/projects.ts; зеркало для electron/room.cjs — electron/room-guard.cjs
// (паритет — tests/server/room-pointer.test.ts).
// Автор элемента — поле by (u:<userId> или c:<id>); нет поля — элемент владельца доски.

export interface GuardWho {
  /** Владелец доски (любое его устройство): правит всё. */
  privileged: boolean;
  /** Автор элементов отправителя; null — неизвестен (при защите новые элементы такого отправителя не принимаются). */
  principal: string | null;
  /** Защита чужих элементов включена (permissions.protectElements). */
  protect: boolean;
}

export interface GuardResult {
  patch: BoardPatch;
  refused: {
    /** Элементы, правка или удаление которых отклонены (их отправителю возвращают как есть у хаба). */
    ids: string[];
    /** Отклонена смена порядка слоёв. */
    order: boolean;
    /** Отклонена смена настроек страницы (сетка, фон, подписи осей). */
    page: boolean;
  };
}

const isTask = (el: Element | undefined): el is TaskEl & Element => !!el && el.type === 'task';

/** Элемент с автором by (undefined — без поля: элемент владельца). Тот же объект, если автор не меняется. */
export function withBy(el: Element, by: string | undefined): Element {
  if (el.by === by) return el;
  if (by === undefined) {
    const { by: _b, ...rest } = el;
    return rest as Element;
  }
  return { ...el, by } as Element;
}

/** Чужой ли элемент для отправителя. */
export function isForeign(el: Element, who: GuardWho): boolean {
  return !who.privileged && el.by !== (who.principal ?? undefined);
}

/**
 * Элемент от участника поверх известного хабу; null — правка отклонена.
 * Владелец: у задания ввод учеников остаётся хабу (mergeHostTask), автор известного элемента не меняется.
 * Участник: новый элемент получает его автора; задание — только ввод ученика (mergeGuestTask); при защите
 * чужой элемент не меняется; автор известного элемента не меняется никогда.
 */
export function guardElementPut(known: Element | undefined, incoming: Element, who: GuardWho): Element | null {
  if (who.privileged) {
    if (!known) return incoming;
    const merged = isTask(known) && isTask(incoming) ? mergeHostTask(known, incoming) as Element : incoming;
    return withBy(merged, known.by);
  }
  // автор неизвестен (REST без сессии): без защиты элемент принимается как элемент владельца, с защитой — нет
  if (!known) return who.principal ? withBy(incoming, who.principal) : who.protect ? null : withBy(incoming, undefined);
  if (isTask(known) && isTask(incoming)) return withBy(mergeGuestTask(known, incoming) as Element, known.by);
  if (who.protect && isForeign(known, who)) {
    // без изменений (полный проект несёт и чужие элементы) — не правка
    const { by: _a, ...k } = known;
    const { by: _b, ...i } = incoming;
    return same(k, i) ? known : null;
  }
  return withBy(incoming, known.by);
}

/** Чужие элементы в порядке слоёв. */
function foreignOrder(els: readonly Element[], who: GuardWho): string[] {
  return els.filter(e => isForeign(e, who)).map(e => e.id);
}

/** Порядок слоёв после операции order (как applyBoardPatch: названные — по порядку, остальные — сверху). */
function orderAfter(els: readonly Element[], ids: readonly string[]): Element[] {
  const byId = new Map(els.map(e => [e.id, e]));
  const ordered: Element[] = [];
  for (const id of ids) {
    const e = byId.get(id);
    if (e) { ordered.push(e); byId.delete(id); }
  }
  return [...ordered, ...els.filter(e => byId.has(e.id))];
}

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

/** Патч страницы от участника → разрешённая часть и что отклонено. Элементы в put уже очищены sanitizeElement. */
export function guardPatch(known: Page, patch: BoardPatch, who: GuardWho): GuardResult {
  const byId = new Map(known.elements.map(e => [e.id, e]));
  const refused: GuardResult['refused'] = { ids: [], order: false, page: false };
  const ops: ElementOp[] = [];
  const guarded = !who.privileged && who.protect;
  for (const op of patch.ops) {
    if (op.op === 'put') {
      const el = guardElementPut(byId.get(op.el.id), op.el, who);
      if (el) ops.push({ op: 'put', el });
      else refused.ids.push(op.el.id);
    } else if (op.op === 'del') {
      const k = byId.get(op.id);
      if (guarded && k && isForeign(k, who)) refused.ids.push(op.id);
      else ops.push(op);
    } else if (op.op === 'order') {
      if (guarded && !sameList(foreignOrder(orderAfter(known.elements, op.ids), who), foreignOrder(known.elements, who))) refused.order = true;
      else ops.push(op);
    }
  }
  const out: BoardPatch = { ...patch, ops };
  if (guarded && (patch.grid !== undefined || patch.backgroundColor !== undefined || patch.coordLabels !== undefined)) {
    // сетка, фон и подписи осей — оформление материала владельца
    delete out.grid;
    delete out.backgroundColor;
    delete out.coordLabels;
    refused.page = true;
  }
  return { patch: out, refused };
}

/**
 * Страница целиком от участника (полный проект) поверх известной хабу. Без защиты — как раньше (страница
 * участника), но задания и авторы элементов — хаба. С защитой чужие элементы остаются как у хаба: на своих местах
 * и в своём взаимном порядке, удалённые возвращаются; настройки и имя страницы — хаба. refused — что-то не принято.
 */
export function guardPageReplace(known: Page, incoming: Page, who: GuardWho): { page: Page; refused: boolean } {
  const byId = new Map(known.elements.map(e => [e.id, e]));
  let refused = false;
  const guarded = !who.privileged && who.protect;
  const els: Element[] = [];
  for (const el of incoming.elements) {
    const k = byId.get(el.id);
    const g = guardElementPut(k, el, who);
    if (g) els.push(g);
    else {
      refused = true;
      if (k) els.push(k);
    }
  }
  if (guarded) {
    // удалённые чужие элементы возвращаются после ближайшего предшественника, который остался
    const present = new Set(els.map(e => e.id));
    for (let i = 0; i < known.elements.length; i++) {
      const k = known.elements[i];
      if (present.has(k.id) || !isForeign(k, who)) continue;
      refused = true;
      let at = 0;
      for (let j = i - 1; j >= 0; j--) {
        const p = els.findIndex(e => e.id === known.elements[j].id);
        if (p >= 0) { at = p + 1; break; }
      }
      els.splice(at, 0, k);
      present.add(k.id);
    }
    // взаимный порядок чужих — как у хаба: их места в списке заполняются ими в прежнем порядке
    const want = foreignOrder(known.elements, who);
    if (!sameList(foreignOrder(els, who), want)) {
      refused = true;
      const queue = want.map(id => byId.get(id)!);
      for (let i = 0; i < els.length; i++) if (isForeign(els[i], who)) els[i] = queue.shift()!;
    }
  }
  if (!guarded) return { page: { ...incoming, elements: els }, refused };
  const settingsChanged = incoming.name !== known.name || incoming.grid !== known.grid
    || incoming.backgroundColor !== known.backgroundColor || incoming.coordLabels !== known.coordLabels;
  return { page: { ...known, elements: els }, refused: refused || settingsChanged };
}
