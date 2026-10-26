import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHECK_EVERY_MS, LATEST_RELEASE_API, autoCheckDue, boldParts, fetchUpdate, isNewer, parseVersion, pickAsset,
  releaseNotes, setUpdatePrefs, shouldNotify, updateFromRelease, updatePrefs, type Release,
} from '../../src/updates';

const asset = (name: string) => ({ name, browser_download_url: `https://dl/${name}` });
/** Файлы, как в релизе 2.1.0. */
const ASSETS = ['Abax-2.1.0-web.zip', 'Abax-2.1.0.apk', 'Abax.2.1.0.exe', 'Abax.Setup.2.1.0.exe'].map(asset);

const BODY = `Удобнее работать с картинками.

## Что скачать

| Платформа | Файл |
|---|---|
| Windows — установщик | \`Abax.Setup.2.1.0.exe\` |

## Новое

- **Пропорциональный размер** — новая настройка.
* Пункт со [ссылкой](https://x.y) и \`кодом\`.

## Исправлено

- Ластик не стирает изображения.

## Контрольные суммы SHA-256

\`\`\`
e8e9  Abax.Setup.2.1.0.exe
- не пункт, а строка в блоке кода
\`\`\`
`;

const release = (tag: string, o: Partial<Release> = {}): Release => ({
  tag_name: tag, html_url: `https://github.com/r/${tag}`, body: BODY, published_at: '2026-10-24T13:25:28Z', assets: ASSETS, ...o,
});

describe('версии', () => {
  it('parseVersion: с «v» и без, без патча; не версия — null', () => {
    expect(parseVersion('v2.1.0')).toEqual([2, 1, 0]);
    expect(parseVersion(' 10.20.30 ')).toEqual([10, 20, 30]);
    expect(parseVersion('v3.1')).toEqual([3, 1, 0]);
    expect(parseVersion('Abax 2.1.0')).toBeNull();
    expect(parseVersion('v2.1.0-beta')).toBeNull();
    expect(parseVersion('')).toBeNull();
  });

  it('isNewer сравнивает числами, а не строками', () => {
    expect(isNewer('v2.1.1', '2.1.0')).toBe(true);
    expect(isNewer('v2.10.0', '2.9.9')).toBe(true);
    expect(isNewer('v3.0.0', '2.99.99')).toBe(true);
    expect(isNewer('v2.1.0', '2.1.0')).toBe(false);
    expect(isNewer('v2.0.9', '2.1.0')).toBe(false);
    expect(isNewer('nightly', '2.1.0')).toBe(false);
    expect(isNewer('v9.0.0', 'dev')).toBe(false);
  });
});

describe('файл релиза под платформу', () => {
  it('установщик, переносной exe, APK; вебу и прочим — ничего (страница релиза)', () => {
    expect(pickAsset(ASSETS, 'win-setup')?.name).toBe('Abax.Setup.2.1.0.exe');
    expect(pickAsset(ASSETS, 'win-portable')?.name).toBe('Abax.2.1.0.exe');
    expect(pickAsset(ASSETS, 'android')?.name).toBe('Abax-2.1.0.apk');
    expect(pickAsset(ASSETS, 'web')).toBeNull();
    expect(pickAsset(ASSETS, 'desktop')).toBeNull();
    expect(pickAsset([], 'android')).toBeNull();
    // порядок файлов в релизе не важен
    expect(pickAsset([...ASSETS].reverse(), 'win-portable')?.name).toBe('Abax.2.1.0.exe');
  });
});

describe('описание релиза', () => {
  it('вступление и пункты; «Что скачать», контрольные суммы и блоки кода — мимо', () => {
    expect(releaseNotes(BODY)).toEqual({
      summary: 'Удобнее работать с картинками.',
      items: ['**Пропорциональный размер** — новая настройка.', 'Пункт со ссылкой и кодом.', 'Ластик не стирает изображения.'],
    });
    expect(releaseNotes(null)).toEqual({ summary: '', items: [] });
    expect(releaseNotes('Строка один\r\nи два')).toEqual({ summary: 'Строка один и два', items: [] });
  });

  it('boldParts: жирное отдельными кусками', () => {
    expect(boldParts('**Ластик** не стирает **картинки**.')).toEqual([
      { text: 'Ластик', bold: true }, { text: ' не стирает ', bold: false }, { text: 'картинки', bold: true }, { text: '.', bold: false },
    ]);
    expect(boldParts('просто')).toEqual([{ text: 'просто', bold: false }]);
    expect(boldParts('')).toEqual([]);
  });
});

