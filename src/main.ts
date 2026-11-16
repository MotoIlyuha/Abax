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

/** Уведомление гостю, когда комната закрылась или отказала. */
function watchGuestClose(): void {
  document.addEventListener('doska:collab-closed', ev => {
    const notice = closedNotice((ev as CustomEvent<CollabClosedDetail>).detail.code);
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
  });

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
      watchGuestClose();
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
      project = blankProject('Проект 1');
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
  void syncAccount().then(() => { startBackgroundSync(); startProfileSync(); });
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
}

void boot().then(() => {
  // Дождаться отрисовки холста, прежде чем открывать готовый интерфейс.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    document.getElementById('startup')!.hidden = true;
  }));
}).catch((error: unknown) => {
  console.error('Не удалось запустить приложение', error);
  document.getElementById('startup-message')!.textContent = 'Не удалось загрузить приложение.';
  document.getElementById('startup-retry')!.hidden = false;
});
