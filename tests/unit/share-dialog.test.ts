// Окно «Поделиться» (SPEC_NIGHT6 §6): доступность, три раздельных списка, общая ссылка, почта, путь без облака.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiError, setApiForTests, type ApiClient } from '../../src/api-client';
import { closeShareDialog, openShareDialog, shareDialogOpen, type ShareApi, type ShareStatus } from '../../src/share-dialog';
import { PRESENCE_EVENT } from '../../src/collab';
import { clearServerPlan } from '../../src/plan';
import { openProject, state } from '../../src/state';
import { setSyncedRev } from '../../src/sync-state';
import type { Project } from '../../src/types';

const project = (): Project => ({
  id: 'p1', name: 'Физика 9А', createdAt: 1, updatedAt: 1,
  pages: [
    { id: 'g1', name: 'Теория', grid: 'square', elements: [] },
    { id: 'g2', name: 'Задачи', grid: 'square', elements: [] },
  ],
});

type Handler = (method: string, path: string, body: any) => unknown;
function fakeApi(handler: Handler): ApiClient & { calls: [string, string, any][] } {
  const calls: [string, string, any][] = [];
  return {
    base: 'http://api.test', calls,
    async request<T>(method: string, path: string, body?: unknown): Promise<T> {
      calls.push([method, path, body]);
      const r = handler(method, path, body);
      if (r instanceof Error) throw r;
      return r as T;
    },
    ensureSession: async () => 'tok', me: async () => { throw new Error('нет'); }, logout: async () => {},
  };
}

function shareApi(status: ShareStatus = { active: false }): ShareApi & { started: number } {
  const api = {
    started: 0,
    async shareStart() { api.started++; status = { active: true, url: 'http://192.168.1.5:4826/?room=ABCDEFGH', urls: [], users: [] }; return { ok: true, connected: true }; },
    async shareStop() { status = { active: false }; return { ok: true }; },
    async shareStatus() { return status; },
    async shareSetRights() { return { ok: true }; },
    async shareOpenTestWindow() { return { ok: true }; },
  };
  return api;
}
const deps = (api = shareApi()) => ({ api, saveNow: async () => {}, startHost: async () => {}, stopCollab: () => {} });
const flush = async (n = 3) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 0)); };
const dlg = () => document.getElementById('share-dialog')!;
const q = <T extends Element = HTMLElement>(sel: string) => dlg().querySelector<T>(sel)!;

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<button id="btn-share">Поделиться</button>';
  clearServerPlan();
  openProject(project());
  state.linkMode = null;
  state.collabRole = null;
});
afterEach(() => { closeShareDialog(); setApiForTests(undefined); });

