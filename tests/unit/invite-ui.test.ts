// Логика общей ссылки и приглашений по почте (SPEC_NIGHT6 §6, src/invite-ui.ts): права проекта, тексты, статусы.
// Окно «Поделиться» целиком — tests/unit/share-dialog.test.ts.
import { beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '../../src/api-client';
import {
  EMAIL_STATUS_TEXT, aliasErrorText, aliasSuggestionsOf, emailInviteErrorText, emailInviteStatusText, linkUrlOf, setMaxGuestsInProject, setPageRightInProject,
  setPermissionField, shortDate, storedRoleLabel, type EmailInvite,
} from '../../src/invite-ui';
import { openProject, state } from '../../src/state';
import type { Project } from '../../src/types';

const project = (): Project => ({
  id: 'p1', name: 'Доска', createdAt: 1, updatedAt: 1,
  pages: [
    { id: 'g1', name: 'Первая', grid: 'square', elements: [] },
    { id: 'g2', name: 'Вторая', grid: 'square', elements: [] },
  ],
});

beforeEach(() => {
  localStorage.clear();
  openProject(project());
});

describe('права проекта из окна', () => {
  it('матрица страниц, лимит гостей и отдельные поля меняют права проекта', () => {
    setPageRightInProject('g2', 'hidden');
    expect(state.project.permissions?.pageRights).toEqual({ g2: 'hidden' });
    setPageRightInProject('g1', 'view');
    setPageRightInProject('g2', '');
    expect(state.project.permissions?.pageRights).toEqual({ g1: 'view' });
    setMaxGuestsInProject(5);
    expect(state.project.permissions?.maxGuests).toBe(5);
    setMaxGuestsInProject(0);
    expect(state.project.permissions && 'maxGuests' in state.project.permissions).toBe(false);
    setPermissionField('protectElements', true);
    expect(state.project.permissions?.protectElements).toBe(true);
    setPermissionField('protectElements', undefined);
    expect(state.project.permissions && 'protectElements' in state.project.permissions).toBe(false);
    expect(state.dirty).toBe(true);
  });
});

describe('тексты', () => {
  const inv = (over: Partial<EmailInvite> = {}): EmailInvite => ({
    id: 'e1', projectId: 'p1', email: 's@x.ru', role: 'editor', status: 'pending', createdAt: 1, updatedAt: 1, ...over,
  });
  it('статус приглашения: отправлено / заходил(а) / отклонено - вход важнее нажатой кнопки', () => {
    const now = Date.UTC(2026, 10, 18, 12);
    expect(emailInviteStatusText(inv(), now)).toBe('отправлено, ещё не заходил');
    expect(emailInviteStatusText(inv({ status: 'accepted' }), now)).toBe('принято, ещё не заходил');
    expect(emailInviteStatusText(inv({ lastUsedAt: now - 1000 }), now)).toBe('заходил(а) сегодня');
    expect(emailInviteStatusText(inv({ lastUsedAt: Date.UTC(2026, 10, 1, 12) }), now)).toMatch(/^заходил\(а\) 1 нояб/);
    expect(emailInviteStatusText(inv({ status: 'declined' }), now)).toBe('отклонено');
    expect(EMAIL_STATUS_TEXT.accepted).toBe('принято');
    expect(shortDate(now, now)).toBe('сегодня');
  });
  it('роли: новые и старые синонимы', () => {
    expect(storedRoleLabel('editor')).toBe('Редактор');
    expect(storedRoleLabel('reader')).toBe('Читатель');
    expect(storedRoleLabel('view')).toBe('Комментатор (старая ссылка)');
    expect(storedRoleLabel('edit')).toBe('Редактор (старая ссылка)');
  });
  it('ссылка: чистая, если сервер её дал, иначе с параметрами', () => {
    expect(linkUrlOf({ token: 'T', prettyUrl: 'https://abax.example/j/T' })).toBe('https://abax.example/j/T');
    expect(linkUrlOf({ token: 'T', prettyUrl: null })).toContain('route=collab&token=T');
  });
  it('ошибки приглашения по почте и именного адреса по кодам', () => {
    expect(emailInviteErrorText(new ApiError(400, 'bad-email'))).toBe('Проверьте адрес почты');
    expect(emailInviteErrorText(new ApiError(400, 'bad-role'))).toContain('комментатор');
    expect(emailInviteErrorText(new ApiError(503, 'mail-disabled'))).toBe('Отправка писем на сервере не настроена');
    expect(emailInviteErrorText(new ApiError(502, 'mail-failed'))).toContain('Письмо не ушло');
    expect(emailInviteErrorText(new ApiError(429, 'rate-limited'))).toContain('Слишком много');
    expect(emailInviteErrorText(new ApiError(0, 'network'))).toBe('Нет связи с сервером.');
    expect(emailInviteErrorText(new Error('x'))).toBe('Не удалось отправить приглашение');
    expect(aliasErrorText(new ApiError(409, 'alias-taken'))).toBe('Этот адрес уже занят');
    expect(aliasErrorText(new ApiError(403, 'plan-limit-alias'))).toContain('Pro');
    expect(aliasErrorText(new ApiError(400, 'bad-alias'))).toContain('12–23');
    expect(aliasErrorText(new ApiError(409, 'alias-blocked'))).toBe('Этот адрес заблокирован');
  });

  it('свободные похожие адреса из ответа «занят»: только правильной формы, не больше трёх', () => {
    const e = new ApiError(409, 'alias-taken', { error: 'alias-taken', suggestions: ['fizika-uroki', 'fizika', '<b>x</b>', 42, 'fizika-31847', 'fizika-doska', 'fizika-klass'] });
    expect(aliasSuggestionsOf(e)).toEqual(['fizika-uroki', 'fizika-31847', 'fizika-doska']);
    expect(aliasSuggestionsOf(new ApiError(409, 'alias-taken'))).toEqual([]);
    expect(aliasSuggestionsOf(new Error('x'))).toEqual([]);
  });
});
