import type { Project } from './types';
import type { ApiClient } from './api-client';
import { AssetStore, fetchMissingAssets } from './asset-store';

// Картинки проектов, пришедших с сервера: общее хранилище вкладки (память + IndexedDB) и подстановка data URL
// на место ссылок asset://… до того, как проект попадёт на холст.

export const assetStore = new AssetStore();

/**
 * Докачивает недостающие картинки и подставляет их в проект. Не получилось скачать — ссылка остаётся
 * (рендерер рисует заглушку); сам проект при этом открывается. Нетронутый проект — тот же объект.
 */
export async function hydrateFromCloud(project: Project, api: ApiClient | null, store: AssetStore = assetStore): Promise<Project> {
  if (api) await fetchMissingAssets(project, store, api).catch(() => []);
  return store.hydrateProjectAssets(project);
}
