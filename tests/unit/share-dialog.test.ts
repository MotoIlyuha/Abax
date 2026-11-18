// Окно «Поделиться» (SPEC_NIGHT6 §6, редизайн): доступность, вкладки в шапке, общая ссылка, почта и список доступа,
// настройки доступа, путь без облака (спойлер). Анимации выключены (body.no-ui-anim): переходы и списки — сразу.
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
const key = (type: string) => new KeyboardEvent('keydown', { key: type, bubbles: true, cancelable: true });
/** Выпадающий список (spring-select): открыть и выбрать значение. */
function pick(trigger: HTMLElement, value: string): void {
  trigger.click();
  const opt = dlg().querySelector<HTMLElement>(`[role="option"][data-value="${value}"]`);
  if (!opt) throw new Error(`нет пункта ${value}`);
  opt.click();
}
const optionsOf = (trigger: HTMLElement) => {
  trigger.click();
  const out = [...dlg().querySelectorAll<HTMLElement>('[role="option"]')].map(o => ({ value: o.dataset.value, text: o.textContent, danger: o.classList.contains('danger') }));
  trigger.click();
  return out;
};
const toSettings = () => q<HTMLButtonElement>('#share-tab-settings').click();

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<button id="btn-share">Поделиться</button>';
  document.body.className = 'no-ui-anim no-motion';
  clearServerPlan();
  openProject(project());
  state.linkMode = null;
  state.collabRole = null;
});
afterEach(() => { closeShareDialog(); setApiForTests(undefined); document.body.className = ''; });

