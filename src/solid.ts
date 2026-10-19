import type { Handle, HandlePos, SolidEl, SolidKind } from './types';

// Стереометрические тела: каркас в параллельной проекции, невидимое — пунктиром.
// Многогранники строятся в 3D (X — вправо, Y — вверх, Z — вглубь) и проецируются
// кабинетной проекцией; видимость ребра — по ориентации соседних граней.
// Тела вращения рисуются как в учебнике: основания — горизонтальные эллипсы.

type V2 = { x: number; y: number };
type V3 = [number, number, number];

/** Кабинетная проекция: глубина уходит вправо-вверх под 45° с сокращением 0.5. */
const OBL_K = 0.5;
const KC = OBL_K * Math.SQRT1_2;
const KS = OBL_K * Math.SQRT1_2;
/** Направление на зрителя: точки вдоль (-KC, -KS, 1) проецируются в одну точку. */
const VIEW: V3 = normalize([KC, KS, -1]);

export const SOLID_MIN = 8;
const T_MIN = 0.05;
const T_MAX = 0.95;
export const SIDES_MIN = 3;
export const SIDES_MAX = 8;

export const isRevolution = (k: SolidKind): boolean =>
  k === 'cylinder' || k === 'cone' || k === 'truncCone' || k === 'sphere';

/** У призмы и пирамид можно менять число сторон основания. */
export const hasBaseSides = (k: SolidKind): boolean =>
  k === 'prism' || k === 'pyramid' || k === 'truncPyramid';

/** Видимые линии рисуются сплошными, невидимые — пунктиром. Дуги — в параметрических углах эллипса. */
export type SolidPrim =
  | { k: 'seg'; x0: number; y0: number; x1: number; y1: number; hidden: boolean }
  | { k: 'arc'; cx: number; cy: number; rx: number; ry: number; a0: number; a1: number; hidden: boolean };

export interface SolidGeom {
  prims: SolidPrim[];
  /** Выпуклая оболочка проекции: попадание курсором и габариты. */
  hull: V2[];
}

function normalize(v: V3): V3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

// ----- Основание многогранника -----

interface Base { pts: [number, number][]; c: [number, number] }
const baseCache = new Map<number, Base>();

/**
 * Правильный n-угольник, вписанный в единичный квадрат (u — вправо, v — вглубь),
 * повёрнутый как в учебниках: при чётном n к зрителю обращена сторона (квадрат —
 * параллелограмм), при нечётном — вершина (у тетраэдра пунктиром только заднее ребро).
 * c — центр многоугольника (под вершиной пирамиды).
 */
