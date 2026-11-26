import { AUDIT_OPERATIONS, type AdminSession } from '../../shared/admin';
import { api, errorText, RequestError } from './api';
import { taskCatalog } from './task-catalog';
import { alertBox, button, el, field, input, link, select } from './dom';
import { closeAction, list, openPromo, overview, SECTIONS, userDetail, type Section } from './views';

const main = document.querySelector<HTMLElement>('#content')!;
const nav = document.querySelector<HTMLElement>('#navigation')!;
const account = document.querySelector<HTMLElement>('#account')!;
const announcement = document.querySelector<HTMLElement>('#announcement')!;
let session: AdminSession | null = null;
let request: AbortController | null = null;
let generation = 0;

const SEARCH_LABELS = {
  users: 'Имя, почта, Telegram или ID', promos: 'Промокод', payments: 'Пользователь или ID платежа',
  aliases: 'Публичный адрес', audit: 'Администратор или объект',
};

function route() {
  const [path, query] = location.hash.slice(1).split('?', 2);
  const [section, rawId] = path.split('/');
  let id: string | null = null;
  if (section === 'users' && rawId) {
    try { id = decodeURIComponent(rawId); } catch { /* некорректный адрес карточки */ }
  }
  return {
    section: (Object.hasOwn(SECTIONS, section) ? section : 'overview') as Section,
    query: new URLSearchParams(query), id,
  };
}

function href(section: Section, query: URLSearchParams): string {
  const value = query.toString();
  return '#' + section + (value ? '?' + value : '');
}

function mountNavigation(active: Section): void {
  if (!nav.childElementCount) {
    nav.append(...Object.entries(SECTIONS).map(([key, title]) => link(title, '#' + key)));
  }
  for (const item of nav.querySelectorAll('a')) {
    if (item.hash === '#' + active) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  }
  nav.hidden = false;
}

function showLogin(message?: string): void {
  request?.abort();
  generation++;
  session = null;
  closeAction();
  nav.hidden = account.hidden = true;
  account.replaceChildren();
  document.title = 'Вход в панель управления Abax';

  function form(emailValue?: string, notice?: string): HTMLElement {
    const verifying = emailValue !== undefined;
    const heading = el('h1', { text: 'Вход в панель' });
    const error = alertBox();
    if (notice) {
      error.textContent = notice;
      error.hidden = false;
    }
    const description = el('p', { className: 'muted', text: verifying
      ? 'Введите шестизначный код из письма на ' + emailValue + '.'
      : 'Введите почту, привязанную к вашей учётной записи Abax.' });
    const control = verifying
      ? input('code', 'text', { required: true, inputMode: 'numeric', autocomplete: 'one-time-code', maxLength: 6, pattern: '[0-9]{6}' })
      : input('email', 'email', { required: true, autocomplete: 'email', maxLength: 254 });
    const changeMail = button('Запросить новый код', () => {
      const next = form();
      next.querySelector('input')!.value = emailValue ?? '';
      main.replaceChildren(next);
      next.querySelector('input')!.focus();
    });
    const submit = button(verifying ? 'Войти' : 'Получить код', undefined, 'primary');
    const actions = el('div', { className: 'actions' }, ...(verifying ? [changeMail] : []), submit);
    const node = el('form', { className: 'login form' }, heading, description,
      field(verifying ? 'Код из письма' : 'Почта', control), error, actions);
    node.addEventListener('submit', async event => {
      event.preventDefault();
      const value = control.value.trim();
      control.disabled = submit.disabled = changeMail.disabled = true;
      node.setAttribute('aria-busy', 'true');
      error.hidden = true;
      try {
        if (verifying) {
          await api('auth/email/verify', { method: 'POST', body: { email: emailValue, code: value } });
          await start();
        } else {
          await api('auth/email/start', { method: 'POST', body: { email: value } });
          const next = form(value);
          main.replaceChildren(next);
          next.querySelector('input')!.focus();
        }
      } catch (failure) {
        error.textContent = errorText(failure);
        error.hidden = false;
        error.tabIndex = -1;
        error.focus();
      } finally {
        node.removeAttribute('aria-busy');
        control.disabled = submit.disabled = changeMail.disabled = false;
      }
    });
    return node;
  }
  main.replaceChildren(form(undefined, message));
  if (message) main.focus();
}

function errorPanel(error: unknown, retry: () => void): HTMLElement {
  const notice = alertBox();
  notice.hidden = false;
  notice.textContent = errorText(error);
  return el('div', { className: 'problem' }, notice, button('Повторить', retry));
}

function loading(): HTMLElement {
  const node = el('p', { className: 'loading', text: 'Загрузка данных…' });
  node.setAttribute('role', 'status');
  return node;
}

