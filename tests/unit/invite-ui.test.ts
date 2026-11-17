// Окно «Совместная работа»: права до создания ссылки, лимит гостей, приглашения по почте (SPEC_NIGHT5 §7).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiError, setApiForTests, type ApiClient } from '../../src/api-client';
import { EMAIL_STATUS_TEXT, createInviteBox, emailInviteErrorText, setMaxGuestsInProject, setPageRightInProject, type EmailInvite } from '../../src/invite-ui';
import { applyServerPlan, clearServerPlan } from '../../src/plan';
import { openProject, state } from '../../src/state';
import { setSyncedRev } from '../../src/sync-state';
import type { Project } from '../../src/types';

const project = (): Project => ({
  id: 'p1', name: 'Доска', createdAt: 1, updatedAt: 1,
  pages: [
    { id: 'g1', name: 'Первая', grid: 'square', elements: [] },
    { id: 'g2', name: 'Вторая', grid: 'square', elements: [] },
  ],
});

type Handler = (method: string, path: string, body: unknown) => unknown;
function fakeApi(handler: Handler): ApiClient & { calls: [string, string, unknown][] } {
  const calls: [string, string, unknown][] = [];
  return {
    base: 'http://api.test',
    calls,
    async request<T>(method: string, path: string, body?: unknown): Promise<T> {
      calls.push([method, path, body]);
      const r = handler(method, path, body);
      if (r instanceof Error) throw r;
      return r as T;
    },
    ensureSession: async () => 'tok',
    me: async () => { throw new Error('нет'); },
    logout: async () => {},
  };
}

const flush = () => new Promise(r => setTimeout(r, 0));

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  clearServerPlan();
  openProject(project());
  state.linkMode = null;
  state.collabRole = null;
});
afterEach(() => setApiForTests(undefined));

describe('права до создания ссылки', () => {
  it('матрица страниц и лимит гостей меняют права проекта', () => {
    setPageRightInProject('g2', 'hidden');
    expect(state.project.permissions?.pageRights).toEqual({ g2: 'hidden' });
    setPageRightInProject('g1', 'edit');
    setPageRightInProject('g2', '');
    expect(state.project.permissions?.pageRights).toEqual({ g1: 'edit' });
    setMaxGuestsInProject(5);
    expect(state.project.permissions?.maxGuests).toBe(5);
    setMaxGuestsInProject(0);
    expect(state.project.permissions && 'maxGuests' in state.project.permissions).toBe(false);
    expect(state.dirty).toBe(true);
  });

  it('видны до создания ссылки; выбор в матрице пишет права проекта', async () => {
    setApiForTests(fakeApi((_m, p) => (p.startsWith('/api/invites?') ? { invite: null } : new ApiError(404, 'not-found'))));
    const box = createInviteBox();
    document.body.appendChild(box);
    await flush();
    expect(box.hidden).toBe(false);
    expect(box.querySelector('button')?.textContent).toBeDefined();
    expect([...box.querySelectorAll('button')].some(b => b.textContent === 'Создать ссылку-приглашение')).toBe(true);
    const rows = [...box.querySelectorAll<HTMLElement>('.share-page-right')];
    expect(rows.map(r => r.dataset.pageId)).toEqual(['g1', 'g2']);
    const sel = rows[1].querySelector('select')!;
    sel.value = 'hidden';
    sel.dispatchEvent(new Event('change'));
    expect(state.project.permissions?.pageRights?.g2).toBe('hidden');
    // роль до создания — только состояние формы
    const role = box.querySelector<HTMLSelectElement>('select[data-field="role"]')!;
    role.value = 'view';
    role.dispatchEvent(new Event('change'));
    expect(box.querySelector<HTMLSelectElement>('select[data-field="role"]')!.value).toBe('view');
  });

  it('лимит гостей: на Free заблокирован с меткой Pro, на Pro выбирается', async () => {
    setApiForTests(fakeApi(() => ({ invite: null })));
    applyServerPlan({ plan: 'free', limitsEnforced: true });
    let box = createInviteBox();
    await flush();
    let max = box.querySelector<HTMLSelectElement>('select[data-field="maxGuests"]')!;
    expect(max.disabled).toBe(true);
    expect(box.querySelector('.share-max-guests .share-pro-tag')?.textContent).toBe('Pro');
    expect(box.querySelector<HTMLInputElement>('input[data-field="allowCopy"]')!.disabled).toBe(true);
    applyServerPlan({ plan: 'pro', limitsEnforced: true });
    box = createInviteBox();
    await flush();
    max = box.querySelector<HTMLSelectElement>('select[data-field="maxGuests"]')!;
    expect(max.disabled).toBe(false);
    max.value = '3';
    max.dispatchEvent(new Event('change'));
    expect(state.project.permissions?.maxGuests).toBe(3);
  });

  it('без облака блока нет', () => {
    const box = createInviteBox();
    expect(box.hidden).toBe(true);
  });
});

