// Проверка обновлений: последний релиз на GitHub против версии приложения. Сами обновления
// не ставим — предлагаем скачать файл для своей платформы (см. update-notice.ts).

export const REPO = 'MotoIlyuha/Abax';
export const REPO_URL = `https://github.com/${REPO}`;
/** Последний опубликованный релиз (черновики и предварительные GitHub сюда не отдаёт). */
export const LATEST_RELEASE_API = `https://api.github.com/repos/${REPO}/releases/latest`;

/** Где запущено приложение: от этого зависит, какой файл релиза предлагать. */
export type UpdatePlatform = 'win-setup' | 'win-portable' | 'android' | 'web' | 'desktop';

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

/** Поля ответа GitHub API, которые нам нужны. */
export interface Release {
  tag_name: string;
  name?: string | null;
  body?: string | null;
  html_url: string;
  published_at?: string | null;
  assets?: ReleaseAsset[];
}

export interface UpdateInfo {
  version: string;
  /** Страница релиза на GitHub. */
  page: string;
  /** Файл для этой платформы; нет подходящего — страница релиза. */
  download: string;
  /** Имя файла для скачивания (null — ведём на страницу релиза). */
  file: string | null;
  publishedAt: number | null;
  notes: ReleaseNotes;
}

export interface ReleaseNotes {
  /** Вступление до первого заголовка. */
  summary: string;
  /** Пункты разделов «Новое», «Исправлено» и т.п. — без «Что скачать» и контрольных сумм. */
  items: string[];
}

/** «v2.1.0», «2.1.0» → [2, 1, 0]; не версия — null. */
export function parseVersion(v: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)(?:\.(\d+))?$/.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)] : null;
}

/** candidate новее current? Непонятные версии — не новее. */
export function isNewer(candidate: string, current: string): boolean {
  const a = parseVersion(candidate), b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

/** Файл релиза под платформу (по именам, которые даёт сборка: «Abax.Setup.2.1.0.exe», «Abax.2.1.0.exe», «Abax-2.1.0.apk»). */
export function pickAsset(assets: ReleaseAsset[], platform: UpdatePlatform): ReleaseAsset | null {
  const test = (re: RegExp) => assets.find(a => re.test(a.name)) ?? null;
  switch (platform) {
    case 'win-setup': return test(/setup.*\.exe$/i);
    case 'win-portable': return assets.find(a => /\.exe$/i.test(a.name) && !/setup/i.test(a.name)) ?? null;
    case 'android': return test(/\.apk$/i);
    // веб-версию разворачивают у себя, macOS и Linux сборок нет — им страница релиза
    default: return null;
  }
}

/** Разделы описания релиза, которые в окне обновления не нужны. */
const SKIP_SECTION = /скачать|контрольн|checksum|sha-?256/i;

/** Что нового — из описания релиза (Markdown): вступление и пункты списков. */
export function releaseNotes(body: string | null | undefined): ReleaseNotes {
  const lines = (body ?? '').replace(/\r\n?/g, '\n').split('\n');
  const summary: string[] = [];
  const items: string[] = [];
  let section: string | null = null;
  let fence = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith('```')) { fence = !fence; continue; }
    if (fence) continue;
    const h = /^#{1,6}\s+(.*)$/.exec(line);
    if (h) { section = h[1]; continue; }
    if (section === null) {
      if (line) summary.push(line);
      continue;
    }
    if (SKIP_SECTION.test(section)) continue;
    const li = /^[-*+]\s+(.*)$/.exec(line);
    if (li) items.push(plainInline(li[1]));
  }
  return { summary: plainInline(summary.join(' ')), items };
}

/** Ссылки и код из Markdown — простым текстом; **жирное** остаётся (его рисует окно). */
function plainInline(s: string): string {
  return s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Строка с **жирным** — куски для вывода (textContent, без HTML). */
export function boldParts(s: string): { text: string; bold: boolean }[] {
  const out: { text: string; bold: boolean }[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let at = 0;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    if (m.index > at) out.push({ text: s.slice(at, m.index), bold: false });
    out.push({ text: m[1], bold: true });
    at = m.index + m[0].length;
  }
  if (at < s.length) out.push({ text: s.slice(at), bold: false });
  return out;
}

/** Релиз → обновление для этой платформы; не новее current — null. */
export function updateFromRelease(r: Release, current: string, platform: UpdatePlatform): UpdateInfo | null {
  if (!r || typeof r.tag_name !== 'string' || !isNewer(r.tag_name, current)) return null;
  const version = r.tag_name.replace(/^v/, '');
  const asset = pickAsset(Array.isArray(r.assets) ? r.assets : [], platform);
  const published = r.published_at ? Date.parse(r.published_at) : NaN;
  return {
    version,
    page: r.html_url,
    download: asset?.browser_download_url ?? r.html_url,
    file: asset?.name ?? null,
    publishedAt: Number.isFinite(published) ? published : null,
    notes: releaseNotes(r.body),
  };
}

const TIMEOUT_MS = 10_000;

/**
 * Последний релиз с GitHub → обновление (null — у нас последняя версия).
 * Нет сети, лимит запросов, странный ответ — исключение.
 */
export async function fetchUpdate(current: string, platform: UpdatePlatform, fetchImpl: typeof fetch = fetch): Promise<UpdateInfo | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(LATEST_RELEASE_API, { headers: { Accept: 'application/vnd.github+json' }, signal: ctrl.signal });
    // 404 — релизов ещё нет
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub: ${res.status}`);
    const r = await res.json() as Release;
    if (!r || typeof r.tag_name !== 'string') throw new Error('GitHub: неожиданный ответ');
    return updateFromRelease(r, current, platform);
  } finally {
    clearTimeout(timer);
  }
}

// ----- Настройки и память проверки: на этом устройстве -----

const PREFS_KEY = 'doska.updates';
/** Сами проверяем не чаще раза в сутки. */
export const CHECK_EVERY_MS = 24 * 60 * 60 * 1000;

export interface UpdatePrefs {
  /** Проверять при запуске. */
  auto: boolean;
  /** Когда проверка в последний раз удалась. */
  checkedAt?: number;
  /** «Пропустить эту версию»: о ней (и более старых) не напоминаем. */
  skip?: string;
}

export function updatePrefs(): UpdatePrefs {
  try {
    const v = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') as Partial<UpdatePrefs> | null;
    return {
      auto: typeof v?.auto === 'boolean' ? v.auto : true,
      ...(typeof v?.checkedAt === 'number' ? { checkedAt: v.checkedAt } : {}),
      ...(typeof v?.skip === 'string' ? { skip: v.skip } : {}),
    };
  } catch {
    return { auto: true };
  }
}

export function setUpdatePrefs(patch: Partial<UpdatePrefs>): UpdatePrefs {
  const next = { ...updatePrefs(), ...patch };
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch { /* не запомнится */ }
  return next;
}

/** Пора ли проверить при запуске. */
export function autoCheckDue(prefs: UpdatePrefs, now = Date.now()): boolean {
  return prefs.auto && (prefs.checkedAt === undefined || now - prefs.checkedAt >= CHECK_EVERY_MS || prefs.checkedAt > now);
}

/** Напоминать ли об этой версии при автоматической проверке. */
export function shouldNotify(info: UpdateInfo, prefs: UpdatePrefs): boolean {
  return !prefs.skip || isNewer(info.version, prefs.skip);
}
