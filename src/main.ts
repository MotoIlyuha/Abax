import './style.css';
import { initRenderer, requestRender } from './renderer';
import { initController } from './controller';
import { initApp, importPdfFromDataUrl } from './app';
import { state, openProject, blankProject, projectMeta, onChange, undo, redo } from './state';
import { storage, setStorage } from './storage';
import { startCollab, connectCollab, netStorage, closedNotice, showCollabNotice, relayNotice, type CollabClosedDetail } from './collab';
import { cloudTransport, parseCloudInvite } from './collab-transport';
import { initTooltips } from './tooltip';
import { startUpdateChecks } from './update-notice';
import { initAppIcon } from './app-icon';
import { linkModeOf, parseBoardUrl } from './router';
import { enterLinkView, startLinkViewCamera } from './link-view-ui';
import { joinCloudInvite, watchOwnerRoom } from './cloud-room';
import { cloudEnabled } from './api-client';
import { localGuestTransport, localRoomCode } from './local-transport';
import { startLocalRoom } from './browser-host';
import { initCloudSync, mergeRemoteMetas, openFresh, startBackgroundSync } from './cloud-sync';
import { myCursorId, profileName } from './profile';
import { startProfileSync, syncAccount } from './profile-sync';
import { completePendingAuth, type AuthOutcome } from './auth';
import { needsOnboarding, openOnboarding } from './onboarding';
import { applyCloudConflict, openProfileAfterAuth, replaceStarterWithCloud } from './app';
import { STARTER_PROJECT_NAME, markStarter } from './sync-state';
import { roomFullInfo, showRoomFullModal } from './room-full';
import { refreshIncomingInvites } from './incoming-invites';

/**
 * Уведомление гостю, когда комната закрылась или отказала. Мест нет (4402/4430) — окно «Комната заполнена»
 * (SPEC_NIGHT5 §7); у облачного приглашения его показывает joinCloudInvite (там же — «только для чтения»).
 */
function watchGuestClose(opts: { roomFullHandled?: boolean } = {}): void {
  document.addEventListener('doska:collab-closed', ev => {
    const detail = (ev as CustomEvent<CollabClosedDetail>).detail;
    const full = roomFullInfo(detail);
    if (full) {
      if (!opts.roomFullHandled) showRoomFullModal({ ...full, onRetry: () => location.reload() });
      return;
    }
    const notice = closedNotice(detail.code);
    showCollabNotice(notice.title, notice.text);
  });
}