describe('доступность и вкладки', () => {
  it('диалог с заголовком; вкладки в шапке с aria-selected, стрелки и Home/End переключают, неактивная панель — inert', async () => {
    document.getElementById('btn-share')!.focus();
    await openShareDialog(deps());
    expect(dlg().getAttribute('role')).toBe('dialog');
    expect(dlg().getAttribute('aria-modal')).toBe('true');
    expect(document.getElementById(dlg().getAttribute('aria-labelledby')!)!.textContent).toBe('Поделиться: «Физика 9А»');
    const tabs = [...dlg().querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    expect(q('.share-head [role="tablist"]')).not.toBeNull();
    expect(tabs.map(t => t.textContent)).toEqual(['Поделиться', 'Настройки доступа']);
    expect(tabs.map(t => t.getAttribute('aria-selected'))).toEqual(['true', 'false']);
    expect(tabs.map(t => t.getAttribute('aria-controls'))).toEqual(['share-panel-share', 'share-panel-settings']);
    expect(dlg().textContent).not.toContain('Готово');
    expect(q('#share-panel-settings').hasAttribute('inert')).toBe(true);
    tabs[0].focus();
    tabs[0].dispatchEvent(key('ArrowRight'));
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    expect(q('#share-panel-share').hasAttribute('inert')).toBe(true);
    expect(q('#share-panel-settings').hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(tabs[1]);
    tabs[1].dispatchEvent(key('Home'));
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(q('#share-panel-share').hasAttribute('inert')).toBe(false);
  });

  it('своя тонкая полоса прокрутки у обеих панелей (родная скрыта)', async () => {
    await openShareDialog(deps());
    for (const id of ['share-panel-share', 'share-panel-settings']) {
      const panel = q(`#${id}`);
      expect(panel.classList.contains('oscroll')).toBe(true);
      expect(panel.parentElement!.querySelector(':scope > .oscroll-thumb-y')).not.toBeNull();
    }
  });

  it('Esc закрывает окно и возвращает фокус на кнопку «Поделиться»; повторное открытие — переключатель', async () => {
    const opener = document.getElementById('btn-share')!;
    opener.focus();
    await openShareDialog(deps());
    dlg().dispatchEvent(key('Escape'));
    expect(shareDialogOpen()).toBe(false);
    expect(document.getElementById('share-dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
    await openShareDialog(deps());
    await openShareDialog(deps());
    expect(document.getElementById('share-dialog')).toBeNull();
  });

  it('Tab не выпускает фокус из окна', async () => {
    await openShareDialog(deps());
    const last = q<HTMLButtonElement>('.share-p2p button');
    last.focus();
    const ev = key('Tab');
    last.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(dlg().contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(last);
  });
});

describe('без облака', () => {
  it('путь без сервера — на главной и первым: «Включить совместную работу» запускает комнату, ссылка — кнопка', async () => {
    const api = shareApi();
    await openShareDialog(deps(api));
    expect(q('.share-invite').hidden).toBe(true);
    expect(q('#share-panel-share .share-page-inner').firstElementChild!.classList.contains('share-p2p')).toBe(true);
    expect(dlg().querySelector('.share-other')).toBeNull();
    const start = [...dlg().querySelectorAll('button')].find(b => b.textContent === 'Включить совместную работу')!;
    expect(document.activeElement).toBe(start);
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

  it('права гостя по страницам и роль — в выпадающих списках строки участника', async () => {
    const calls: unknown[] = [];
    const api = shareApi({ active: true, url: 'http://192.168.1.5:4826/?room=X', urls: [], users: [{ userId: 7, name: 'Аня', color: '#f00', rights: { default: 'view' } }] });
    api.shareSetRights = async (uid, patch) => { calls.push([uid, patch]); return { ok: true }; };
    await openShareDialog(deps(api));
    const rights = [...dlg().querySelectorAll<HTMLElement>('.share-user .share-user-right')];
    expect(rights).toHaveLength(2);
    pick(rights[1], 'edit');
    pick(q('.share-user .share-user-role'), 'reader');
    await flush(4);
    expect(calls).toEqual([[7, { pages: { g2: 'edit' } }], [7, { role: 'reader' }]]);
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
      if (m === 'POST' && p.startsWith('/api/invites/') && p.endsWith('/reset')) {
        link = { ...link!, token: 'NEWTOKEN', url: 'https://abax.example/?route=collab&token=NEWTOKEN' };
        return link;
      }
      if (m === 'GET' && p === '/api/projects/p1/email-invites') return { invites: emails };
      if (m === 'POST' && p === '/api/projects/p1/email-invites') {
        const created = inv({ id: 'e2', email: body.email, role: body.role });
        emails = [created, ...emails];
        return { invite: created, created: true, mailed: true };
      }
      if (m === 'DELETE' && p.startsWith('/api/projects/p1/email-invites/')) { emails = emails.filter(e => !p.endsWith(String(e.id))); return { ok: true }; }
      if (m === 'GET' && p === '/api/projects/p1/alias') return { alias: null, former: [] };
      return new ApiError(404, 'not-found');
    });
    setApiForTests(api);
    return api;
  }

  it('«Есть доступ»: владелец и приглашения со статусом, роль — в выпадающем списке строки; «Сейчас на доске» в окне нет', async () => {
    cloud({ emails: [inv({ lastUsedAt: Date.now() }), inv({ id: 'e3', email: 'petr@mail.ru', role: 'reader' })] });
    await openShareDialog(deps());
    await flush(6);
    expect(dlg().querySelector('.share-present')).toBeNull();
    expect(dlg().textContent).not.toContain('Сейчас на доске');
    const access = [...q('.share-access .share-people').children].map(c => (c as HTMLElement).dataset.key);
    expect(access).toEqual(['owner', 'ee1', 'ee3']);
    const metas = [...dlg().querySelectorAll('.share-email-item .share-email-meta')].map(m => m.textContent);
    expect(metas).toEqual(['заходил(а) сегодня', 'отправлено, ещё не заходил']);
    const roles = [...dlg().querySelectorAll<HTMLElement>('.share-email-row-role')].map(r => r.dataset.value);
    expect(roles).toEqual(['editor', 'reader']);
    // фокус — в поле приглашения
    expect(document.activeElement).toBe(q('.share-email-input'));
    // ссылки ещё нет: выключатель выключен, пояснение — в подсказке, а не текстом
    expect(q('.share-switch').getAttribute('aria-checked')).toBe('false');
    expect(q('.share-link-row').title).toContain('Включите');
    expect(q('.share-url-row').hidden).toBe(true);
    // путь без облака не исчезает — он в спойлере «Без облака» внизу вкладки
    const other = q<HTMLDetailsElement>('.share-other');
    expect(other.open).toBe(false);
    expect(other.querySelector('summary')!.textContent).toBe('Без облака');
    expect(other.querySelector('summary')!.title).toContain('без сервера Abax');
    expect(other.querySelector('.share-p2p')).not.toBeNull();
    other.querySelector('summary')!.click();
    expect(other.open).toBe(true);
    expect(other.querySelector('.share-p2p button')!.textContent).toBe('Включить совместную работу');
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

  it('приглашение по почте с ролью; «Отозвать приглашение» — в списке роли, при включённой ссылке честно говорит про неё', async () => {
    const api = cloud({ link: { token: 'TOK', url: 'https://abax.example/?route=collab&token=TOK', prettyUrl: null, defaultRole: 'edit', role: 'editor', allowCopy: true, pageRights: {}, enabled: true, alias: null } });
    await openShareDialog(deps());
    await flush(6);
    q<HTMLInputElement>('.share-email-input').value = 'new@example.com';
    const role = q('.share-email-role');
    expect(optionsOf(role).map(o => o.value)).toEqual(['editor', 'commenter', 'reader']);
    expect(role.title).toContain('не выдавайте роль выше нужной'); // пояснение — в подсказке
    pick(role, 'reader');
    expect(role.dataset.value).toBe('reader');
    q<HTMLButtonElement>('.share-email-send').click();
    await flush(6);
    expect(api.calls.find(c => c[0] === 'POST' && c[1].endsWith('/email-invites'))![2]).toEqual({ email: 'new@example.com', role: 'reader' });
    expect(q('.share-email-send').classList.contains('is-sent')).toBe(true);
    expect(q<HTMLInputElement>('.share-email-input').value).toBe('');
    const row = q('.share-email-item');
    expect(row.querySelector('.share-email-addr')!.textContent).toBe('new@example.com');
    const rowRole = row.querySelector<HTMLElement>('.share-email-row-role')!;
    expect(rowRole.getAttribute('aria-label')).toBe('Роль new@example.com');
    const opts = optionsOf(rowRole);
    expect(opts.at(-1)).toEqual({ value: '__revoke', text: 'Отозвать приглашение', danger: true });
    pick(rowRole, '__revoke');
    await flush(6);
    expect(dlg().querySelectorAll('.share-email-item')).toHaveLength(0);
    expect(q('.share-revoked').textContent).toContain('Если у человека есть общая ссылка, он сможет войти по ней');
    expect(dlg().textContent).not.toContain('Отозвать доступ');
  });

  it('пустой адрес — поле качается и краснеет, запроса нет', async () => {
    const api = cloud();
    await openShareDialog(deps());
    await flush(6);
    q<HTMLButtonElement>('.share-email-send').click();
    await flush(2);
    expect(q('.share-email-field').classList.contains('is-bad')).toBe(true);
    expect(api.calls.some(c => c[0] === 'POST')).toBe(false);
  });

  it('общая ссылка: выключатель создаёт и ставит на паузу; адрес и «Копировать» — только у включённой', async () => {
    const api = cloud();
    await openShareDialog(deps());
    await flush(6);
    const sw = q<HTMLInputElement>('.share-switch');
    expect(sw.getAttribute('role')).toBe('switch');
    expect(sw.getAttribute('aria-checked')).toBe('false');
    sw.click();
    await flush(6);
    expect(api.calls.filter(c => c[1] === '/api/invites').at(-1)![2]).toMatchObject({ projectId: 'p1', enabled: true });
    expect(q<HTMLInputElement>('.share-url').value).toContain('token=TOKEN');
    expect(q('.share-url-row').hidden).toBe(false);
    expect(sw.getAttribute('aria-checked')).toBe('true');
    expect(sw.checked).toBe(true);
    sw.click();
    await flush(6);
    expect(api.calls.filter(c => c[1] === '/api/invites').at(-1)![2]).toMatchObject({ enabled: false });
    expect(sw.getAttribute('aria-checked')).toBe('false');
    expect(q('.share-url-row').hidden).toBe(true);
    expect(q('.share-link-row').title).toContain('Ссылка выключена');
  });

  it('«Сбросить ссылку…» — в настройках доступа, с подтверждением', async () => {
    const api = cloud({ link: { token: 'TOK', url: 'https://abax.example/?route=collab&token=TOK', prettyUrl: null, defaultRole: 'edit', role: 'editor', allowCopy: true, pageRights: {}, enabled: true, alias: null } });
    await openShareDialog(deps());
    await flush(6);
    expect(q('.share-reset').closest('[inert]')).not.toBeNull(); // на неактивной вкладке
    toSettings();
    await flush(4);
    q<HTMLButtonElement>('.share-reset').click();
    expect(q('.share-confirm').textContent).toContain('Старая ссылка перестанет работать');
    expect(document.activeElement).toBe(q('[data-key="reset-no"]'));
    q<HTMLButtonElement>('[data-key="reset-yes"]').click();
    await flush(6);
    expect(api.calls.some(c => c[0] === 'POST' && c[1] === '/api/invites/TOK/reset')).toBe(true);
    q<HTMLButtonElement>('#share-tab-share').click();
    expect(q<HTMLInputElement>('.share-url').value).toContain('token=NEWTOKEN');
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

describe('страница «Настройки доступа»', () => {
  const field = <T extends HTMLElement = HTMLInputElement>(name: string) => q<T>(`[data-field="${name}"]`);

  it('защита, просмотр по ссылке, «Позвать всех к себе» и права страниц меняют права доски', async () => {
    await openShareDialog(deps());
    toSettings();
    const protect = field('protectElements');
    expect(protect.getAttribute('role')).toBe('switch');
    expect(protect.closest('label')!.title).toContain('чужие элементы'); // пояснение — в подсказке
    protect.checked = true;
    protect.dispatchEvent(new Event('change'));
    expect(state.project.permissions?.protectElements).toBe(true);
    const lv = field('linkView');
    expect(lv.checked).toBe(true);
    lv.checked = false;
    lv.dispatchEvent(new Event('change'));
    expect(state.project.permissions?.linkView).toBe(false);
    expect(q('[role="radiogroup"]').getAttribute('aria-label')).toBe('Кто может позвать всех к себе');
    const editors = q<HTMLButtonElement>('[data-key="summon-editors"]');
    expect(editors.getAttribute('role')).toBe('radio');
    editors.click();
    expect(state.project.permissions?.summon).toBe('editors');
    expect(editors.getAttribute('aria-checked')).toBe('true');
    const page = q('.share-page-right[data-page-id="g2"] .ss-trigger');
    expect(optionsOf(page).map(o => o.text)).toEqual(['По роли', 'Только просмотр', 'Скрыта']);
    pick(page, 'hidden');
    expect(state.project.permissions?.pageRights).toEqual({ g2: 'hidden' });
  });

  it('максимум гостей — счётчик: стрелки и кнопки идут по списку, «∞» — без ограничений', async () => {
    await openShareDialog(deps());
    toSettings();
    const stepper = field<HTMLElement>('maxGuests');
    const num = stepper.querySelector<HTMLElement>('[role="spinbutton"]')!;
    expect(num.getAttribute('aria-valuetext')).toBe('без ограничений');
    num.dispatchEvent(key('Home'));
    expect(state.project.permissions?.maxGuests).toBe(1);
    stepper.querySelector<HTMLButtonElement>('.stp-plus')!.click();
    expect(state.project.permissions?.maxGuests).toBe(2);
    expect(stepper.dataset.value).toBe('2');
  });

  it('старое «редактирование для всех» видно как старая настройка с предупреждением; «Понятно» переводит на «По роли»', async () => {
    state.project.permissions = { pageRights: { g1: 'edit' } };
    await openShareDialog(deps());
    toSettings();
    const sel = q('.share-page-right[data-page-id="g1"] .ss-trigger');
    expect(sel.dataset.value).toBe('edit');
    expect(sel.textContent).toBe('Редактирование для всех (старая настройка)');
    expect(q('.share-warn').textContent).toContain('больше не повышает роль');
    q<HTMLButtonElement>('.share-warn button').click();
    expect(state.project.permissions?.pageRights).toEqual({});
    expect(dlg().querySelector('.share-warn')).toBeNull();
    expect(sel.dataset.value).toBe('');
  });

  it('на Free защита копирования и клонирования и лимит гостей — с меткой Pro', async () => {
    const { applyServerPlan } = await import('../../src/plan');
    applyServerPlan({ plan: 'free', limitsEnforced: true });
    await openShareDialog(deps());
    toSettings();
    expect(field('allowCopy').disabled).toBe(true);
    expect(field('allowClone').disabled).toBe(true);
    expect(field<HTMLElement>('maxGuests').classList.contains('disabled')).toBe(true);
    expect(field<HTMLElement>('maxGuests').dataset.value).toBe('1');
    expect([...dlg().querySelectorAll<HTMLElement>('.share-pro-tag')].filter(t => !t.hidden).length).toBeGreaterThanOrEqual(3);
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
    expect(q('.share-alias .share-setting-label').title).toContain('Это не секрет'); // пояснение — в подсказке
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
    expect(q('.share-alias-save').textContent).toBe('Изменить');
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
    expect(dlg().querySelector('.share-alias .share-person')).toBeNull();
    expect(q('.share-former').hidden).toBe(true);
  });
});

describe('роль общей ссылки до её создания', () => {
  it('выбор роли без ссылки ничего не создаёт; выключатель создаёт ссылку с выбранной ролью', async () => {
    setSyncedRev('p1', 3);
    const calls: [string, string, any][] = [];
    setApiForTests(fakeApi((m, p, body) => {
      calls.push([m, p, body]);
      if (m === 'GET' && p.startsWith('/api/invites?')) return { invite: null };
      if (m === 'GET' && p.endsWith('/email-invites')) return { invites: [] };
      if (m === 'POST' && p === '/api/invites') return { token: 'T', url: 'u', prettyUrl: null, defaultRole: 'view', role: body.defaultRole, allowCopy: true, pageRights: {}, enabled: true, alias: null };
      return new ApiError(404, 'not-found');
    }));
    await openShareDialog(deps());
    await flush(6);
    pick(q('.share-link-role'), 'reader');
    await flush(4);
    expect(calls.some(c => c[0] === 'POST')).toBe(false);
    q<HTMLInputElement>('.share-switch').click();
    await flush(6);
    expect(calls.find(c => c[0] === 'POST')![2]).toMatchObject({ defaultRole: 'reader', enabled: true });
  });
});
