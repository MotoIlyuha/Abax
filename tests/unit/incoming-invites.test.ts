// Входящие приглашения по почте: карточки «Приглашения для вас», «Присоединиться» и «Отклонить» (SPEC_NIGHT5 §7).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiError, setApiForTests, type ApiClient, type MeResponse } from '../../src/api-client';
import {
  INCOMING_MIN_MS, incomingInvites, incomingInvitesSection, onIncomingInvites, refreshIncomingInvites, resetIncomingForTests, type IncomingInvite,
} from '../../src/incoming-invites';
import { setAccount } from '../../src/profile-sync';

const inv = (over: Partial<IncomingInvite> = {}): IncomingInvite => ({
  id: 'i1', projectId: 'p1', projectName: 'Алгебра', hostName: 'Анна', role: 'edit', token: 'tok1', createdAt: 1, ...over,
});

function fakeApi(handler: (m: string, p: string, b: unknown) => unknown): ApiClient & { calls: [string, string, unknown][] } {
  const calls: [string, string, unknown][] = [];
  return {
    base: 'http://api.test', calls,
    async request<T>(m: string, p: string, b?: unknown): Promise<T> { calls.push([m, p, b]); const r = handler(m, p, b); if (r instanceof Error) throw r; return r as T; },
    ensureSession: async () => 'tok', me: async () => { throw new Error('нет'); }, logout: async () => {},
  };
}

const me = (anonymous: boolean): MeResponse => ({ user: { id: 'u', displayName: 'Я', tgUsername: null, avatarUrl: null, isAnonymous: anonymous, plan: 'free' } } as unknown as MeResponse);

let went: string[] = [];
beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  went = [];
  resetIncomingForTests(url => { went.push(url); });
});
afterEach(() => { setApiForTests(undefined); setAccount(null, null); });

describe('входящие приглашения', () => {
  it('анониму и без облака — ничего не запрашивается', async () => {
    const api = fakeApi(() => ({ invites: [inv()] }));
    await refreshIncomingInvites(true);
    setApiForTests(api);
    setAccount(me(true), null);
    await refreshIncomingInvites(true);
    expect(api.calls).toEqual([]);
    expect(incomingInvitesSection()).toBeNull();
  });

  it('карточки, бейдж на кнопке профиля и не чаще раза в 30 с', async () => {
    const api = fakeApi(() => ({ invites: [inv(), inv({ id: 'i2', hostName: '<b>Злой</b>', projectName: 'Геометрия', role: 'view', token: 'tok2' })] }));
    setApiForTests(api);
    setAccount(me(false), null);
    const profile = document.createElement('button');
    profile.className = 'home-profile';
    document.body.appendChild(profile);
    let notified = 0;
    onIncomingInvites(() => { notified++; });
    await refreshIncomingInvites(false, 100_000);
    expect(notified).toBe(1);
    expect(profile.classList.contains('has-invites')).toBe(true);
    await refreshIncomingInvites(false, 100_000 + INCOMING_MIN_MS - 1);
    expect(api.calls).toHaveLength(1);
    await refreshIncomingInvites(false, 100_000 + INCOMING_MIN_MS);
    expect(api.calls).toHaveLength(2);
    const section = incomingInvitesSection()!;
    expect(section.querySelector('.home-section-title')!.textContent).toBe('Приглашения для вас');
    const cards = [...section.querySelectorAll<HTMLElement>('.invite-card')];
    expect(cards.map(c => c.querySelector('.invite-card-text')!.textContent)).toEqual([
      'Анна приглашает вас на доску «Алгебра»',
      '<b>Злой</b> приглашает вас на доску «Геометрия»',
    ]);
    expect(section.querySelector('b')).toBeNull();
  });

  it('«Присоединиться» — ответ серверу и переход по ссылке-приглашению', async () => {
    const api = fakeApi((m, p) => (m === 'GET' ? { invites: [inv()] } : p === '/api/me/invites/i1/respond' ? { ok: true, token: 'tok1', projectId: 'p1' } : new ApiError(404, 'x')));
    setApiForTests(api);
    setAccount(me(false), null);
    await refreshIncomingInvites(true);
    incomingInvitesSection()!.querySelector<HTMLButtonElement>('.invite-join')!.click();
    await new Promise(r => setTimeout(r, 0));
    expect(api.calls.at(-1)).toEqual(['POST', '/api/me/invites/i1/respond', { action: 'accept' }]);
    expect(went).toHaveLength(1);
    expect(went[0]).toContain('token=tok1');
    expect(went[0]).toContain('route=collab');
    expect(incomingInvites()).toEqual([]);
  });

  it('«Отклонить» — карточка уходит, перехода нет', async () => {
    const api = fakeApi(m => (m === 'GET' ? { invites: [inv()] } : { ok: true }));
    setApiForTests(api);
    setAccount(me(false), null);
    await refreshIncomingInvites(true);
    incomingInvitesSection()!.querySelector<HTMLButtonElement>('.invite-decline')!.click();
    await new Promise(r => setTimeout(r, 0));
    expect(api.calls.at(-1)).toEqual(['POST', '/api/me/invites/i1/respond', { action: 'decline' }]);
    expect(went).toEqual([]);
    expect(incomingInvitesSection()).toBeNull();
  });
});