function filter(section: Exclude<Section, 'overview' | 'tasks'>, query: URLSearchParams): HTMLFormElement {
  const term = input('q', 'search', { maxLength: 200, value: query.get('q') ?? '' });
  const operation = section === 'audit'
    ? select('operation', { '': 'Все операции', ...AUDIT_OPERATIONS }, query.get('operation') ?? '') : null;
  const form = el('form', { className: 'filters' }, field(SEARCH_LABELS[section], term),
    ...(operation ? [field('Операция', operation)] : []), button('Найти', undefined, 'secondary'));
  if (term.value || operation?.value) form.append(link('Сбросить', '#' + section, 'reset'));
  form.addEventListener('submit', event => {
    event.preventDefault();
    const next = new URLSearchParams();
    if (term.value.trim()) next.set('q', term.value.trim());
    if (operation?.value) next.set('operation', operation.value);
    const target = href(section, next);
    if (target === location.hash) void render(false);
    else location.hash = target;
  });
  return form;
}

function pagination(section: Section, query: URLSearchParams, page: number, hasMore: boolean): HTMLElement {
  const nav = el('nav', { className: 'pagination' }, el('span', { text: 'Страница ' + page }));
  nav.setAttribute('aria-label', 'Страницы результатов');
  for (const [available, number, label] of [[page > 1, page - 1, 'Назад'], [hasMore, page + 1, 'Далее']] as const) {
    if (!available) continue;
    const next = new URLSearchParams(query);
    if (number === 1) next.delete('page');
    else next.set('page', String(number));
    nav.append(link(label, href(section, next), 'page-link'));
  }
  return nav;
}

async function render(focus: boolean): Promise<void> {
  if (!session) return;
  request?.abort();
  const current = new AbortController();
  request = current;
  const { section, query, id } = route();
  const title = id ? 'Карточка пользователя' : SECTIONS[section];
  document.title = title + ' | Abax';
  mountNavigation(section);
  const heading = el('h1', { text: title });
  heading.tabIndex = -1;
  const lead = el('div', { className: 'section-head' }, heading);
  const pane = el('div', { className: 'pane' }, loading());
  pane.setAttribute('aria-busy', 'true');
  const done = (saved: boolean) => {
    if (current.signal.aborted) return;
    announcement.textContent = saved ? 'Изменение сохранено.' : '';
    void render(true);
  };
  if (section === 'promos') lead.append(button('Создать промокод', () => openPromo(done), 'primary'));
  const layout: HTMLElement[] = id ? [link('К пользователям', href('users', query), 'back'), lead, pane] : [lead, pane];
  if (!id && section !== 'overview' && section !== 'tasks') layout.splice(1, 0, filter(section, query));
  main.replaceChildren(...layout);
  if (focus) heading.focus();
  try {
    if (id) pane.replaceChildren(await userDetail(id, current.signal, done));
    else if (section === 'overview') pane.replaceChildren(await overview(current.signal));
    else if (section === 'tasks') pane.replaceChildren(await taskCatalog(query, current.signal, done));
    else {
      const data = await list(section, query, current.signal, done);
      pane.replaceChildren(data.content, pagination(section, query, data.page, data.hasMore));
    }
  } catch (failure) {
    if (current.signal.aborted) return;
    if (failure instanceof RequestError && (failure.status === 401 || failure.code === 'admin-forbidden')) {
      showLogin(errorText(failure));
    } else {
      pane.replaceChildren(errorPanel(failure, () => { void render(true); }));
    }
  } finally {
    pane.removeAttribute('aria-busy');
  }
}

function renderAccount(current: AdminSession): void {
  const logout = button('Выйти', () => { void signOut(); });
  async function signOut(): Promise<void> {
    logout.disabled = true;
    try {
      await api('admin/session', { method: 'DELETE', body: {} });
      showLogin();
      main.querySelector('input')?.focus();
    } catch (failure) {
      if (failure instanceof RequestError && (failure.status === 401 || failure.code === 'admin-forbidden')) showLogin(errorText(failure));
      else announcement.textContent = errorText(failure);
    } finally { logout.disabled = false; }
  }
  account.replaceChildren(el('span', { text: current.displayName }), logout);
  account.hidden = false;
}

async function start(): Promise<void> {
  const loadingSession = ++generation;
  try {
    const current = await api<AdminSession>('admin/session');
    if (loadingSession !== generation) return;
    session = current;
    renderAccount(current);
    await render(true);
  } catch (failure) {
    if (loadingSession !== generation) return;
    if (failure instanceof RequestError && failure.status === 401) showLogin();
    else if (failure instanceof RequestError && failure.code === 'admin-forbidden') showLogin(errorText(failure));
    else main.replaceChildren(errorPanel(failure, () => { void start(); }));
  }
}

window.addEventListener('hashchange', () => {
  if (location.hash === '#content') return;
  closeAction();
  void render(true);
});
document.querySelector<HTMLAnchorElement>('.skip')!.addEventListener('click', event => {
  event.preventDefault();
  main.focus();
});
void start();
