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
