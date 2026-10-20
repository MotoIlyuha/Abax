import './style.css';
import { initRenderer, requestRender } from './renderer';
import { initController } from './controller';
import { initApp, importPdfFromDataUrl } from './app';
import { state, openProject, blankProject, projectMeta, onChange, undo, redo } from './state';
import { storage, setStorage } from './storage';
import { startCollab, netStorage } from './collab';
import { initTooltips } from './tooltip';

async function boot(): Promise<void> {
  initTooltips();
  const canvas = document.getElementById('board') as HTMLCanvasElement;

  // guest-режим: открыта ссылка совместной работы (?room=CODE)
  const q = new URLSearchParams(location.search);
  const roomCode = q.get('room');
  if (roomCode) {
    // имя из URL (тестовое окно) или автогенерация — БЕЗ window.prompt,
    // который блокирует boot в Electron BrowserWindow
    const name = q.get('name') || `Гость ${Math.floor(Math.random() * 90 + 10)}`;
    await startCollab(`ws://${location.host}/ws?code=${encodeURIComponent(roomCode)}`, false, name);
    setStorage(netStorage);
    initRenderer(canvas);
    initApp(canvas);
    initController(canvas);
    onChange(() => requestRender());
    document.body.classList.add('collab-guest');
    (window as unknown as Record<string, unknown>).__doska = { state, undo, redo, requestRender };
    return;
  }

  let metas = await storage.list();
  let last: { pid?: string; pageId?: string } = {};
  try {
    last = JSON.parse(localStorage.getItem('doska.last') || '{}');
  } catch { /* нет сохранённой позиции */ }
  let project = last.pid ? await storage.load(last.pid) : null;
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

  initRenderer(canvas);
  initApp(canvas);
  initController(canvas);
  onChange(() => requestRender());

  // отладочный доступ для smoke-тестов
  (window as unknown as Record<string, unknown>).__doska = { state, undo, redo, requestRender, importPdfFromDataUrl };
}

void boot();
