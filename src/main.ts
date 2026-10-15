import './style.css';
import { initRenderer, requestRender } from './renderer';
import { initController } from './controller';
import { initApp, importPdfFromDataUrl } from './app';
import { state, openProject, blankProject, projectMeta, onChange, undo, redo } from './state';
import { storage } from './storage';

async function boot(): Promise<void> {
  const canvas = document.getElementById('board') as HTMLCanvasElement;

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
