// Индикатор облачной синхронизации открытого проекта в шапке (SPEC_NIGHT5 §2.2): «Сохранено в облаке»,
// «Синхронизация…», «Сохранено на устройстве (офлайн)» (клик — отправить сейчас), «Только на устройстве (превышен
// лимит тарифа)» (клик — пояснение). Без облака, у гостя, в просмотре по ссылке и у нетронутой заглушки скрыт.

import { showToast } from './about';
import { cloudStorage } from './cloud-sync';
import { onChange, state } from './state';
import { SYNC_STATUS_TEXT, type SyncStatus } from './sync-state';

export const LIMIT_INFO_TEXT = 'На бесплатном тарифе в облаке хранятся 3 проекта по 3 страницы. Этот проект сохранён только на устройстве — в подписке Pro ограничений нет.';

import { SYNC_ICONS } from './icons';

const SVG_NS = 'http://www.w3.org/2000/svg';

function iconFor(status: Exclude<SyncStatus, 'hidden'>): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.7');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const part of SYNC_ICONS[status]) {
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

/** Привязать индикатор к кнопке #sync-indicator. Без облака кнопка остаётся скрытой. onDraft — клик при черновике конфликта. */
export function initSyncIndicator(opts: { onDraft?: () => void } = {}): void {
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
    else if (shown === 'draft') opts.onDraft?.();
  });
  render();
}
