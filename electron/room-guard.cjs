// Защита чужих элементов для хаба Electron — зеркало src/element-guard.ts (Ночь №6, SPEC_NIGHT6 §4).
// Паритет с TypeScript-версией проверяет tests/server/room-pointer.test.ts.

const tasks = require('./room-tasks.cjs');

const isTask = el => !!el && el.type === 'task';

/** Структурное равенство (ключи со значением undefined — всё равно что отсутствующие), как same в src/delta.ts. */
function same(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((v, i) => same(v, b[i]));
  const ka = Object.keys(a).filter(k => a[k] !== undefined);
  const kb = Object.keys(b).filter(k => b[k] !== undefined);
  if (ka.length !== kb.length) return false;
  return ka.every(k => same(a[k], b[k]));
}

/** Элемент с автором by (undefined — без поля: элемент владельца). */
function withBy(el, by) {
  if (el.by === by) return el;
  if (by === undefined) {
    const { by: _b, ...rest } = el;
    return rest;
  }
  return { ...el, by };
}

const isForeign = (el, who) => !who.privileged && el.by !== (who.principal || undefined);

/** Элемент от участника поверх известного хабу; null — правка отклонена (зеркало guardElementPut). */
function guardElementPut(known, incoming, who) {
  if (who.privileged) {
    if (!known) return incoming;
    const merged = isTask(known) && isTask(incoming) ? tasks.mergeHostTask(known, incoming) : incoming;
    return withBy(merged, known.by);
  }
  if (!known) return who.principal ? withBy(incoming, who.principal) : who.protect ? null : withBy(incoming, undefined);
  if (isTask(known) && isTask(incoming)) return withBy(tasks.mergeGuestTask(known, incoming), known.by);
  if (who.protect && isForeign(known, who)) {
    const { by: _a, ...k } = known;
    const { by: _b, ...i } = incoming;
    return same(k, i) ? known : null;
  }
  return withBy(incoming, known.by);
}

const foreignOrder = (els, who) => els.filter(e => isForeign(e, who)).map(e => e.id);

function orderAfter(els, ids) {
  const byId = new Map(els.map(e => [e.id, e]));
  const ordered = [];
  for (const id of ids) {
    const e = byId.get(id);
    if (e) { ordered.push(e); byId.delete(id); }
  }
  return [...ordered, ...els.filter(e => byId.has(e.id))];
}

const sameList = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

/** Патч страницы от участника → разрешённая часть и что отклонено (зеркало guardPatch). */
function guardPatch(known, patch, who) {
  const byId = new Map(known.elements.map(e => [e.id, e]));
  const refused = { ids: [], order: false, page: false };
  const ops = [];
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
  const out = { ...patch, ops };
  if (guarded && (patch.grid !== undefined || patch.backgroundColor !== undefined || patch.coordLabels !== undefined)) {
    delete out.grid;
    delete out.backgroundColor;
    delete out.coordLabels;
    refused.page = true;
  }
  return { patch: out, refused };
}

/** Страница целиком от участника поверх известной хабу (зеркало guardPageReplace). */
function guardPageReplace(known, incoming, who) {
  const byId = new Map(known.elements.map(e => [e.id, e]));
  let refused = false;
  const guarded = !who.privileged && who.protect;
  const els = [];
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
    const want = foreignOrder(known.elements, who);
    if (!sameList(foreignOrder(els, who), want)) {
      refused = true;
      const queue = want.map(id => byId.get(id));
      for (let i = 0; i < els.length; i++) if (isForeign(els[i], who)) els[i] = queue.shift();
    }
  }
  if (!guarded) return { page: { ...incoming, elements: els }, refused };
  const settingsChanged = incoming.name !== known.name || incoming.grid !== known.grid
    || incoming.backgroundColor !== known.backgroundColor || incoming.coordLabels !== known.coordLabels;
  return { page: { ...known, elements: els }, refused: refused || settingsChanged };
}

module.exports = { withBy, isForeign, guardElementPut, guardPatch, guardPageReplace };