async function boot(): Promise<void> {
  initTooltips();
  initAppIcon();
  const canvas = document.getElementById('board') as HTMLCanvasElement;

  // guest-режим: ссылка совместной работы — в локальной сети (?room=CODE, клиент раздаёт компьютер
  // автора) или через интернет (#relay=…&r=…, клиент на GitHub Pages, сообщения через ретранслятор)
  const q = new URLSearchParams(location.search);
  const roomCode = q.get('room');
  const invite = roomCode ? null : parseCloudInvite(location.hash);
  // приглашение есть, но испорчено или неполное (например, без ключа) — объясняем, а не открываем молча пустую доску
  const brokenInvite = !roomCode && !invite && /(^#|&)relay=/.test(location.hash);
  if (roomCode || invite) {
    // имя из URL (тестовое окно) или автогенерация — БЕЗ window.prompt,
    // который блокирует boot в Electron BrowserWindow
    const name = q.get('name') || invite?.name || profileName() || `Гость ${Math.floor(Math.random() * 90 + 10)}`;
    // подписка до подключения: отказ может прийти сразу после открытия канала
    watchGuestClose();
    const localCode = localRoomCode(roomCode);
    if (invite) await connectCollab(cloudTransport(invite.relayUrl, invite.room, invite.key, name, relayNotice, myCursorId()), false);
    else if (localCode) await connectCollab(localGuestTransport(localCode, name, undefined, myCursorId()), false);
    else await startCollab(`ws://${location.host}/ws?code=${encodeURIComponent(roomCode!)}`, false, name);
    setStorage(netStorage);
    initRenderer(canvas);
    initApp(canvas);
    initController(canvas);
    onChange(() => requestRender());
    document.body.classList.add('collab-guest');
    (window as unknown as Record<string, unknown>).__doska = { state, undo, redo, requestRender };
    return;
  }

  if (brokenInvite) {
    showCollabNotice('Неверная ссылка', 'Ссылка-приглашение повреждена или скопирована не полностью. Попросите автора прислать её заново.');
  }

  // ссылка просмотра: /p/…, ?route=project|page — без своей доски на запуске и без записи на устройство
  const route = parseBoardUrl(location.href);
  let viewRoute = linkModeOf(route) ? route : null;

  // облако (если настроено): проекты устройства уходят на сервер, серверные появляются в списке
  initCloudSync({
    onRemoteProjects: remote => {
      state.projects = mergeRemoteMetas(state.projects, remote);
      document.dispatchEvent(new CustomEvent('doska:projects-changed'));
    },
    // открыта нетронутая стартовая доска, а в облаке есть проекты — открыть самый свежий (SPEC_NIGHT5 §2.1)
    onSynced: metas => { void replaceStarterWithCloud(metas).catch(() => {}); },
    // офлайн-правки поверх версии с другого устройства — в копию (SPEC_NIGHT5 §2.4)
    onConflict: applyCloudConflict,
  });

  // вернулись от провайдера входа (#abaxAuth=…) — завершить вход до открытия доски
  const authOutcome = viewRoute ? null : await completePendingAuth();

  let metas = await storage.list();
  if (viewRoute) {
    state.projects = metas;
    await enterLinkView(viewRoute);
  } else if (route.mode === 'collab' && route.token) {
    if (!cloudEnabled()) {
      showCollabNotice('Ссылка не поддерживается', 'Приглашения по коду пока не работают. Попросите автора прислать ссылку заново.');
    } else {
      // приглашение /j/:token: гость входит в облачную комнату; не вышло — проект для чтения; не открылось — обычная доска
      state.projects = metas;
      watchGuestClose({ roomFullHandled: true });
      const outcome = await joinCloudInvite(route.token, q.get('name') || profileName() || `Гость ${Math.floor(Math.random() * 90 + 10)}`);
      if (outcome === 'room') {
        setStorage(netStorage);
        initRenderer(canvas);
        initApp(canvas);
        initController(canvas);
        onChange(() => requestRender());
        document.body.classList.add('collab-guest');
        (window as unknown as Record<string, unknown>).__doska = { state, undo, redo, requestRender };
        return;
      }
      if (outcome === 'view') viewRoute = { mode: 'view-project', projectId: state.project.id };
    }
  }
  if (!viewRoute) {
    let last: { pid?: string; pageId?: string } = {};
    try {
      last = JSON.parse(localStorage.getItem('doska.last') || '{}');
    } catch { /* нет сохранённой позиции */ }
    let project = last.pid ? await openFresh(last.pid) : null;
    if (!project && metas.length > 0) project = await storage.load(metas[0].id);
    if (!project) {
      // стартовая заглушка: пока пользователь в ней ничего не сделал, в облако она не уходит (SPEC_NIGHT5 §2.1)
      project = blankProject(STARTER_PROJECT_NAME);
      markStarter(project.id);
      await storage.save(project);
    }
    if (!metas.some(m => m.id === project!.id)) {
      metas = [projectMeta(project), ...metas];
    }
    state.projects = metas;
    openProject(project, last.pageId, 'board');
  }

  initRenderer(canvas);
  initApp(canvas);
  initController(canvas);
  onChange(() => requestRender());
  // обновления — только здесь: гость совместной работы (ветка выше) открыл приложение автора
  startUpdateChecks();
  // тариф с сервера и начальная синхронизация проектов (без настроенного облака — ничего не делают)
  // тариф и профиль аккаунта (SPEC_NIGHT4 §8), затем фоновая синхронизация проектов
  void syncAccount().then(() => { startBackgroundSync(); startProfileSync(); void refreshIncomingInvites(true); });
  // вошли или вышли без перезагрузки (почта, выход) — проекты аккаунта появляются в списке
  document.addEventListener('doska:account-changed', () => { startBackgroundSync(); void refreshIncomingInvites(true); });
  // автор подключается к облачной комнате своего проекта, пока у проекта есть приглашение
  if (!viewRoute) watchOwnerRoom();
  if (viewRoute) {
    startLinkViewCamera(viewRoute);
    // из просмотра в просмотр — без перезагрузки; во всё остальное (своя доска, совместная работа) — с ней
    const onNavigate = () => {
      const next = parseBoardUrl(location.href);
      if (!linkModeOf(next)) { location.reload(); return; }
      void enterLinkView(next).then(() => startLinkViewCamera(next));
    };
    window.addEventListener('popstate', onNavigate);
    window.addEventListener('hashchange', onNavigate);
  } else {
    // со своей доски на ссылку просмотра или приглашение — перезагрузка: у них другой запуск
    const onNavigate = () => {
      if (parseBoardUrl(location.href).mode !== 'none') location.reload();
    };
    window.addEventListener('popstate', onNavigate);
    window.addEventListener('hashchange', onNavigate);
  }

  // отладочный доступ для smoke-тестов
  (window as unknown as Record<string, unknown>).__doska = { state, undo, redo, requestRender, importPdfFromDataUrl, startLocalRoom };

  // окно первого входа — на обычной доске (не в просмотре по ссылке), когда интерфейс уже показан
  if (!viewRoute) afterStartup = () => startOnboarding(authOutcome);
}

/** Что сделать, когда экран загрузки скрыт. */
let afterStartup: (() => void) | null = null;

/** Окно первого входа: возврат от провайдера (шаг 2 или ошибка на шаге 1), раздел «Профиль» или первое знакомство. */
function startOnboarding(outcome: AuthOutcome | null): void {
  const resume = outcome?.resume ?? null;
  if (outcome && resume?.where === 'onboarding') {
    openOnboarding({ step: outcome.ok ? 2 : 1, resume, error: outcome.ok ? null : outcome.error });
  } else if (outcome && resume?.where === 'settings') {
    openProfileAfterAuth(outcome);
  } else if (needsOnboarding()) {
    openOnboarding();
  }
}

void boot().then(() => {
  // Дождаться отрисовки холста, прежде чем открывать готовый интерфейс.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    document.getElementById('startup')!.hidden = true;
    const next = afterStartup;
    afterStartup = null;
    next?.();
  }));
}).catch((error: unknown) => {
  console.error('Не удалось запустить приложение', error);
  document.getElementById('startup-message')!.textContent = 'Не удалось загрузить приложение.';
  document.getElementById('startup-retry')!.hidden = false;
});
