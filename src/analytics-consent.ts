// Личный выбор аналитики хранится на устройстве, отдельно от настроек доски.
import { atRest, clamp, motionEnabled, reduceMotion, S, snap, step, uiAnimOff } from './motion';
import { createToggleSwitch, setToggleChecked } from './toggle-switch';

const KEY = 'abax.analytics-consent';
type Choice = 'accepted' | 'rejected';

export function analyticsChoice(): Choice | null {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'accepted' || value === 'rejected' ? value : null;
  } catch { return null; }
}

export function analyticsAvailable(): boolean { return location.protocol === 'http:' || location.protocol === 'https:'; }

/** Возвращает false, если выбор нельзя сохранить: счётчик в таком случае не запускается. */
export function setAnalyticsChoice(accepted: boolean): boolean {
  const previous = analyticsChoice();
  try { localStorage.setItem(KEY, accepted ? 'accepted' : 'rejected'); } catch { return false; }
  if (accepted) window.dispatchEvent(new Event('abax:analytics-accepted'));
  else if (previous === 'accepted') location.reload();
  return true;
}

export function showAnalyticsBanner(): void {
  if (!analyticsAvailable() || analyticsChoice() || document.getElementById('analytics-banner')) return;
  const anchor = document.getElementById('btn-help')?.parentElement;
  if (!anchor) return;
  const card = document.createElement('section');
  card.id = 'analytics-banner';
  card.setAttribute('aria-label', 'Настройки аналитики');
  const title = document.createElement('strong');
  title.textContent = 'Помогите улучшить Abax';
  const text = document.createElement('p');
  text.textContent = 'Яндекс Метрика использует файлы cookie и собирает статистику, чтобы помочь нам улучшать продукт. Выбор можно изменить в разделе «Конфиденциальность» в настройках.';
  const error = document.createElement('p');
  error.className = 'analytics-error';
  error.setAttribute('role', 'alert');
  const buttons = document.createElement('div');
  buttons.className = 'analytics-actions';
  for (const [label, accepted] of [['Отклонить', false], ['Разрешить', true]] as const) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    if (accepted) button.className = 'analytics-accept';
    button.addEventListener('click', () => {
      if (!setAnalyticsChoice(accepted)) { error.textContent = 'Не удалось сохранить выбор. Проверьте настройки браузера.'; return; }
      document.getElementById('btn-help')?.focus({ preventScroll: true });
      card.setAttribute('inert', '');
      closeBanner(card);
    });
    buttons.appendChild(button);
  }
  card.append(title, text, buttons, error);
  anchor.appendChild(card);
}

function closeBanner(card: HTMLElement): void {
  if (uiAnimOff() || reduceMotion()) { card.remove(); return; }
  card.classList.add('analytics-closing');
  if (!motionEnabled()) {
    card.addEventListener('animationend', () => card.remove(), { once: true });
    window.setTimeout(() => card.remove(), 300);
    return;
  }
  const spring = S(1, 260, 25);
  spring.t = 0;
  let last = 0;
  const frame = (now: number) => {
    if (!card.isConnected) return;
    const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
    last = now;
    for (let i = 0; i < 4; i++) step(spring, dt / 4);
    const progress = clamp(spring.x, 0, 1);
    card.style.transform = `scale(${progress})`;
    card.style.opacity = String(progress);
    if (atRest(spring, 0.01)) { snap(spring); card.remove(); }
    else requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

export function renderAnalyticsSettings(host: HTMLElement): void {
  const box = document.createElement('div');
  box.className = 'sd-general';
  const hint = document.createElement('p');
  hint.id = 'analytics-settings-hint';
  hint.className = 'analytics-settings-hint';
  hint.textContent = 'Аналитические cookie и статистика посещений. Не отключайте, если хотите сделать Abax лучше. При выключении страница перезагрузится.';
  const error = document.createElement('p');
  error.className = 'analytics-settings-error';
  error.setAttribute('role', 'alert');
  const row = createToggleSwitch({
    className: 'grid-switch analytics-settings-switch', label: 'Яндекс Метрика', checked: analyticsChoice() === 'accepted',
    onChange: accepted => {
      if (!setAnalyticsChoice(accepted)) {
        setToggleChecked(input, !accepted);
        error.textContent = 'Не удалось сохранить выбор. Проверьте настройки браузера.';
        return;
      }
      error.textContent = '';
      document.getElementById('analytics-banner')?.remove();
    },
  });
  const input = row.querySelector('input')!;
  input.setAttribute('aria-describedby', hint.id);
  box.append(row, hint, error);
  host.append(box);
}
