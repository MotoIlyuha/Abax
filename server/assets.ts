import { createHash } from 'node:crypto';
import { assetHashOf } from '../src/asset-store';
import type { Element, Page, Project } from '../src/types';
import { requireUser } from './auth';
import type { AppContext } from './context';
import { HttpError, type Router } from './router';

// Картинки проектов по хэшу содержимого: POST /api/assets, GET /api/assets/:hash.
// Хэш — SHA-256 от всей строки data URL (как computeAssetHash на клиенте); строка хранится как есть,
// чтобы клиент мог проверить хэш бит-в-бит, а байты для <img> отдаются декодированными.

export const MAX_ASSET_BYTES = 15 * 1024 * 1024;
/** Тело POST: data URL в base64 на треть длиннее байтов + оболочка JSON. */
const MAX_ASSET_BODY = Math.ceil(MAX_ASSET_BYTES * 4 / 3) + 4096;
const HASH_RE = /^[0-9a-f]{64}$/;
/** Типы, которые можно показывать прямо из ответа; всё остальное (например, SVG со скриптами) — только скачивание. */
const INLINE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']);
const MIME_RE = /^image\/[a-z0-9][a-z0-9.+-]{0,63}$/;
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

export interface ParsedDataUrl { mime: string; bytes: Buffer }

/** Разбор data:image/…[;параметры][;base64],…; null — это не картинка в data URL. */
export function parseDataUrl(s: string): ParsedDataUrl | null {
  if (!s.startsWith('data:')) return null;
  const comma = s.indexOf(',');
  if (comma < 0) return null;
  const meta = s.slice(5, comma).split(';').map(x => x.trim().toLowerCase());
  const mime = meta[0];
  if (!MIME_RE.test(mime)) return null;
  const payload = s.slice(comma + 1);
  if (meta.includes('base64')) {
    if (!BASE64_RE.test(payload)) return null;
    return { mime, bytes: Buffer.from(payload, 'base64') };
  }
  try { return { mime, bytes: Buffer.from(decodeURIComponent(payload), 'latin1') }; } catch { return null; }
}

export const hashOfDataUrl = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

/** Сохраняет картинку (строку data URL) в хранилище и таблицу assets; повтор — дедупликация. Ошибка — HttpError. */
export async function storeDataUrl(app: AppContext, dataUrl: string, userId: string | null): Promise<{ hash: string; deduplicated: boolean }> {
  if (dataUrl.length > MAX_ASSET_BODY) throw new HttpError(413, 'asset-too-large');
  if (!dataUrl.startsWith('data:')) throw new HttpError(400, 'bad-asset');
  if (!/^data:image\//i.test(dataUrl)) throw new HttpError(415, 'unsupported-media');
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) throw new HttpError(400, 'bad-asset');
  if (parsed.bytes.length > MAX_ASSET_BYTES) throw new HttpError(413, 'asset-too-large');
  const hash = hashOfDataUrl(dataUrl);
  const known = app.db.prepare('SELECT hash FROM assets WHERE hash = ?').get(hash);
  const stored = known ? await app.assets.exists(hash) : false;
  if (!stored) await app.assets.put(hash, Buffer.from(dataUrl, 'utf8'), parsed.mime);
  if (!known) {
    app.db.prepare('INSERT OR IGNORE INTO assets (hash, mime_type, size_bytes, storage_backend, storage_key, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(hash, parsed.mime, parsed.bytes.length, app.assets.kind, `${hash.slice(0, 2)}/${hash}`, userId, app.now());
  }
  return { hash, deduplicated: !!known };
}

/**
 * Картинки проекта, пришедшие внутри JSON (data:image/…), выносятся в хранилище и заменяются ссылками asset://;
 * чужие адреса и неизвестные схемы в src картинки стираются. Нетронутый проект — тот же объект.
 */
export async function ingestProjectImages(app: AppContext, project: Project, userId: string | null): Promise<Project> {
  const cache = new Map<string, string>();
  const fix = async (el: Element): Promise<Element> => {
    if (el.type !== 'image' || el.src === '' || assetHashOf(el.src)) return el;
    let src = cache.get(el.src);
    if (src === undefined) {
      if (/^data:image\//i.test(el.src)) {
        try { src = `asset://${(await storeDataUrl(app, el.src, userId)).hash}`; } catch (e) {
          if (e instanceof HttpError && e.status === 413) throw e;
          src = '';
        }
      } else src = '';
      cache.set(el.src, src);
    }
    return { ...el, src };
  };
  let changed = false;
  const pages: Page[] = [];
  for (const pg of project.pages) {
    const els: Element[] = [];
    let pgChanged = false;
    for (const el of pg.elements) { const n = await fix(el); if (n !== el) pgChanged = true; els.push(n); }
    if (pgChanged) changed = true;
    pages.push(pgChanged ? { ...pg, elements: els } : pg);
  }
  return changed ? { ...project, pages } : project;
}

/** Элементы операций патча: то же, что ingestProjectImages, для put. */
export async function ingestElement(app: AppContext, el: Element, userId: string | null): Promise<Element> {
  const probe: Project = { id: 'x', name: 'x', createdAt: 0, updatedAt: 0, pages: [{ id: 'x', name: 'x', grid: 'none', elements: [el] }] };
  return (await ingestProjectImages(app, probe, userId)).pages[0].elements[0];
}

export function registerAssetRoutes(router: Router): void {
  router.post('/api/assets', async ctx => {
    const user = requireUser(ctx);
    const body = await ctx.body() as { dataUrl?: unknown } | undefined;
    if (typeof body?.dataUrl !== 'string') throw new HttpError(400, 'bad-asset');
    const { hash, deduplicated } = await storeDataUrl(ctx.app, body.dataUrl, user.id);
    return { status: deduplicated ? 200 : 201, json: { hash, uri: `asset://${hash}`, deduplicated } };
  }, { maxBody: MAX_ASSET_BODY });

  router.get('/api/assets/:hash', async ctx => {
    const hash = ctx.params.hash;
    if (!HASH_RE.test(hash)) throw new HttpError(400, 'bad-hash');
    const row = ctx.app.db.prepare('SELECT mime_type FROM assets WHERE hash = ?').get(hash) as { mime_type: string } | undefined;
    const blob = row ? await ctx.app.assets.get(hash) : null;
    if (!row || !blob) throw new HttpError(404, 'asset-not-found');
    const common = {
      'Cache-Control': 'public, max-age=31536000, immutable',
      ETag: `"${hash}"`,
      'Content-Security-Policy': "default-src 'none'; sandbox",
    };
    const text = Buffer.from(blob.data).toString('utf8');
    if (ctx.query.get('format') === 'dataUrl') {
      return { body: text, headers: { ...common, 'Content-Type': 'text/plain; charset=utf-8' } };
    }
    const parsed = parseDataUrl(text);
    if (!parsed) throw new HttpError(404, 'asset-not-found');
    const inline = INLINE_TYPES.has(row.mime_type);
    return {
      body: parsed.bytes,
      headers: {
        ...common,
        'Content-Type': inline ? row.mime_type : 'application/octet-stream',
        ...(inline ? {} : { 'Content-Disposition': 'attachment' }),
      },
    };
  });
}