describe('приглашения по почте у автора', () => {
  const inv = (over: Partial<EmailInvite> = {}): EmailInvite => ({
    id: 'e1', projectId: 'p1', email: 'student@example.com', role: 'edit', status: 'pending', createdAt: 1, updatedAt: 1, ...over,
  });

  it('список со статусом, приглашение и отзыв', async () => {
    setSyncedRev('p1', 3);
    let list = [inv({ status: 'accepted' })];
    const api = fakeApi((m, p, body) => {
      if (p.startsWith('/api/invites?')) return { invite: null };
      if (m === 'GET' && p === '/api/projects/p1/email-invites') return { invites: list };
      if (m === 'POST' && p === '/api/projects/p1/email-invites') {
        const b = body as { email: string; role: 'edit' | 'view' };
        const created = inv({ id: 'e2', email: b.email, role: b.role });
        list = [created, ...list];
        return { invite: created, created: true, mailed: true };
      }
      if (m === 'DELETE' && p === '/api/projects/p1/email-invites/e1') return { ok: true };
      return new ApiError(404, 'not-found');
    });
    setApiForTests(api);
    const box = createInviteBox();
    document.body.appendChild(box);
    await flush(); await flush();
    let items = [...box.querySelectorAll<HTMLElement>('.share-email-item')];
    expect(items.map(i => i.querySelector('.share-email-meta')!.textContent)).toEqual([`редактор · ${EMAIL_STATUS_TEXT.accepted}`]);
    const input = box.querySelector<HTMLInputElement>('.share-email-input')!;
    input.value = 'new@example.com';
    input.dispatchEvent(new Event('input'));
    const role = box.querySelector<HTMLSelectElement>('.share-email-role')!;
    role.value = 'view';
    role.dispatchEvent(new Event('change'));
    box.querySelector<HTMLButtonElement>('.share-email-send')!.click();
    await flush(); await flush();
    expect(api.calls.find(c => c[0] === 'POST')![2]).toEqual({ email: 'new@example.com', role: 'view' });
    items = [...box.querySelectorAll<HTMLElement>('.share-email-item')];
    expect(items.map(i => i.querySelector('.share-email-addr')!.textContent)).toEqual(['new@example.com', 'student@example.com']);
    expect(items[0].querySelector('.share-email-meta')!.textContent).toBe('читатель · ожидает');
    items[1].querySelector<HTMLButtonElement>('.share-email-revoke')!.click();
    await flush(); await flush();
    expect(api.calls.some(c => c[0] === 'DELETE' && c[1] === '/api/projects/p1/email-invites/e1')).toBe(true);
    expect([...box.querySelectorAll('.share-email-item')]).toHaveLength(1);
  });

  it('адрес из ответа сервера — только текст', async () => {
    setSyncedRev('p1', 3);
    setApiForTests(fakeApi((_m, p) => (p.startsWith('/api/invites?') ? { invite: null } : { invites: [inv({ email: '<img src=x onerror=alert(1)>@x.ru' })] })));
    const box = createInviteBox();
    await flush(); await flush();
    expect(box.querySelector('img')).toBeNull();
    expect(box.querySelector('.share-email-addr')!.textContent).toBe('<img src=x onerror=alert(1)>@x.ru');
  });

  it('ошибка сервера — понятное сообщение', async () => {
    setSyncedRev('p1', 3);
    setApiForTests(fakeApi((m, p) => {
      if (p.startsWith('/api/invites?')) return { invite: null };
      if (m === 'GET') return { invites: [] };
      return new ApiError(400, 'self-invite');
    }));
    const box = createInviteBox();
    await flush(); await flush();
    const input = box.querySelector<HTMLInputElement>('.share-email-input')!;
    input.value = 'me@example.com';
    input.dispatchEvent(new Event('input'));
    box.querySelector<HTMLButtonElement>('.share-email-send')!.click();
    await flush(); await flush();
    expect(box.querySelector('.share-email .share-cloud-error')!.textContent).toBe('Это ваш собственный адрес');
  });

  it('тексты ошибок по кодам', () => {
    expect(emailInviteErrorText(new ApiError(400, 'bad-email'))).toBe('Проверьте адрес почты');
    expect(emailInviteErrorText(new ApiError(503, 'mail-disabled'))).toBe('Отправка писем на сервере не настроена');
    expect(emailInviteErrorText(new ApiError(502, 'mail-failed'))).toContain('Письмо не ушло');
    expect(emailInviteErrorText(new ApiError(429, 'rate-limited'))).toContain('Слишком много');
    expect(emailInviteErrorText(new ApiError(0, 'network'))).toBe('Нет связи с сервером.');
    expect(emailInviteErrorText(new Error('x'))).toBe('Не удалось отправить приглашение');
  });

  it('проект не в облаке — блока почты нет', async () => {
    setApiForTests(fakeApi(() => ({ invite: null })));
    const box = createInviteBox();
    await flush();
    expect(box.querySelector('.share-email')).toBeNull();
  });
});