describe('обновление из релиза', () => {
  it('новее — версия, файл, дата и что нового; не новее — null', () => {
    const u = updateFromRelease(release('v2.2.0'), '2.1.0', 'android')!;
    expect(u).toMatchObject({
      version: '2.2.0', page: 'https://github.com/r/v2.2.0', download: 'https://dl/Abax-2.1.0.apk', file: 'Abax-2.1.0.apk',
      publishedAt: Date.parse('2026-10-24T13:25:28Z'),
    });
    expect(u.notes.items).toHaveLength(3);
    expect(updateFromRelease(release('v2.1.0'), '2.1.0', 'android')).toBeNull();
  });

  it('нет файла под платформу или даты — страница релиза, без даты', () => {
    const u = updateFromRelease(release('v2.2.0', { assets: undefined, published_at: null, body: undefined }), '2.1.0', 'win-setup')!;
    expect(u).toMatchObject({ download: 'https://github.com/r/v2.2.0', file: null, publishedAt: null, notes: { summary: '', items: [] } });
  });
});

describe('запрос к GitHub', () => {
  const reply = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

  it('последний релиз; заголовок API GitHub', async () => {
    const f = reply(200, release('v9.0.0'));
    const u = await fetchUpdate('2.1.0', 'win-setup', f as unknown as typeof fetch);
    expect(u?.file).toBe('Abax.Setup.2.1.0.exe');
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(LATEST_RELEASE_API);
    expect(init.headers).toEqual({ Accept: 'application/vnd.github+json' });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('релизов нет (404) — null; лимит, ошибка сервера, странный ответ, нет сети — исключение', async () => {
    expect(await fetchUpdate('2.1.0', 'web', reply(404, { message: 'Not Found' }) as unknown as typeof fetch)).toBeNull();
    await expect(fetchUpdate('2.1.0', 'web', reply(403, { message: 'rate limit' }) as unknown as typeof fetch)).rejects.toThrow('403');
    await expect(fetchUpdate('2.1.0', 'web', reply(500, {}) as unknown as typeof fetch)).rejects.toThrow('500');
    await expect(fetchUpdate('2.1.0', 'web', reply(200, { hello: 1 }) as unknown as typeof fetch)).rejects.toThrow('неожиданный');
    const offline = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    await expect(fetchUpdate('2.1.0', 'web', offline as unknown as typeof fetch)).rejects.toThrow('Failed to fetch');
  });
});

describe('настройки и память проверки', () => {
  beforeEach(() => localStorage.clear());

  it('по умолчанию проверяем; изменения сохраняются; битые данные — по умолчанию', () => {
    expect(updatePrefs()).toEqual({ auto: true });
    setUpdatePrefs({ checkedAt: 5 });
    setUpdatePrefs({ skip: '2.2.0' });
    expect(updatePrefs()).toEqual({ auto: true, checkedAt: 5, skip: '2.2.0' });
    setUpdatePrefs({ auto: false });
    expect(updatePrefs().auto).toBe(false);
    localStorage.setItem('doska.updates', '{oops');
    expect(updatePrefs()).toEqual({ auto: true });
    localStorage.setItem('doska.updates', JSON.stringify({ auto: 'да', checkedAt: '1', skip: 2 }));
    expect(updatePrefs()).toEqual({ auto: true });
  });

  it('autoCheckDue: раз в сутки и только если включено; часы назад — проверяем', () => {
    const now = 10 * CHECK_EVERY_MS;
    expect(autoCheckDue({ auto: true }, now)).toBe(true);
    expect(autoCheckDue({ auto: true, checkedAt: now - 1000 }, now)).toBe(false);
    expect(autoCheckDue({ auto: true, checkedAt: now - CHECK_EVERY_MS }, now)).toBe(true);
    expect(autoCheckDue({ auto: false }, now)).toBe(false);
    expect(autoCheckDue({ auto: true, checkedAt: now + CHECK_EVERY_MS }, now)).toBe(true);
  });

  it('shouldNotify: пропущенную и более старые — нет, более новые — да', () => {
    const u = updateFromRelease(release('v2.2.0'), '2.1.0', 'web')!;
    expect(shouldNotify(u, { auto: true })).toBe(true);
    expect(shouldNotify(u, { auto: true, skip: '2.2.0' })).toBe(false);
    expect(shouldNotify(u, { auto: true, skip: '2.3.0' })).toBe(false);
    expect(shouldNotify(u, { auto: true, skip: '2.1.5' })).toBe(true);
  });
});
