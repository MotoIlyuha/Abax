import './style.css';
import { initRenderer, requestRender } from './renderer';
import { initController } from './controller';
import { initApp } from './app';
import { state, loadBoard, createBoard, boardMeta, onChange, undo, redo } from './state';
import { storage } from './storage';

async function boot(): Promise<void> {
  const canvas = document.getElementById('board') as HTMLCanvasElement;

  let metas = await storage.list();
  const lastId = localStorage.getItem('doska.last') || metas[0]?.id || null;
  let board = lastId ? await storage.load(lastId) : null;
  if (!board) {
    board = createBoard('Доска 1');
    await storage.save(board);
    metas = [boardMeta(board)];
  }
  loadBoard(board, metas);

  initRenderer(canvas);
  initApp(canvas);
  initController(canvas);
  onChange(() => requestRender());

  // отладочный доступ для smoke-тестов
  (window as unknown as Record<string, unknown>).__doska = { state, undo, redo, requestRender };
}

void boot();
