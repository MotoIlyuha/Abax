import { beforeEach, describe, expect, it, vi } from 'vitest';
import { analyticsChoice, renderAnalyticsSettings, showAnalyticsBanner } from '../../src/analytics-consent';

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<div class="help-group"><button id="btn-help">Помощь</button></div>';
  document.body.classList.add('no-ui-anim');
});

describe('выбор аналитики', () => {
  it('предлагает выбор у кнопки помощи и запускает счётчик только после разрешения', () => {
    const start = vi.fn();
    window.addEventListener('abax:analytics-accepted', start, { once: true });
    showAnalyticsBanner();
    expect(document.querySelector('.help-group #analytics-banner')).not.toBeNull();
    expect(start).not.toHaveBeenCalled();
    const buttons = document.querySelectorAll<HTMLButtonElement>('#analytics-banner button');
    buttons[1].click();
    expect(analyticsChoice()).toBe('accepted');
    expect(start).toHaveBeenCalledOnce();
    expect(document.getElementById('analytics-banner')).toBeNull();
    showAnalyticsBanner();
    expect(document.getElementById('analytics-banner')).toBeNull();
  });

  it('запоминает отказ и позволяет позже разрешить аналитику в настройках', () => {
    showAnalyticsBanner();
    document.querySelector<HTMLButtonElement>('#analytics-banner button')!.click();
    expect(analyticsChoice()).toBe('rejected');
    const host = document.createElement('div');
    document.body.appendChild(host);
    renderAnalyticsSettings(host);
    const input = host.querySelector<HTMLInputElement>('input')!;
    expect(input.checked).toBe(false);
    input.click();
    expect(analyticsChoice()).toBe('accepted');
  });
});


describe('анимация выбора аналитики', () => {
  it.each([['accepted', 1], ['rejected', 0]] as const)('завершает выбор %s', (choice, index) => {
    document.body.classList.remove('no-ui-anim', 'no-motion');
    let next: FrameRequestCallback | undefined;
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { next = callback; return 1; });
    showAnalyticsBanner();
    const banner = document.getElementById('analytics-banner')!;
    banner.querySelectorAll<HTMLButtonElement>('button')[index].click();
    expect(analyticsChoice()).toBe(choice);
    expect(banner.querySelector('[role="status"]')).not.toBeNull();
    for (let now = 0; now < 4000 && next && banner.isConnected; now += 16) {
      const callback = next; next = undefined; callback(now);
    }
    expect(banner.isConnected).toBe(false);
    raf.mockRestore();
  });
});


it('перемещает подтверждение к справке и пружинит кнопкой', () => {
  document.body.classList.remove('no-ui-anim', 'no-motion');
  let next: FrameRequestCallback | undefined;
  const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { next = callback; return 1; });
  showAnalyticsBanner();
  const banner = document.getElementById('analytics-banner')!;
  const help = document.getElementById('btn-help')!;
  vi.spyOn(banner, 'getBoundingClientRect').mockReturnValue({ left: 100, top: 100, width: 200, height: 44 } as DOMRect);
  vi.spyOn(help, 'getBoundingClientRect').mockReturnValue({ left: 250, top: 250, width: 40, height: 40 } as DOMRect);
  banner.querySelectorAll<HTMLButtonElement>('button')[1].click();
  let sawTravel = false, sawBounce = false;
  for (let now = 0; now < 5000 && next; now += 16) {
    const callback = next; next = undefined; callback(now);
    if (banner.style.transform.includes('translate(')) sawTravel = true;
    if (help.style.scale && help.style.scale !== '1') sawBounce = true;
  }
  expect(sawTravel).toBe(true);
  expect(sawBounce).toBe(true);
  expect(banner.isConnected).toBe(false);
  expect(help.style.scale).toBe('');
  expect(help.parentElement?.classList.contains('analytics-arriving')).toBe(false);
  raf.mockRestore();
});
