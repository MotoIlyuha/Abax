// Индикатор облачной синхронизации открытого проекта в шапке (SPEC_NIGHT5 §2.2): «Сохранено в облаке»,
// «Синхронизация…», «Сохранено на устройстве (офлайн)» (клик — отправить сейчас), «Только на устройстве (превышен
// лимит тарифа)» (клик — пояснение). Без облака, у гостя, в просмотре по ссылке и у нетронутой заглушки скрыт.

import { showToast } from './about';
import { cloudStorage } from './cloud-sync';
import { onChange, state } from './state';
import { SYNC_STATUS_TEXT, type SyncStatus } from './sync-state';

export const LIMIT_INFO_TEXT = 'На бесплатном тарифе в облаке хранятся 3 проекта по 3 страницы. Этот проект сохранён только на устройстве — в подписке Pro ограничений нет.';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Иконки — статичные константы (пути), пользовательских данных в разметке нет. */
const CLOUD = 'M7 18h10.5a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.6 9.2 4.5 4.5 0 0 0 7 18z';
const ICONS: Record<Exclude<SyncStatus, 'hidden'>, { d: string; cls?: string }[]> = {
  synced: [{ d: CLOUD }, { d: 'M9.2 13.2l2 2 3.8-4' }],
  syncing: [{ d: CLOUD }, { d: 'M9.5 12.5a2.6 2.6 0 0 1 4.6-1.3M14.5 13.5a2.6 2.6 0 0 1-4.6 1.3M14.3 10.2v1.3h-1.3M9.7 15.8v-1.3h1.3', cls: 'sync-arrows' }],
  offline: [{ d: CLOUD }, { d: 'M5 5l14 14' }],
  limit: [{ d: CLOUD }, { d: 'M12 10.5v3M12 15.8v.1' }],
};

function iconFor(status: Exclude<SyncStatus, 'hidden'>): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.7');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const part of ICONS[status]) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', part.d);
    if (part.cls) {
      const g = document.createElementNS(SVG_NS, 'g');
      g.setAttribute('class', part.cls);
      g.append(path);
      svg.append(g);
    } else svg.append(path);
  }
  return svg;
}

/** Текущий статус индикатора для открытого проекта. */
export function currentSyncStatus(): SyncStatus {
  const cloud = cloudStorage();
  if (!cloud || state.linkMode || state.collabRole === 'guest') return 'hidden';
  return cloud.status(state.project);
}

/** Привязать индикатор к кнопке #sync-indicator. Без облака кнопка остаётся скрытой. */
export function initSyncIndicator(): void {
  const btn = document.getElementById('sync-indicator') as HTMLButtonElement | null;
  const cloud = cloudStorage();
  if (!btn || !cloud) return;
  let shown: SyncStatus | null = null;
  let frame = 0;
  const render = () => {
    frame = 0;
    const status = currentSyncStatus();
    if (status === shown) return;
    shown = status;
    btn.dataset.status = status;
    if (status === 'hidden') { btn.hidden = true; btn.textContent = ''; return; }
    btn.hidden = false;
    btn.title = SYNC_STATUS_TEXT[status];
    btn.setAttribute('aria-label', SYNC_STATUS_TEXT[status]);
    btn.replaceChildren(iconFor(status));
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(render); };
  cloud.onStatus(schedule);
  onChange(schedule);
  btn.addEventListener('click', () => {
    if (shown === 'offline') void cloud.flushNow().catch(() => {}).then(schedule);
    else if (shown === 'limit') showToast(LIMIT_INFO_TEXT);
  });
  render();
}