function basePolygon(n: number): Base {
  let b = baseCache.get(n);
  if (b) return b;
  const raw: [number, number][] = [];
  const start = -Math.PI / 2 + (n % 2 === 0 ? Math.PI / n : 0);
  for (let i = 0; i < n; i++) {
    const a = start + (2 * Math.PI * i) / n;
    raw.push([Math.cos(a), Math.sin(a)]);
  }
  const xs = raw.map(p => p[0]), zs = raw.map(p => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
  const nu = (x: number) => (x - x0) / (x1 - x0);
  const nv = (z: number) => (z - z0) / (z1 - z0);
  b = { pts: raw.map(([x, z]) => [nu(x), nv(z)]), c: [nu(0), nv(0)] };
  baseCache.set(n, b);
  return b;
}

/** n — число сторон основания, t — отношение верхнего основания к нижнему (1 — призма, 0 — пирамида). */
function polyParams(el: SolidEl): { n: number; t: number } {
  const n = Math.round(Math.min(SIDES_MAX, Math.max(SIDES_MIN, el.n ?? 4)));
  switch (el.solid) {
    case 'prism': return { n: el.n ? n : 3, t: 1 };
    case 'pyramid': return { n, t: 0 };
    case 'truncPyramid': return { n, t: clampT(el.t ?? 0.5) };
    default: return { n: 4, t: 1 }; // куб и параллелепипед
  }
}

const clampT = (t: number): number => Math.min(T_MAX, Math.max(T_MIN, t));

/** Число сторон основания с учётом значения по умолчанию. */
export const solidSides = (el: SolidEl): number => polyParams(el).n;

interface Mesh { v: V3[]; f: number[][] }

function polyMesh(el: SolidEl): Mesh {
  const { n, t } = polyParams(el);
  const { pts, c } = basePolygon(n);
  const { w, d, h } = el;
  const cx = c[0] * w, cz = c[1] * d;
  const v: V3[] = pts.map(([u, q]) => [u * w, 0, q * d]);
  const f: number[][] = [[...Array(n).keys()]];
  if (t === 0) {
    v.push([cx, h, cz]);
    for (let i = 0; i < n; i++) f.push([i, (i + 1) % n, n]);
  } else {
    for (const [u, q] of pts) v.push([cx + (u * w - cx) * t, h, cz + (q * d - cz) * t]);
    f.push(pts.map((_, i) => n + i));
    for (let i = 0; i < n; i++) f.push([i, (i + 1) % n, n + (i + 1) % n, n + i]);
  }
  return { v, f };
}

/** Проекция 3D-точки многогранника в сцену. */
function proj(el: SolidEl, p: V3): V2 {
  return { x: el.x + p[0] + p[2] * KC, y: el.y - p[1] - p[2] * KS };
}

function polyGeometry(el: SolidEl): SolidGeom {
  const { v, f } = polyMesh(el);
  const centroid: V3 = [0, 0, 0];
  for (const p of v) { centroid[0] += p[0] / v.length; centroid[1] += p[1] / v.length; centroid[2] += p[2] / v.length; }
  // ребро видно, если видна хотя бы одна из прилегающих граней
  const edges = new Map<string, { a: number; b: number; front: boolean }>();
  for (const face of f) {
    // нормаль по Ньюэллу, ориентированная наружу (тело выпуклое)
    const nm: V3 = [0, 0, 0];
    const fc: V3 = [0, 0, 0];
    for (let i = 0; i < face.length; i++) {
      const p = v[face[i]], q = v[face[(i + 1) % face.length]];
      nm[0] += (p[1] - q[1]) * (p[2] + q[2]);
      nm[1] += (p[2] - q[2]) * (p[0] + q[0]);
      nm[2] += (p[0] - q[0]) * (p[1] + q[1]);
      fc[0] += p[0] / face.length; fc[1] += p[1] / face.length; fc[2] += p[2] / face.length;
    }
    const out = (fc[0] - centroid[0]) * nm[0] + (fc[1] - centroid[1]) * nm[1] + (fc[2] - centroid[2]) * nm[2];
    const nn = normalize(out < 0 ? [-nm[0], -nm[1], -nm[2]] : nm);
    // грань «ребром» к зрителю считаем видимой: её рёбра лежат на контуре
    const front = nn[0] * VIEW[0] + nn[1] * VIEW[1] + nn[2] * VIEW[2] > -1e-6;
    for (let i = 0; i < face.length; i++) {
      const a = face[i], b = face[(i + 1) % face.length];
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      const e = edges.get(key);
      if (e) e.front ||= front;
      else edges.set(key, { a, b, front });
    }
  }
  const pv = v.map(p => proj(el, p));
  const prims: SolidPrim[] = [];
  for (const e of edges.values()) {
    const a = pv[e.a], b = pv[e.b];
    prims.push({ k: 'seg', x0: a.x, y0: a.y, x1: b.x, y1: b.y, hidden: !e.front });
  }
  return { prims, hull: convexHull(pv) };
}

// ----- Тела вращения -----

/** Отношение верхнего основания к нижнему: 1 — цилиндр, 0 — конус. */
function revolutionT(el: SolidEl): number {
  if (el.solid === 'cylinder') return 1;
  if (el.solid === 'cone') return 0;
  return clampT(el.t ?? 0.5);
}

function revolutionGeometry(el: SolidEl): SolidGeom {
  const cx = el.x, cy = el.y;
  const rx = el.w / 2;
  const prims: SolidPrim[] = [];
  const full = (x: number, y: number, a: number, b: number): SolidPrim =>
    ({ k: 'arc', cx: x, cy: y, rx: a, ry: b, a0: 0, a1: Math.PI * 2, hidden: false });
  if (el.solid === 'sphere') {
    // контур шара и экватор: передняя половина видна, задняя — пунктиром
    const ry = Math.min(el.d / 2, rx);
    prims.push(full(cx, cy, rx, rx));
    prims.push({ k: 'arc', cx, cy, rx, ry, a0: 0, a1: Math.PI, hidden: false });
    prims.push({ k: 'arc', cx, cy, rx, ry, a0: Math.PI, a1: Math.PI * 2, hidden: true });
    return { prims, hull: hullOf(prims) };
  }
  const ry = el.d / 2;
  const h = el.h;
  const t = revolutionT(el);
  const ty = cy - h;
  // смотрим сверху: верхнее основание видно целиком, у нижнего — только передняя дуга
  // между точками касания образующих контура
  let tr = 0, tl = Math.PI;
  let silhouette = true;
  if (t < 1) {
    const apexH = h / (1 - t); // высота полного конуса
    if (apexH > ry) {
      const a = Math.asin(ry / apexH);
      tr = -a;
      tl = Math.PI + a;
    } else {
      silhouette = false; // вершина проецируется внутрь основания — контур = основание
    }
  }
  if (silhouette) {
    for (const ang of [tr, tl]) {
      const bx = cx + rx * Math.cos(ang), by = cy + ry * Math.sin(ang);
      if (t === 0) {
        prims.push({ k: 'seg', x0: bx, y0: by, x1: cx, y1: ty, hidden: false });
      } else {
        // точка касания на верхнем основании — образ нижней при гомотетии с центром в вершине
        prims.push({ k: 'seg', x0: bx, y0: by, x1: cx + rx * t * Math.cos(ang), y1: ty + ry * t * Math.sin(ang), hidden: false });
      }
    }
    prims.push({ k: 'arc', cx, cy, rx, ry, a0: tr, a1: tl, hidden: false });
    prims.push({ k: 'arc', cx, cy, rx, ry, a0: tl, a1: tr + Math.PI * 2, hidden: true });
  } else {
    prims.push(full(cx, cy, rx, ry));
  }
  if (t > 0) prims.push(full(cx, ty, rx * t, ry * t));
  // вершина конуса входит в оболочку, даже когда образующих на контуре нет
  return { prims, hull: hullOf(prims, [{ x: cx, y: ty }]) };
}

// ----- Общее -----

const geomCache = new WeakMap<SolidEl, SolidGeom>();

/** Геометрия тела (элементы иммутабельны — кэшируем по объекту). */
export function solidGeometry(el: SolidEl): SolidGeom {
  let g = geomCache.get(el);
  if (!g) {
    g = isRevolution(el.solid) ? revolutionGeometry(el) : polyGeometry(el);
    geomCache.set(el, g);
  }
  return g;
}

function hullOf(prims: SolidPrim[], extra: V2[] = []): V2[] {
  const pts: V2[] = extra.slice();
  for (const p of prims) {
    if (p.k === 'seg') {
      pts.push({ x: p.x0, y: p.y0 }, { x: p.x1, y: p.y1 });
    } else {
      const steps = 24;
      for (let i = 0; i <= steps; i++) {
        const a = p.a0 + ((p.a1 - p.a0) * i) / steps;
        pts.push({ x: p.cx + p.rx * Math.cos(a), y: p.cy + p.ry * Math.sin(a) });
      }
    }
  }
  return convexHull(pts);
}

function convexHull(input: V2[]): V2[] {
  const p = input.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const cross = (o: V2, a: V2, b: V2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: V2[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: V2[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

// ----- Ручки параметров -----

type ParamKey = Extract<Handle, { kind: 'param' }>['key'];

/**
 * Ручка параметра: позиция линейна по параметру — pos = s0 + value·v.
 * Так и обратное отображение (курсор → значение) получается проекцией на v.
 */
interface SolidHandle { key: ParamKey; s0: V2; v: V2; value: number; from?: V2 }

function solidHandleDefs(el: SolidEl): SolidHandle[] {
  if (el.solid === 'sphere') {
    const c = { x: el.x, y: el.y };
    return [
      { key: 'w', s0: c, v: { x: 0.5, y: 0 }, value: el.w, from: c },
      { key: 'd', s0: c, v: { x: 0, y: 0.5 }, value: Math.min(el.d, el.w) },
    ];
  }
  if (isRevolution(el.solid)) {
    const b = { x: el.x, y: el.y };
    const top = { x: el.x, y: el.y - el.h };
    const out: SolidHandle[] = [
      { key: 'w', s0: b, v: { x: 0.5, y: 0 }, value: el.w, from: b },
      { key: 'd', s0: b, v: { x: 0, y: 0.5 }, value: el.d },
      { key: 'h', s0: b, v: { x: 0, y: -1 }, value: el.h, from: b },
    ];
    if (el.solid === 'truncCone') out.push({ key: 't', s0: top, v: { x: el.w / 2, y: 0 }, value: revolutionT(el), from: top });
    return out;
  }
  if (el.solid === 'cube') {
    // одна ручка в переднем правом верхнем углу: ребро меняется целиком
    return [{ key: 'a', s0: { x: el.x, y: el.y }, v: { x: 1, y: -1 }, value: el.w }];
  }
  const { n, t } = polyParams(el);
  const { pts, c } = basePolygon(n);
  const { w, d, h } = el;
  const cx = c[0] * w, cz = c[1] * d;
  // ширина — у самой правой (из них передней) вершины основания;
  // глубина — в середине самой дальней стороны (или у самой дальней вершины)
  let iw = 0;
  for (let i = 1; i < n; i++) {
    const [u, q] = pts[i];
    if (u > pts[iw][0] + 1e-9 || (Math.abs(u - pts[iw][0]) <= 1e-9 && q < pts[iw][1])) iw = i;
  }
  const back = pts.filter(p => p[1] > 1 - 1e-9).map(p => p[0]);
  const ud = (Math.min(...back) + Math.max(...back)) / 2;
  const [uw, qw] = pts[iw];
  const foot = proj(el, [cx, 0, cz]);
  const out: SolidHandle[] = [
    { key: 'w', s0: proj(el, [0, 0, qw * d]), v: { x: uw, y: 0 }, value: w },
    { key: 'd', s0: proj(el, [ud * w, 0, 0]), v: { x: KC, y: -KS }, value: d },
    { key: 'h', s0: foot, v: { x: 0, y: -1 }, value: h, from: foot },
  ];
  if (el.solid === 'truncPyramid') {
    // вершина верхнего основания над «широкой» вершиной нижнего
    const topC = proj(el, [cx, h, cz]);
    out.push({ key: 't', s0: topC, v: { x: uw * w - cx + (qw * d - cz) * KC, y: -(qw * d - cz) * KS }, value: t, from: topC });
  }
  return out;
}

export function solidHandles(el: SolidEl): HandlePos[] {
  return solidHandleDefs(el).map(sh => ({
    h: { kind: 'param', key: sh.key },
    x: sh.s0.x + sh.v.x * sh.value,
    y: sh.s0.y + sh.v.y * sh.value,
    from: sh.from,
  }));
}

/** Перетаскивание ручки параметра: el — оригинал, pt — курсор в сцене. */
export function applySolidParam(el: SolidEl, key: ParamKey, pt: V2): SolidEl {
  const sh = solidHandleDefs(el).find(s => s.key === key);
  if (!sh) return el;
  const len2 = sh.v.x * sh.v.x + sh.v.y * sh.v.y;
  if (len2 < 1e-9) return el;
  const val = ((pt.x - sh.s0.x) * sh.v.x + (pt.y - sh.s0.y) * sh.v.y) / len2;
  switch (key) {
    case 'a': {
      const a = Math.max(SOLID_MIN, val);
      return { ...el, w: a, d: a, h: a };
    }
    case 'w': {
      const w = Math.max(SOLID_MIN, val);
      // у тел вращения эллипс основания не шире самого основания
      return isRevolution(el.solid) ? { ...el, w, d: Math.min(el.d, w) } : { ...el, w };
    }
    case 'd':
      return { ...el, d: isRevolution(el.solid) ? Math.min(el.w, Math.max(4, val)) : Math.max(SOLID_MIN, val) };
    case 'h':
      return { ...el, h: Math.max(SOLID_MIN, val) };
    case 't':
      return { ...el, t: clampT(val) };
  }
}

// ----- Создание -----

/** Размер тела по клику без протягивания, px экрана. */
export const SOLID_CLICK_SIZE: Record<SolidKind, [number, number]> = {
  cube: [150, 150], box: [190, 150], prism: [170, 160], pyramid: [170, 180], truncPyramid: [170, 150],
  cylinder: [120, 170], cone: [130, 180], truncCone: [140, 160], sphere: [160, 160],
};

/** Куб и шар вписываются в квадрат — при протягивании пропорции фиксированы. */
export const solidKeepsAspect = (k: SolidKind): boolean => k === 'cube' || k === 'sphere';

/** Отношение глубины к ширине по умолчанию. */
const DEPTH_RATIO: Record<SolidKind, number> = {
  cube: 1, box: 0.7, prism: 0.9, pyramid: 1, truncPyramid: 1,
  cylinder: 0.32, cone: 0.32, truncCone: 0.32, sphere: 0.3,
};

/** Тело, вписанное в прямоугольник сцены (протягивание при создании). */
export function fitSolid(
  kind: SolidKind, x0: number, y0: number, x1: number, y1: number,
  style: { id: string; color: string; width: number },
): SolidEl {
  const rx0 = Math.min(x0, x1), ry0 = Math.min(y0, y1);
  const W = Math.max(SOLID_MIN * 2, Math.abs(x1 - x0));
  const H = Math.max(SOLID_MIN * 2, Math.abs(y1 - y0));
  const ry1 = ry0 + H;
  const base = { id: style.id, type: 'solid' as const, solid: kind, color: style.color, width: style.width };
  const rho = DEPTH_RATIO[kind];
  if (kind === 'sphere') {
    const s = Math.min(W, H);
    return { ...base, x: rx0 + W / 2, y: ry0 + H / 2, w: s, d: s * rho, h: s };
  }
  if (isRevolution(kind)) {
    const ry = (W * rho) / 2;
    const t = kind === 'cylinder' ? 1 : kind === 'cone' ? 0 : 0.5;
    const h = Math.max(SOLID_MIN, H - ry * (1 + t));
    return { ...base, x: rx0 + W / 2, y: ry1 - ry, w: W, d: W * rho, h, ...(kind === 'truncCone' ? { t } : {}) };
  }
  if (kind === 'cube') {
    const a = Math.min(W / (1 + KC), H / (1 + KS));
    return { ...base, x: rx0, y: ry1, w: a, d: a, h: a };
  }
  const n = kind === 'prism' ? 3 : 4;
  const t = kind === 'pyramid' ? 0 : kind === 'truncPyramid' ? 0.5 : 1;
  const { pts, c } = basePolygon(n);
  // ширина проекции линейна по масштабу основания: подбираем масштаб под W
  let minX = Infinity, maxX = -Infinity;
  for (const [u, q] of pts) {
    const x = u + q * rho * KC;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
  }
  const s = W / (maxX - minX);
  const w = s, d = s * rho;
  // верх проекции: верхнее основание (или вершина) на высоте h, его дальняя точка поднята на z·KS
  const cz = c[1] * d;
  const topZ = cz + (d - cz) * t;
  const h = Math.max(SOLID_MIN, H - topZ * KS);
  return {
    ...base, x: rx0 - minX * s, y: ry1, w, d, h,
    ...(kind === 'prism' || kind === 'pyramid' || kind === 'truncPyramid' ? { n } : {}),
    ...(kind === 'truncPyramid' ? { t } : {}),
  };
}