describe('доступность', () => {
  it('диалог с заголовком, вкладки с aria-selected, стрелки и Home/End переключают вкладки', async () => {
    document.getElementById('btn-share')!.focus();
    await openShareDialog(deps());
    expect(dlg().getAttribute('role')).toBe('dialog');
    expect(dlg().getAttribute('aria-modal')).toBe('true');
    expect(document.getElementById(dlg().getAttribute('aria-labelledby')!)!.textContent).toBe('Поделиться: «Физика 9А»');
    const tabs = [...dlg().querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    expect(tabs.map(t => t.textContent)).toEqual(['Поделиться', 'Настройки доступа']);
    expect(tabs.map(t => t.getAttribute('aria-selected'))).toEqual(['true', 'false']);
    expect(document.activeElement).toBe(tabs[0]);
    tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    expect(q('#share-panel-share').hidden).toBe(true);
    expect(q('#share-panel-settings').hidden).toBe(false);
    expect(document.activeElement).toBe(tabs[1]);
    tabs[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
  });

  it('Esc закрывает окно и возвращает фокус на кнопку «Поделиться»; повторное открытие — переключатель', async () => {
    const opener = document.getElementById('btn-share')!;
    opener.focus();
    await openShareDialog(deps());
    dlg().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(shareDialogOpen()).toBe(false);
    expect(document.getElementById('share-dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
    await openShareDialog(deps());
    await openShareDialog(deps());
    expect(document.getElementById('share-dialog')).toBeNull();
  });

  it('Tab не выпускает фокус из окна', async () => {
    await openShareDialog(deps());
    const done = q<HTMLButtonElement>('.share-done');
    done.focus();
    const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    done.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(dlg().contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(done);
  });
});

describe('без облака', () => {
  it('путь без сервера — первым и развёрнут: «Включить совместную работу» запускает комнату, ссылка — кнопка', async () => {
    const api = shareApi();
    await openShareDialog(deps(api));
    expect(q('.share-invite').hidden).toBe(true);
    const panel = q('#share-panel-share');
    expect(panel.firstElementChild!.classList.contains('share-p2p')).toBe(true);
    expect(dlg().querySelector('.share-other')).toBeNull();
    const start = [...dlg().querySelectorAll('button')].find(b => b.textContent === 'Включить совместную работу')!;
    start.click();
    await flush(6);
    expect(api.started).toBe(1);
    const link = q<HTMLButtonElement>('.share-link');
    expect(link.tagName).toBe('BUTTON');
    expect(link.textContent).toBe('http://192.168.1.5:4826/?room=ABCDEFGH');
  });

  it('только 127.0.0.1 — предупреждение «только на этом компьютере»', async () => {
    await openShareDialog(deps(shareApi({ active: true, url: 'http://127.0.0.1:4826/?room=X', urls: [], localOnly: true, users: [] })));
    expect(dlg().textContent).toContain('Только на этом компьютере');
    expect(dlg().textContent).toContain('работает только на этом компьютере');
  });
});

describe('с облаком', () => {
  const inv = (over: Record<string, unknown> = {}) => ({ id: 'e1', projectId: 'p1', email: 'anna@mail.ru', role: 'editor', status: 'pending', createdAt: 1, updatedAt: 1, lastUsedAt: null, ...over });
  function cloud(opts: { link?: Record<string, unknown> | null; emails?: Record<string, unknown>[] } = {}) {
    setSyncedRev('p1', 3);
    let link: Record<string, unknown> | null = opts.link === undefined ? null : opts.link;
    let emails = opts.emails ?? [];
    const api = fakeApi((m, p, body) => {
      if (m === 'GET' && p.startsWith('/api/invites?')) return { invite: link };
      if (m === 'POST' && p === '/api/invites') {
        link = { token: 'TOKEN-AAAAAAAAAAAAAAAAAAA', url: 'https://abax.example/?route=collab&token=TOKEN', prettyUrl: null, defaultRole: 'edit', role: body.defaultRole ?? 'editor', allowCopy: true, pageRights: {}, enabled: body.enabled ?? true, alias: null, ...(link ?? {}), ...(body.enabled !== undefined ? { enabled: body.enabled } : {}), ...(body.defaultRole ? { role: body.defaultRole } : {}) };
        return link;
      }
      if (m === 'GET' && p === '/api/projects/p1/email-invites') return { invites: emails };
      if (m === 'POST' && p === '/api/projects/p1/email-invites') {
        const created = inv({ id: 'e2', email: body.email, role: body.role });
        emails = [created, ...emails];
        return { invite: created, created: true, mailed: true };
      }
      if (m === 'DELETE' && p.startsWith('/api/projects/p1/email-invites/')) { emails = emails.filter(e => !p.endsWith(String(e.id))); return { ok: true }; }
      return new ApiError(404, 'not-found');
    });
    setApiForTests(api);
    return api;
  }

  it('три раздельных списка: «Сейчас на доске», «У кого есть доступ» (владелец, ссылка, почта), статус приглашения', async () => {
    cloud({ emails: [inv({ lastUsedAt: Date.now() }), inv({ id: 'e3', email: 'petr@mail.ru', role: 'reader' })] });
    await openShareDialog(deps());
    await flush(6);
    expect(q('.share-present .share-cloud-title').textContent).toBe('Сейчас на доске · 0');
    expect(q('.share-present .share-hint').hidden).toBe(false);
    const access = [...q('.share-access .share-people').children].map(c => (c as HTMLElement).dataset.key);
    expect(access).toEqual(['owner', 'link', 'ee1', 'ee3']);
    const metas = [...dlg().querySelectorAll('.share-email-item .share-email-meta')].map(m => m.textContent);
    expect(metas).toEqual(['Редактор · заходил(а) сегодня', 'Читатель · отправлено, ещё не заходил']);
    expect(q('.share-link-row .share-person-meta').textContent).toBe('ссылка не создана');
    // без облака путь «без сервера» не исчезает — свёрнут в «Другие способы подключения»
    expect(q('.share-other summary').textContent).toBe('Другие способы подключения (без облака)');
    expect(q<HTMLDetailsElement>('.share-other').open).toBe(false);
  });

  it('черновик адреса и фокус переживают обновление списков', async () => {
    cloud();
    await openShareDialog(deps());
    await flush(6);
    const input = q<HTMLInputElement>('.share-email-input');
    input.focus();
    input.value = 'half@typ';
    document.dispatchEvent(new Event(PRESENCE_EVENT));
    await flush(6);
    expect(q<HTMLInputElement>('.share-email-input')).toBe(input);
    expect(input.value).toBe('half@typ');
    expect(document.activeElement).toBe(input);
  });

  it('приглашение по почте с ролью; отзыв при включённой ссылке честно говорит про общую ссылку', async () => {
    const api = cloud({ link: { token: 'TOK', url: 'https://abax.example/?route=collab&token=TOK', prettyUrl: null, defaultRole: 'edit', role: 'editor', allowCopy: true, pageRights: {}, enabled: true, alias: null } });
    await openShareDialog(deps());
    await flush(6);
    q<HTMLInputElement>('.share-email-input').value = 'new@example.com';
    const role = q<HTMLSelectElement>('.share-email-role');
    expect([...role.options].map(o => o.value)).toEqual(['editor', 'commenter', 'reader']);
    role.value = 'reader';
    role.dispatchEvent(new Event('change'));
    q<HTMLButtonElement>('.share-email-send').click();
    await flush(6);
    expect(api.calls.find(c => c[0] === 'POST' && c[1].endsWith('/email-invites'))![2]).toEqual({ email: 'new@example.com', role: 'reader' });
    const row = q('.share-email-item');
    expect(row.querySelector('.share-email-addr')!.textContent).toBe('new@example.com');
    const revoke = row.querySelector<HTMLButtonElement>('.share-email-revoke')!;
    expect(revoke.getAttribute('aria-label')).toBe('Отозвать приглашение new@example.com');
    revoke.click();
    await flush(6);
    expect(dlg().querySelectorAll('.share-email-item')).toHaveLength(0);
    expect(q('.share-revoked').textContent).toContain('Если у человека есть общая ссылка, он сможет войти по ней');
    expect(dlg().textContent).not.toContain('Отозвать доступ');
  });

  it('общая ссылка: выключатель создаёт и ставит на паузу; на паузе — галочка «закрыть просмотр по ссылке»', async () => {
    const api = cloud();
    await openShareDialog(deps());
    await flush(6);
    const sw = q<HTMLButtonElement>('.share-switch');
    expect(sw.getAttribute('role')).toBe('switch');
    expect(sw.getAttribute('aria-checked')).toBe('false');
    sw.click();
    await flush(6);
    expect(api.calls.filter(c => c[1] === '/api/invites').at(-1)![2]).toMatchObject({ projectId: 'p1', enabled: true });
    expect(q<HTMLInputElement>('.share-url').value).toContain('token=TOKEN');
    expect(q('.share-switch').getAttribute('aria-checked')).toBe('true');
    q<HTMLButtonElement>('.share-switch').click();
    await flush(6);
    expect(api.calls.filter(c => c[1] === '/api/invites').at(-1)![2]).toMatchObject({ enabled: false });
    expect(q('.share-link-row .share-person-meta').textContent).toBe('ссылка выключена');
    const cb = q<HTMLInputElement>('.share-link-box input[type="checkbox"]');
    cb.checked = true;
    cb.dispatchEvent(new Event('change'));
    expect(state.project.permissions?.linkView).toBe(false);
  });

  it('адрес из ответа сервера — только текст', async () => {
    cloud({ emails: [inv({ email: '<img src=x onerror=alert(1)>@x.ru' })] });
    await openShareDialog(deps());
    await flush(6);
    expect(dlg().querySelector('img')).toBeNull();
    expect(q('.share-email-addr').textContent).toBe('<img src=x onerror=alert(1)>@x.ru');
  });

  it('проект не в облаке — блока почты нет', async () => {
    setApiForTests(fakeApi(() => ({ invite: null })));
    await openShareDialog(deps());
    await flush(4);
    expect(q('.share-email').hidden).toBe(true);
  });
});

describe('вкладка «Настройки доступа»', () => {
  const toSettings = () => q<HTMLButtonElement>('#share-tab-settings').click();
  const field = <T extends HTMLElement = HTMLInputElement>(name: string) => q<T>(`[data-field="${name}"]`);

  it('защита, просмотр по ссылке, «Кто может позвать» и права страниц меняют права доски', async () => {
    await openShareDialog(deps());
    toSettings();
    const protect = field('protectElements');
    protect.checked = true;
    protect.dispatchEvent(new Event('change'));
    expect(state.project.permissions?.protectElements).toBe(true);
    const lv = field('linkView');
    expect(lv.checked).toBe(true);
    lv.checked = false;
    lv.dispatchEvent(new Event('change'));
    expect(state.project.permissions?.linkView).toBe(false);
    const editors = q<HTMLInputElement>('[data-key="summon-editors"]');
    editors.checked = true;
    editors.dispatchEvent(new Event('change'));
    expect(state.project.permissions?.summon).toBe('editors');
    expect(q('[role="radiogroup"]').getAttribute('aria-label')).toBe('Кто может позвать всех к себе');
    const page = q<HTMLSelectElement>('.share-page-right[data-page-id="g2"] select');
    expect([...page.options].map(o => o.textContent)).toEqual(['По роли', 'Только просмотр', 'Скрыта']);
    page.value = 'hidden';
    page.dispatchEvent(new Event('change'));
    expect(state.project.permissions?.pageRights).toEqual({ g2: 'hidden' });
  });

  it('старое «редактирование для всех» видно как старая настройка с предупреждением; «Понятно» переводит на «По роли»', async () => {
    state.project.permissions = { pageRights: { g1: 'edit' } };
    await openShareDialog(deps());
    toSettings();
    const sel = q<HTMLSelectElement>('.share-page-right[data-page-id="g1"] select');
    expect(sel.value).toBe('edit');
    expect(sel.selectedOptions[0].textContent).toBe('Редактирование для всех (старая настройка)');
    expect(q('.share-warn').textContent).toContain('больше не повышает роль');
    q<HTMLButtonElement>('.share-warn button').click();
    expect(state.project.permissions?.pageRights).toEqual({});
    expect(dlg().querySelector('.share-warn')).toBeNull();
  });

  it('на Free защита копирования и клонирования и лимит гостей — с меткой Pro', async () => {
    const { applyServerPlan } = await import('../../src/plan');
    applyServerPlan({ plan: 'free', limitsEnforced: true });
    await openShareDialog(deps());
    toSettings();
    expect(field('allowCopy').disabled).toBe(true);
    expect(field('allowClone').disabled).toBe(true);
    expect(field<HTMLSelectElement>('maxGuests').disabled).toBe(true);
    expect(dlg().querySelectorAll('.share-pro-tag').length).toBeGreaterThanOrEqual(3);
    expect(field('protectElements').disabled).toBe(false); // защита элементов — на всех тарифах
  });

  it('именной адрес: подсказка на лету, сохранение, занятый адрес, бывшие адреса и освобождение с подтверждением', async () => {
    setSyncedRev('p1', 3);
    let alias: string | null = null;
    let former: string[] = [];
    const api = fakeApi((m, p, body) => {
      if (m === 'GET' && p.startsWith('/api/invites?')) return { invite: null };
      if (m === 'GET' && p.endsWith('/email-invites')) return { invites: [] };
      if (m === 'GET' && p === '/api/projects/p1/alias') return { alias, former };
      if (m === 'PUT' && p === '/api/projects/p1/alias') {
        if (body.alias === 'taken-one') return new ApiError(409, 'alias-taken');
        if (alias) former = [alias, ...former];
        alias = body.alias;
        return { alias, former, prettyUrl: `https://abax.example/j/${alias}` };
      }
      if (m === 'DELETE' && p.startsWith('/api/projects/p1/alias/')) { former = former.filter(f => !p.endsWith(f)); return { ok: true }; }
      return new ApiError(404, 'not-found');
    });
    setApiForTests(api);
    await openShareDialog(deps());
    toSettings();
    await flush(6);
    const input = () => q<HTMLInputElement>('.share-alias-input');
    input().value = 'Ab';
    input().dispatchEvent(new Event('input'));
    expect(input().value).toBe('ab');
    expect(q('.share-alias-problem').textContent).toBe('Не короче 3 символов');
    input().value = 'taken-one';
    input().dispatchEvent(new Event('input'));
    q<HTMLButtonElement>('.share-alias-save').click();
    await flush(6);
    expect(q('.share-alias .share-cloud-error').textContent).toBe('Этот адрес уже занят');
    input().value = 'physics-9a';
    input().dispatchEvent(new Event('input'));
    q<HTMLButtonElement>('.share-alias-save').click();
    await flush(6);
    input().value = 'fizika-9a';
    input().dispatchEvent(new Event('input'));
    q<HTMLButtonElement>('.share-alias-save').click();
    await flush(6);
    expect(q('.share-alias .share-person-name').textContent).toBe('/j/physics-9a');
    q<HTMLButtonElement>('[data-key="release-physics-9a"]').click();
    expect(q('.share-alias .share-confirm').textContent).toContain('больше никому не достанется');
    q<HTMLButtonElement>('[data-key="release-yes-physics-9a"]').click();
    await flush(6);
    expect(api.calls.some(c => c[0] === 'DELETE' && c[1] === '/api/projects/p1/alias/physics-9a')).toBe(true);
    expect(dlg().querySelector('.share-alias .share-people')).toBeNull();
  });
});
